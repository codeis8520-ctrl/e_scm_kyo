'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';

export async function updateSafetyStock(inventoryId: string, safetyStock: number) {
  try {
    await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }

  if (safetyStock < 0) return { error: '안전재고는 0 이상이어야 합니다.' };

  const supabase = (await createClient()) as any;
  const { error } = await supabase
    .from('inventories')
    .update({ safety_stock: safetyStock })
    .eq('id', inventoryId);

  if (error) return { error: error.message };

  revalidatePath('/inventory');
  return { success: true };
}

export async function bulkUpdateSafetyStock(productId: string, safetyStock: number) {
  try {
    await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }

  if (safetyStock < 0) return { error: '안전재고는 0 이상이어야 합니다.' };

  const supabase = (await createClient()) as any;
  const { error } = await supabase
    .from('inventories')
    .update({ safety_stock: safetyStock })
    .eq('product_id', productId);

  if (error) return { error: error.message };

  revalidatePath('/inventory');
  return { success: true };
}
