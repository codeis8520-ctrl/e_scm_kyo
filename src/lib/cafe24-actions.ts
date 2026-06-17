'use server';

import { requireSession } from '@/lib/session';
import { loadTokens, refreshAccessToken } from '@/lib/cafe24/token-store';
import { normalizeOptionValue } from '@/lib/cafe24/types';
import { syncCafe24PaidOrdersCore } from '@/lib/cafe24/sync-orders';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// ─── 토큰 수동 갱신 ──────────────────────────────────────────────────────────
export async function refreshCafe24Token() {
  try {
    await requireSession();
  } catch (e: any) {
    return { success: false, message: e.message };
  }

  const row = await loadTokens();
  if (!row) {
    return { success: false, message: '저장된 토큰 없음 — 초기 인증 필요 (/api/cafe24/auth)' };
  }

  const refreshExpiresAt = new Date(row.refresh_token_expires_at).getTime();
  const daysLeft = Math.floor((refreshExpiresAt - Date.now()) / (1000 * 60 * 60 * 24));

  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    return {
      success: true,
      message: `토큰 갱신 완료 (refresh_token 만료 ${daysLeft}일 전 시점)`,
      access_token_preview: refreshed.access_token?.slice(0, 8) + '...',
    };
  } catch (err: any) {
    return { success: false, message: `갱신 실패: ${err.message} — 수동 재인증 필요` };
  }
}

// ─── 결제완료 주문 매출 동기화 (UI/AI 경로) ───────────────────────────────
// 세션 검증 후 순수 로직 위임. 크론은 이 래퍼가 아니라 core를 직접 호출.
export async function syncCafe24PaidOrders(params: { startDate: string; endDate: string }) {
  try {
    await requireSession();
  } catch (e: any) {
    return { success: false, message: e.message, processed: 0 };
  }
  return syncCafe24PaidOrdersCore(params);
}

// ─── 자사몰 주문자 → 고객 수동 등록 (배송 카페24 주문탭) ─────────────────────
// 미등록 주문자(이름+전화 미일치)를 검수 후 고객으로 등록하고, 해당 자사몰
// 주문(sales_orders)에 customer_id 연결 → 판매현황에 고객으로 표기.
// dedup: phone(UNIQUE) 기준. 전화가 이미 타인(이름 불일치) 소유면 스킵(오등록 방지).
export async function registerCafe24Customers(
  items: {
    cafe24_order_id: string; name: string; phone: string; address?: string; email?: string;
    order_items?: { name: string; quantity: number; price: number; option?: string }[];
  }[]
) {
  try {
    await requireSession();
  } catch (e: any) {
    return { success: false, message: e.message };
  }
  if (!items?.length) return { success: false, message: '선택된 주문이 없습니다' };

  const sb = (await createClient()) as any;
  const digits = (s: string) => (s || '').replace(/\D/g, '');
  const toDashed = (s: string) => {
    const d = digits(s);
    if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return '';
  };

  let created = 0, linked = 0, skipped = 0;
  for (const it of items) {
    const name = (it.name || '').trim();
    const phone = toDashed(it.phone);
    if (!name || !phone) { skipped++; continue; }

    // 기존 여부(이름 AND 전화)
    const { data: exist } = await sb.from('customers').select('id, name').eq('phone', phone).maybeSingle();
    let customerId: string | null = null;
    if (exist) {
      if (exist.name === name) customerId = exist.id;  // 이미 우리 고객
      else { skipped++; continue; }                    // 전화 타인 소유 → 오등록 방지 스킵
    } else {
      const { data: ins } = await sb.from('customers').insert({
        name, phone,
        address: (it.address || '').trim() || null,
        email: (it.email || '').trim() || null,
        source: 'CAFE24', is_active: true,
      }).select('id').maybeSingle();
      if (ins) { customerId = ins.id; created++; }
    }

    if (customerId) {
      const { data: upd } = await sb.from('sales_orders')
        .update({ customer_id: customerId })
        .eq('cafe24_order_id', it.cafe24_order_id)
        .is('customer_id', null)
        .select('id');
      if (upd?.length) linked += upd.length;

      // 구매품목 텍스트 저장 (best-effort) — 신규/기존 연결 양쪽 모두.
      // 이미 연결된 주문은 위 update가 비어 있으므로 별도로 soId 확보.
      const orderItems = it.order_items ?? [];
      if (orderItems.length > 0) {
        try {
          const { data: so } = await sb.from('sales_orders')
            .select('id')
            .eq('cafe24_order_id', it.cafe24_order_id)
            .maybeSingle();
          const soId = so?.id;
          if (soId) {
            // 멱등 가드: 이미 품목이 있으면 재클릭 중복 insert 방지
            const { data: existingItem } = await sb.from('sales_order_items')
              .select('id').eq('sales_order_id', soId).limit(1);
            if (!existingItem?.length) {
              await sb.from('sales_order_items').insert(
                orderItems.map(oi => ({
                  sales_order_id: soId,
                  product_id: null,
                  item_text: oi.name,
                  quantity: oi.quantity || 1,
                  unit_price: oi.price || 0,
                  total_price: (oi.price || 0) * (oi.quantity || 1),
                  order_option: oi.option || null,
                }))
              );
            }
          }
        } catch {
          // 품목 저장 실패는 고객 등록 성공에 영향 주지 않음(080 미적용 등)
        }
      }
    }
  }

  revalidatePath('/shipping');
  revalidatePath('/pos');
  return {
    success: true,
    message: `고객 ${created}명 등록, 주문 ${linked}건 연결${skipped ? `, ${skipped}건 스킵(정보부족·번호충돌)` : ''}`,
    created, linked, skipped,
  };
}

// ─── 카페24 품목 → 내부 product 매핑 (이카운트식 짧은 품목명) ───────────────────
// (cafe24_product_code + 정규화 option_value) → product_id 매핑. 송장/배송 items_summary에
// 내부 product.name(짧음)을 표시. 미매핑은 원본 옵션정리 fallback.
// 키 일관성: 저장 직전 normalizeOptionValue 재적용(LOCKED) — orders/route 조회와 byte 동일.
const PRODUCT_MAP_ROLES = ['SUPER_ADMIN', 'HQ_OPERATOR'];

export async function createCafe24ProductMap(params: {
  cafe24_product_code: string;
  option_value: string;
  product_id: string;
  // 기존 전표 백필용(선택) — sales_order_items.order_option·item_text 매칭 키.
  //   option_display = 송장/전표 표시 옵션(extractItemOptions 결과, sales_order_items.order_option와 동일)
  //   cafe24_name    = 카페24 원본 품목명(미매핑 item_text와 동일)
  option_display?: string;
  cafe24_name?: string;
}) {
  let session;
  try {
    session = await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }
  if (!PRODUCT_MAP_ROLES.includes(session.role)) {
    return { error: '품목 매핑은 본사 권한만 가능합니다.' };
  }

  const code = (params.cafe24_product_code || '').trim();
  const productId = (params.product_id || '').trim();
  if (!code || !productId) {
    return { error: '카페24 품목코드와 내부 제품을 모두 지정하세요.' };
  }
  // 저장 직전 정규화 재적용(LOCKED) — 호출자 입력과 무관하게 키 일관성 보장.
  const optionValue = normalizeOptionValue(params.option_value);

  try {
    const sb = (await createClient()) as any;
    const { error } = await sb
      .from('cafe24_product_map')
      .upsert(
        { cafe24_product_code: code, option_value: optionValue, product_id: productId },
        { onConflict: 'cafe24_product_code,option_value' }
      );
    if (error) return { error: error.message };

    // 기존 전표 백필(#매핑이 판매현황 수령현황에도 즉시 반영되게).
    //   미매핑 sales_order_items(product_id NULL) 중 같은 (표시옵션 + 원본품목명)을
    //   가진 행을 찾아 product_id + item_text(내부 제품명)로 채운다.
    //   동일 옵션조합은 여러 주문에 한 번에 반영(배송 화면 안내문과 일치).
    let backfilled = 0;
    try {
      if (params.cafe24_name !== undefined) {
        const { data: prod } = await sb
          .from('products')
          .select('name')
          .eq('id', productId)
          .maybeSingle();
        const internalName = prod?.name ?? null;

        let q = sb
          .from('sales_order_items')
          .update({ product_id: productId, item_text: internalName })
          .is('product_id', null)
          .eq('item_text', params.cafe24_name);
        // 옵션조합으로 좁힘(서로 다른 내부제품으로 가는 옵션 오매칭 방지).
        const opt = (params.option_display ?? '').trim();
        q = opt ? q.eq('order_option', opt) : q.is('order_option', null);

        const { data: updated, error: bfErr } = await q.select('id');
        if (!bfErr && Array.isArray(updated)) backfilled = updated.length;
      }
    } catch {
      /* 백필 실패가 매핑 저장을 무효화하지 않음(미매핑 degrade) */
    }

    revalidatePath('/pos');
    revalidatePath('/shipping');
    return { success: true, backfilled };
  } catch (e: any) {
    return { error: e?.message ?? '매핑 저장 중 오류가 발생했습니다.' };
  }
}

export async function listCafe24ProductMaps() {
  try {
    await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }
  try {
    const sb = (await createClient()) as any;
    const { data, error } = await sb
      .from('cafe24_product_map')
      .select('id, cafe24_product_code, option_value, product_id, created_at, products(name)')
      .order('cafe24_product_code', { ascending: true });
    if (error) return { error: error.message };
    return { success: true, maps: data ?? [] };
  } catch (e: any) {
    return { error: e?.message ?? '매핑 조회 중 오류가 발생했습니다.' };
  }
}

export async function deleteCafe24ProductMap(params: {
  cafe24_product_code: string;
  option_value: string;
}) {
  let session;
  try {
    session = await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }
  if (!PRODUCT_MAP_ROLES.includes(session.role)) {
    return { error: '품목 매핑은 본사 권한만 가능합니다.' };
  }

  const code = (params.cafe24_product_code || '').trim();
  // 삭제 키도 동일 정규화(저장값과 byte 일치).
  const optionValue = normalizeOptionValue(params.option_value);

  try {
    const sb = (await createClient()) as any;
    const { error } = await sb
      .from('cafe24_product_map')
      .delete()
      .eq('cafe24_product_code', code)
      .eq('option_value', optionValue);
    if (error) return { error: error.message };
    return { success: true };
  } catch (e: any) {
    return { error: e?.message ?? '매핑 삭제 중 오류가 발생했습니다.' };
  }
}
