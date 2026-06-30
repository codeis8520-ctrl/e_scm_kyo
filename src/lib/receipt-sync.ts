import { kstTodayString } from '@/lib/date';

/**
 * 배송 상태 → 판매현황(sales_orders/items) 수령상태 자동 연동 (#19, #43, #90)
 *
 *   shipment PRINTED(송장출력) · SHIPPED(송장번호입력) · DELIVERED(배송완료)
 *     → 택배 품목을 RECEIVED(수령완료) + receipt_date. 전 품목 수령 시 주문도 완료.
 *
 * #90 정책: 판매현황은 고객 배송추적이 아니라 **내부 실무자 to-do 화면**이다.
 *   본사 업무 관행상 송장을 출력/번호입력하는 순간 그 전표는 처리 완료(수령완료)로 본다.
 *   → 송장 처리된 건은 판매현황 '택배예정'에서 더 이상 남지 않는다(명절 중복작업 방지).
 *   발송완료/배송완료 등 세부 진행상태는 [택배관리] 화면에서만 확인.
 *   (이전 #43: SHIPPED는 수령상태 불변이었으나 #90으로 폐기 — 송장처리=수령완료로 통일.)
 *
 * 택배분만 대상(receipt_status=PARCEL_PLANNED). 방문/퀵/이미 수령 품목은 무손상.
 * shipments.status를 바꾸는 모든 경로(updateShipment·CJ출력·AI·카페24웹훅)가 공용.
 * 연동 실패는 호출자가 swallow — 배송 처리 자체를 막지 않는다.
 *
 * @param supabase  cookie-aware 또는 anon Supabase 클라이언트 (RLS 통과 컨텍스트)
 */
const RECEIPT_DONE_SHIP_STATES = ['PRINTED', 'SHIPPED', 'DELIVERED'];

export async function syncReceiptStatusFromShipment(
  supabase: any,
  salesOrderId: string,
  newShipStatus: string
): Promise<void> {
  if (RECEIPT_DONE_SHIP_STATES.includes(newShipStatus)) {
    const today = kstTodayString();
    // #47: 상태만 RECEIVED로 전이한 뒤, receipt_date가 비어있는 행만 오늘로 채운다.
    //   → 택배예정일(수령예정일)이 입력돼 있던 건은 그 날짜를 보존(개선),
    //     예정일 없던 건은 NULL이므로 오늘로 채워짐.
    await supabase
      .from('sales_order_items')
      .update({ receipt_status: 'RECEIVED' })
      .eq('sales_order_id', salesOrderId)
      .eq('receipt_status', 'PARCEL_PLANNED');
    await supabase
      .from('sales_order_items')
      .update({ receipt_date: today })
      .eq('sales_order_id', salesOrderId)
      .eq('receipt_status', 'RECEIVED')
      .is('receipt_date', null);
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
        .update({ receipt_status: 'RECEIVED' })
        .eq('id', salesOrderId);
      await supabase
        .from('sales_orders')
        .update({ receipt_date: today })
        .eq('id', salesOrderId)
        .is('receipt_date', null);
    }
  }
}
