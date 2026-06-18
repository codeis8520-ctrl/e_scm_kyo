import { kstTodayString } from '@/lib/date';

/**
 * 배송 상태 → 판매현황(sales_orders/items) 수령상태 자동 연동 (#19, #43)
 *
 *   shipment SHIPPED   → 수령상태 불변(발송은 shipment.status로만 추적). receipt_status 유지.
 *   shipment DELIVERED → 택배 품목을 RECEIVED(수령완료) + receipt_date. 전 품목 수령 시 주문도 완료.
 *
 * 택배분만 대상(receipt_status 기준). 방문/퀵/이미 수령 품목은 무손상.
 * shipments.status를 바꾸는 모든 경로(updateShipment 서버액션 · AI update_shipment_tracking)가 공용.
 * 연동 실패는 호출자가 swallow — 배송 처리 자체를 막지 않는다.
 *
 * @param supabase  cookie-aware 또는 anon Supabase 클라이언트 (RLS 통과 컨텍스트)
 */
export async function syncReceiptStatusFromShipment(
  supabase: any,
  salesOrderId: string,
  newShipStatus: string
): Promise<void> {
  if (newShipStatus === 'DELIVERED') {
    const today = kstTodayString();
    await supabase
      .from('sales_order_items')
      .update({ receipt_status: 'RECEIVED', receipt_date: today })
      .eq('sales_order_id', salesOrderId)
      .eq('receipt_status', 'PARCEL_PLANNED');
    // 전 품목 수령 시에만 주문도 RECEIVED. 방문 품목 잔존 시 주문 수령상태 불변.
    const { data: items } = await supabase
      .from('sales_order_items')
      .select('receipt_status')
      .eq('sales_order_id', salesOrderId);
    const allReceived = (items ?? []).every(
      (it: any) => !it.receipt_status || it.receipt_status === 'RECEIVED'
    );
    if (allReceived) {
      await supabase
        .from('sales_orders')
        .update({ receipt_status: 'RECEIVED', receipt_date: today })
        .eq('id', salesOrderId);
    }
  }
}
