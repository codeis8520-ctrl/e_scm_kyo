// 카페24 결제완료 주문 매출 동기화 — 순수 로직 (인증 없음)
// 세션 검증은 호출자 책임: UI 경로는 cafe24-actions.ts의 서버 액션, 크론은 CRON_SECRET 라우트.

import { revalidatePath } from 'next/cache';
import { getValidAccessToken } from '@/lib/cafe24/token-store';
import { processCafe24Webhook } from '@/lib/cafe24/webhook';

export interface SyncPaidOrdersResult {
  success: boolean;
  message: string;
  processed: number;
  created?: number;
  updated?: number;
  errors?: number;
}

export async function syncCafe24PaidOrdersCore(params: {
  startDate: string;
  endDate: string;
}): Promise<SyncPaidOrdersResult> {
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
    const paidOrders = rawOrders.filter(
      (o: any) => o.paid === 'T' && o.canceled !== 'T'
    );

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const o of paidOrders) {
      // 카페24 order_id는 "20260408-0000001" 형태의 문자열 — Number 변환 X
      const orderNo: any = o.order_id;
      if (!orderNo) continue;

      try {
        await processCafe24Webhook({
          event_type: 'order.created',
          order_no: orderNo,
          member_id: o.member_id || '',
          status_code: o.order_status || '',
        } as any);

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
      created,
      updated,
      errors,
    };
  } catch (err: any) {
    return { success: false, message: `동기화 오류: ${err.message}`, processed: 0 };
  }
}
