'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { fireNotificationTrigger } from '@/lib/notification-triggers';
import { syncReceiptStatusFromShipment } from '@/lib/receipt-sync';
import { confirmCafe24OrderAsSale } from '@/lib/cafe24/webhook';

export interface ShipmentInput {
  source: 'CAFE24' | 'STORE';
  cafe24_order_id?: string;
  sales_order_id?: string;
  member_id?: string;       // confirm 전용(카페24 주문 확정 시 고객 dedup). shipments 컬럼 아님 — insert payload 제외.
  sender_name: string;
  sender_phone: string;
  sender_zipcode?: string;
  sender_address?: string;
  sender_address_detail?: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_zipcode?: string;
  recipient_address: string;
  recipient_address_detail?: string;
  delivery_message?: string;
  items_summary?: string;
  branch_id?: string;
  created_by?: string;
}

export async function getShipments(status?: string) {
  const supabase = await createClient() as any;

  let query = supabase
    .from('shipments')
    .select('*')
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('getShipments error:', error);
    return { data: [] };
  }

  return { data: data || [] };
}

export async function createShipment(data: ShipmentInput) {
  const supabase = await createClient() as any;

  // member_id 는 confirm 전용 입력(shipments 컬럼 아님) — insert payload 에서 제외.
  const { member_id, ...shipmentData } = data;
  let salesOrderId = shipmentData.sales_order_id;

  // 매출 인식 분리(#25): 카페24 주문은 "배송 추가" 확정 시점에만 sales_order·매출분개 생성.
  //   confirm 호출로 전표 생성 후 그 sales_order.id 를 shipment 에 직접 연결한다.
  //   confirm 실패 시 배송도 만들지 않는다(전표 없는 배송 방지).
  if (shipmentData.source === 'CAFE24' && shipmentData.cafe24_order_id) {
    const confirm = await confirmCafe24OrderAsSale(shipmentData.cafe24_order_id, member_id || '');
    if (!confirm.success || !confirm.orderId) {
      return { success: false, error: confirm.message || '판매전표 생성 실패' };
    }
    salesOrderId = confirm.orderId;
  }

  const { error } = await supabase
    .from('shipments')
    .insert([{ ...shipmentData, sales_order_id: salesOrderId }]);

  if (error) {
    console.error('createShipment error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/shipping');
  return { success: true };
}

export async function updateShipment(
  id: string,
  data: Partial<ShipmentInput & { tracking_number: string | null; status: string }> & Record<string, unknown>
) {
  const supabase = await createClient() as any;

  // 이전 상태 조회 (송장번호 신규 등록 + SHIPPED 전환 감지용)
  const { data: prev } = await supabase
    .from('shipments')
    .select('tracking_number, status, recipient_name, recipient_phone, items_summary, cafe24_order_id, sales_order_id')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase
    .from('shipments')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('updateShipment error:', error);
    return { success: false, error: error.message };
  }

  const prevTracking = (prev as any)?.tracking_number || null;
  const prevStatus = (prev as any)?.status || null;
  const newTracking = (data.tracking_number as string | null | undefined) ?? prevTracking;
  const newStatus = (data.status as string | undefined) ?? prevStatus;

  // 배송 상태 → 판매현황 수령상태 자동 연동 (#19) — 상태 전환 시에만
  try {
    const salesOrderId = (prev as any)?.sales_order_id;
    if (salesOrderId && newStatus && newStatus !== prevStatus &&
        (newStatus === 'SHIPPED' || newStatus === 'DELIVERED')) {
      await syncReceiptStatusFromShipment(supabase, salesOrderId, newStatus);
      revalidatePath('/pos');
    }
  } catch (e) {
    console.error('updateShipment receipt-sync error:', e);
    /* 연동 실패가 배송 처리를 막지 않음 */
  }

  // 송장번호가 신규 부여되었고, 상태가 SHIPPED로 전환된 경우 알림톡 발송
  try {
    const becameShipped = prevStatus !== 'SHIPPED' && newStatus === 'SHIPPED';
    const gotTracking = !prevTracking && !!newTracking;

    if ((becameShipped || gotTracking) && prev?.recipient_name && prev?.recipient_phone && newTracking) {
      fireNotificationTrigger({
        eventType: 'SHIPMENT',
        customer: {
          name: (prev as any).recipient_name,
          phone: (prev as any).recipient_phone,
        },
        context: {
          trackingNo: String(newTracking),
          productName: (prev as any).items_summary || '',
          orderNo: (prev as any).cafe24_order_id || '',
        },
      }).catch(() => {});
    }
  } catch {
    /* 알림톡 실패가 업무 흐름을 막지 않음 */
  }

  revalidatePath('/shipping');
  return { success: true };
}

export async function deleteShipment(id: string) {
  const supabase = await createClient() as any;

  const { error } = await supabase.from('shipments').delete().eq('id', id);

  if (error) {
    console.error('deleteShipment error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/shipping');
  return { success: true };
}
