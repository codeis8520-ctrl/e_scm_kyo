'use server';

import { requireSession } from '@/lib/session';
import { loadTokens, refreshAccessToken } from '@/lib/cafe24/token-store';
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
  items: { cafe24_order_id: string; name: string; phone: string; address?: string; email?: string }[]
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
