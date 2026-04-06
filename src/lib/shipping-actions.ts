'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface ShipmentInput {
  source: 'CAFE24' | 'STORE';
  cafe24_order_id?: string;
  sales_order_id?: string;
  sender_name: string;
  sender_phone: string;
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

  const { error } = await supabase
    .from('shipments')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('updateShipment error:', error);
    return { success: false, error: error.message };
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
