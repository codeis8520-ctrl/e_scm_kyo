'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { loadTokens, refreshAccessToken, getValidAccessToken } from '@/lib/cafe24/token-store';
import { processCafe24Webhook } from '@/lib/cafe24/webhook';

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

// ─── 결제완료 주문 매출 동기화 ──────────────────────────────────────────────
// 카페24에서 paid='T'인 주문을 조회 → webhook 핸들러를 그대로 호출하여
// sales_orders upsert + COMPLETED + 분개까지 일괄 처리
export async function syncCafe24PaidOrders(params: { startDate: string; endDate: string }) {
  try {
    await requireSession();
  } catch (e: any) {
    return { success: false, message: e.message, processed: 0 };
  }

  const mallId = process.env.CAFE24_MALL_ID;
  if (!mallId) return { success: false, message: 'CAFE24_MALL_ID 미설정', processed: 0 };

  const accessToken = await getValidAccessToken();
  if (!accessToken) return { success: false, message: '카페24 토큰 만료 — 토큰 갱신 후 재시도', processed: 0 };

  const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
  const base = `https://${mallId}.cafe24api.com/api/v2`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Cafe24-Api-Version': '2026-03-01',
  };

  try {
    const listRes = await fetch(
      `${base}/admin/orders?start_date=${params.startDate}&end_date=${params.endDate}&limit=100&shop_no=${shopNo}`,
      { headers, cache: 'no-store' }
    );
    if (!listRes.ok) {
      return { success: false, message: `카페24 주문 조회 실패: ${listRes.status}`, processed: 0 };
    }

    const listJson = await listRes.json();
    const rawOrders: any[] = listJson.orders ?? [];

    // paid='T' 또는 order_status가 결제완료 계열인 주문만 필터
    const paidOrders = rawOrders.filter(
      (o: any) => o.paid === 'T' && o.canceled !== 'T'
    );

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const o of paidOrders) {
      const orderNo = Number(o.order_id);
      if (!orderNo) continue;

      try {
        // 1) 주문 생성 (이미 있으면 webhook 핸들러가 duplicate 처리)
        await processCafe24Webhook({
          event_type: 'order.created',
          order_no: orderNo,
          member_id: o.member_id || '',
          status_code: o.order_status || '',
        } as any);

        // 2) 결제 완료 처리 → COMPLETED + 매출 분개
        const r = await processCafe24Webhook({
          event_type: 'order.paid',
          order_no: orderNo,
          member_id: o.member_id || '',
          status_code: o.order_status || 'F',
        } as any);

        if (r.success) {
          if (r.message?.includes('already exists')) updated++;
          else created++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }

    revalidatePath('/shipping');
    revalidatePath('/reports');
    revalidatePath('/accounting');

    return {
      success: true,
      message: `동기화 완료 — 신규 ${created}건, 기존 ${updated}건, 실패 ${errors}건 (대상 ${paidOrders.length}건)`,
      processed: paidOrders.length,
    };
  } catch (err: any) {
    return { success: false, message: `동기화 오류: ${err.message}`, processed: 0 };
  }
}
