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

// ─── 재고 변동 이력 ───────────────────────────────────────────────────────────
//   특정 제품의 inventory_movements 행을 지점·유형·기간 필터와 함께 페이지네이션 조회.
//   판매(POS_SALE)·매입 입고(PURCHASE_RECEIPT)·생산(PRODUCTION_ORDER)·강제 조정(MANUAL)·
//   실사(STOCK_COUNT)·반품(RETURN)·외상 취소 복원(CREDIT_CANCEL)·지점 이동(TRANSFER) 등
//   재고를 움직이는 모든 이벤트가 기록됨.

export async function getInventoryMovements(filters: {
  productId: string;
  branchId?: string;
  movementType?: string;
  referenceType?: string;
  dateFrom?: string; // ISO 8601
  dateTo?: string;
  page?: number;
  pageSize?: number;
}) {
  try {
    await requireSession();
  } catch (e: any) {
    return { error: e.message, data: [], count: 0 };
  }

  if (!filters.productId) {
    return { error: '제품이 지정되지 않았습니다.', data: [], count: 0 };
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, filters.pageSize ?? 30));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = (await createClient()) as any;
  let q = supabase
    .from('inventory_movements')
    .select(
      'id, branch_id, product_id, movement_type, quantity, reference_id, reference_type, memo, created_at, branch:branches(id, name)',
      { count: 'exact' },
    )
    .eq('product_id', filters.productId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (filters.branchId)      q = q.eq('branch_id', filters.branchId);
  if (filters.movementType)  q = q.eq('movement_type', filters.movementType);
  if (filters.referenceType) q = q.eq('reference_type', filters.referenceType);
  if (filters.dateFrom)      q = q.gte('created_at', filters.dateFrom);
  if (filters.dateTo)        q = q.lte('created_at', filters.dateTo);

  const { data, error, count } = await q;
  if (error) return { error: error.message, data: [], count: 0 };
  return { data: data || [], count: count ?? 0 };
}
