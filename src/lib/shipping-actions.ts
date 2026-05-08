'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { fireNotificationTrigger } from '@/lib/notification-triggers';

export interface ShipmentInput {
  source: 'CAFE24' | 'STORE';
  cafe24_order_id?: string;
  sales_order_id?: string;
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

  const { error } = await supabase.from('shipments').insert([data]);

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
    .select('tracking_number, status, recipient_name, recipient_phone, items_summary, cafe24_order_id')
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

  // 송장번호가 신규 부여되었고, 상태가 SHIPPED로 전환된 경우 알림톡 발송
  try {
    const prevTracking = (prev as any)?.tracking_number || null;
    const prevStatus = (prev as any)?.status || null;
    const newTracking = (data.tracking_number as string | null | undefined) ?? prevTracking;
    const newStatus = (data.status as string | undefined) ?? prevStatus;

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
