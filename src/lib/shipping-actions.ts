'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { fireNotificationTrigger } from '@/lib/notification-triggers';
import { syncReceiptStatusFromShipment } from '@/lib/receipt-sync';
import { confirmCafe24OrderAsSale } from '@/lib/cafe24/webhook';
import { requireSession } from '@/lib/session';
import { kstTodayString } from '@/lib/date';

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

  // 매출처(=판매 발생 지점) 보강(#21): shipments.branch_id 는 출고처라 매출처와 다름.
  //   매출처 = 연결된 sales_order.branch. 신규는 sales_order_id(FK), 과거 카페24는 cafe24_order_id.
  let query = supabase
    .from('shipments')
    .select('*, sales_order:sales_orders(receipt_date, receipt_status, branch:branches(id, name))')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);

  let { data, error } = await query;
  if (error) {
    // 임베드 실패(관계 모호 등) → 기본 select 폴백
    let q2 = supabase.from('shipments').select('*').order('created_at', { ascending: false });
    if (status) q2 = q2.eq('status', status);
    const retry = await q2;
    data = retry.data; error = retry.error;
    if (error) { console.error('getShipments error:', error); return { data: [] }; }
  }

  const rows: any[] = data || [];

  // sales_order_id 로 매출처/수령일을 못 얻은 카페24 행은 cafe24_order_id 로 보강
  const needCafe24 = rows.filter(r => !r?.sales_order && r.cafe24_order_id);
  const cafe24Map = new Map<string, { name?: string; receipt_date?: string | null }>();
  if (needCafe24.length > 0) {
    const ids = [...new Set(needCafe24.map(r => String(r.cafe24_order_id)))];
    const { data: sos } = await supabase
      .from('sales_orders')
      .select('cafe24_order_id, receipt_date, branch:branches(name)')
      .in('cafe24_order_id', ids);
    for (const s of (sos as any[]) || []) {
      cafe24Map.set(String(s.cafe24_order_id), { name: s.branch?.name, receipt_date: s.receipt_date });
    }
  }

  const result = rows.map(r => {
    const cm = cafe24Map.get(String(r.cafe24_order_id));
    return {
      ...r,
      // 매출처명: sales_order.branch → cafe24_order_id 매칭 → null(미연결)
      sale_branch_name: r?.sales_order?.branch?.name ?? cm?.name ?? null,
      // 수령일/택배예정일(#26): 연결 sales_order.receipt_date
      sale_receipt_date: r?.sales_order?.receipt_date ?? cm?.receipt_date ?? null,
    };
  });

  return { data: result };
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

  // 실제 shipments 컬럼만 허용 — 호출부가 파생필드(sale_branch_name·sale_receipt_date)나
  // 임베드 객체(sales_order)가 섞인 전체 객체를 넘겨도 update 가 깨지지 않도록 방어.
  const UPDATABLE = new Set([
    'source', 'cafe24_order_id', 'sales_order_id',
    'sender_name', 'sender_phone', 'sender_zipcode', 'sender_address', 'sender_address_detail',
    'recipient_name', 'recipient_phone', 'recipient_zipcode', 'recipient_address', 'recipient_address_detail',
    'delivery_message', 'items_summary', 'branch_id', 'created_by',
    'tracking_number', 'status',
  ]);
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (UPDATABLE.has(k)) clean[k] = v;
  }

  const { error } = await supabase
    .from('shipments')
    .update({ ...clean, updated_at: new Date().toISOString() })
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

/**
 * 판매현황 수령상태 일괄 변경 (#38)
 *
 * 여러 주문의 수령상태를 한 번에 발송완료(PARCEL_SHIPPED) 또는 수령완료(RECEIVED)로 변경.
 * 배송(shipments) 연결 건은 배송 상태(SHIPPED/DELIVERED)도 함께 갱신한 뒤
 * syncReceiptStatusFromShipment(#19 공용 매핑)로 품목/주문 수령상태를 일관 반영 → 배송목록·판매현황 동기화.
 * 배송 레코드가 없는 건(방문/퀵/직접입력)은 주문·품목 수령상태만 직접 갱신.
 */
export async function bulkUpdateReceiptStatus(
  orderIds: string[],
  target: 'PARCEL_SHIPPED' | 'RECEIVED'
): Promise<{ success?: true; updated?: number; skipped?: number; error?: string }> {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (ids.length === 0) return { error: '선택된 주문이 없습니다.' };
  if (target !== 'PARCEL_SHIPPED' && target !== 'RECEIVED') return { error: '지원하지 않는 상태입니다.' };

  const supabase = await createClient() as any;
  const today = kstTodayString();
  const shipStatus = target === 'RECEIVED' ? 'DELIVERED' : 'SHIPPED';
  let updated = 0;
  let skipped = 0;

  for (const orderId of ids) {
    try {
      // 현재 수령상태 — 전진 전이만 허용(이미 완료/뒤로가기 방지).
      const { data: ord } = await supabase
        .from('sales_orders')
        .select('receipt_status')
        .eq('id', orderId)
        .maybeSingle();
      const cur = ord?.receipt_status || 'RECEIVED';
      // 발송완료 대상: 택배예정만. 수령완료 대상: 이미 수령완료가 아닌 건.
      const allowed = target === 'PARCEL_SHIPPED'
        ? cur === 'PARCEL_PLANNED'
        : cur !== 'RECEIVED';
      if (!allowed) { skipped++; continue; }

      const { data: ship } = await supabase
        .from('shipments')
        .select('id, status')
        .eq('sales_order_id', orderId)
        .maybeSingle();

      if (ship?.id) {
        // 배송 연결 건 — 배송 상태 갱신 후 #19 공용 매핑으로 수령상태 반영.
        //   배송완료(DELIVERED)된 배송을 발송완료로 다운그레이드하지 않음.
        const downgrade = target === 'PARCEL_SHIPPED' && ship.status === 'DELIVERED';
        if (!downgrade) {
          await supabase
            .from('shipments')
            .update({ status: shipStatus, updated_at: new Date().toISOString() })
            .eq('id', ship.id);
        }
        await syncReceiptStatusFromShipment(supabase, orderId, shipStatus);
      } else if (target === 'RECEIVED') {
        // 배송 없는 건(방문/퀵/직접) — 미수령 품목·주문을 수령완료로
        await supabase
          .from('sales_order_items')
          .update({ receipt_status: 'RECEIVED', receipt_date: today })
          .eq('sales_order_id', orderId)
          .neq('receipt_status', 'RECEIVED');
        await supabase
          .from('sales_orders')
          .update({ receipt_status: 'RECEIVED', receipt_date: today })
          .eq('id', orderId);
      } else {
        // 배송 없는데 발송완료 요청 — 택배예정 주문/품목만 승격
        await supabase
          .from('sales_order_items')
          .update({ receipt_status: 'PARCEL_SHIPPED' })
          .eq('sales_order_id', orderId)
          .eq('receipt_status', 'PARCEL_PLANNED');
        await supabase
          .from('sales_orders')
          .update({ receipt_status: 'PARCEL_SHIPPED' })
          .eq('id', orderId)
          .eq('receipt_status', 'PARCEL_PLANNED');
      }
      updated++;
    } catch (e: any) {
      console.error('[bulkUpdateReceiptStatus] order', orderId, 'failed:', e?.message);
    }
  }

  revalidatePath('/pos');
  revalidatePath('/shipping');
  return { success: true, updated, skipped };
}
