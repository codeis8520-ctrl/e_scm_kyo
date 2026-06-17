// 카페24 결제완료 주문 매출 동기화 — 순수 로직 (인증 없음)
// 세션 검증은 호출자 책임: UI 경로는 cafe24-actions.ts의 서버 액션, 크론은 CRON_SECRET 라우트.

import { revalidatePath } from 'next/cache';
import { getValidAccessToken } from '@/lib/cafe24/token-store';
import { processCafe24Webhook } from '@/lib/cafe24/webhook';
import { createClient } from '@supabase/supabase-js';
import { syncReceiptStatusFromShipment } from '@/lib/receipt-sync';

// 카페24 shipping_status → 우리 shipments.status / 수령상태 매핑(방법 B).
//   F=배송전, W=배송보류 → 무시 / M=배송중 → SHIPPED(택배발송완료) / T=배송완료 → DELIVERED(수령완료)
const SHIPPING_STATUS_MAP: Record<string, 'SHIPPED' | 'DELIVERED'> = { M: 'SHIPPED', T: 'DELIVERED' };
const SHIP_RANK: Record<string, number> = { PENDING: 0, PRINTED: 1, SHIPPED: 2, DELIVERED: 3 };

export interface SyncPaidOrdersResult {
  success: boolean;
  message: string;
  processed: number;
  created?: number;
  updated?: number;
  errors?: number;
  shippingSynced?: number;
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
    let shippingSynced = 0;

    // 배송상태 동기화용 Supabase 클라이언트 (방법 B)
    const sb = (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      : null;

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

        // ── 배송상태 연동(방법 B): cafe24 shipping_status → shipments.status + 수령상태 ──
        //   카페24 관리자에서 배송 처리한 건을 우리 시스템에 반영. 다운그레이드 방지(전진만).
        const target = SHIPPING_STATUS_MAP[String(o.shipping_status ?? '')];
        if (sb && target) {
          try {
            const { data: so } = await sb
              .from('sales_orders')
              .select('id')
              .eq('cafe24_order_id', String(orderNo))
              .maybeSingle();
            if (so?.id) {
              const { data: shipRow } = await sb
                .from('shipments')
                .select('id, status')
                .eq('cafe24_order_id', String(orderNo))
                .maybeSingle();
              // shipment 있으면 전진 시에만 상태 갱신
              if (shipRow?.id && (SHIP_RANK[target] ?? 0) > (SHIP_RANK[shipRow.status as string] ?? 0)) {
                await sb
                  .from('shipments')
                  .update({ status: target, updated_at: new Date().toISOString() })
                  .eq('id', shipRow.id);
              }
              // 판매현황 수령상태 반영(#19 공용헬퍼) — shipment 없어도 sales_order_items 직접 갱신
              await syncReceiptStatusFromShipment(sb, so.id, target);
              shippingSynced++;
            }
          } catch {
            /* 배송 동기화 실패가 매출 동기화를 막지 않음 */
          }
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
      message: `동기화 완료 — 신규 ${created}건, 기존 ${updated}건, 배송반영 ${shippingSynced}건, 실패 ${errors}건 (대상 ${paidOrders.length}건)`,
      processed: paidOrders.length,
      created,
      updated,
      errors,
      shippingSynced,
    };
  } catch (err: any) {
    return { success: false, message: `동기화 오류: ${err.message}`, processed: 0 };
  }
}
