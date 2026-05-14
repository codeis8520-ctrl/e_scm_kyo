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

// ─── 박스 분해/재포장 (Pack / Unpack) ────────────────────────────────────────
//   부모 SKU(예: 침향 30/박스)와 자식 SKU(침향 10/소포장) 간 재고 이동.
//   - direction='UNPACK': 부모 -parentQty, 자식 +parentQty * pack_child_qty
//   - direction='PACK'  : 부모 +parentQty, 자식 -parentQty * pack_child_qty
//   inventory_movements 2건 기록 (reference_type='PACK_UNPACK').
//   POS 자동 분해 X — 사용자가 재고 화면에서 수동 호출.
export async function packUnpackInventory(params: {
  parentProductId: string;
  branchId: string;
  parentQty: number;                  // 부모 기준 수량 (예: 박스 2개)
  direction: 'UNPACK' | 'PACK';
  memo?: string;
}) {
  let session: any;
  try {
    session = await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }

  const { parentProductId, branchId, parentQty, direction } = params;
  if (!parentProductId || !branchId) return { error: '필수 값 누락' };
  if (!Number.isFinite(parentQty) || parentQty <= 0) return { error: '수량은 1 이상이어야 합니다.' };

  // BRANCH/PHARMACY 사용자는 자기 지점만
  if ((session.role === 'BRANCH_STAFF' || session.role === 'PHARMACY_STAFF') && session.branch_id && session.branch_id !== branchId) {
    return { error: '본인 지점만 처리 가능' };
  }

  const supabase = (await createClient()) as any;

  // 1. 부모 제품에서 pack 메타 로드
  const { data: parent, error: pErr } = await supabase
    .from('products')
    .select('id, name, pack_child_id, pack_child_qty, track_inventory, is_phantom')
    .eq('id', parentProductId)
    .single();
  if (pErr || !parent) return { error: '부모 제품을 찾을 수 없습니다.' };
  if (!parent.pack_child_id || !parent.pack_child_qty) {
    return { error: '이 제품은 박스 분해/재포장이 설정되어 있지 않습니다.' };
  }
  // Phantom(세트) 부모는 본인 재고 없음 → 자식 SKU 만 증감. track_inventory=false 거부는 일반 제품에만 적용.
  const parentIsPhantom = parent.is_phantom === true;
  if (!parentIsPhantom && parent.track_inventory === false) {
    return { error: '재고 추적이 꺼진 제품은 분해/재포장할 수 없습니다.' };
  }

  const childId: string = parent.pack_child_id;
  const ratio: number = parent.pack_child_qty;
  const childDelta = parentQty * ratio;

  // 2. 자식 제품 검증
  const { data: child, error: cErr } = await supabase
    .from('products')
    .select('id, name, track_inventory')
    .eq('id', childId)
    .single();
  if (cErr || !child) return { error: '자식 SKU 를 찾을 수 없습니다.' };
  if (child.track_inventory === false) {
    return { error: '자식 SKU 의 재고 추적이 꺼져있습니다.' };
  }

  // 3. inventories upsert — 부모/자식 둘 다 (해당 지점에 행 없을 수 있음)
  const parentSign = direction === 'UNPACK' ? -1 : 1;
  const childSign  = direction === 'UNPACK' ? 1 : -1;

  async function applyDelta(productId: string, delta: number) {
    const { data: inv } = await supabase
      .from('inventories')
      .select('id, quantity')
      .eq('branch_id', branchId)
      .eq('product_id', productId)
      .maybeSingle();
    if (inv) {
      const next = (inv.quantity ?? 0) + delta;
      const { error } = await supabase.from('inventories').update({ quantity: next }).eq('id', inv.id);
      if (error) throw new Error(error.message);
    } else {
      // 행 없으면 신규 — 음수 허용 (재고 정책상)
      const { error } = await supabase.from('inventories').insert({
        branch_id: branchId,
        product_id: productId,
        quantity: delta,
        safety_stock: 0,
      });
      if (error) throw new Error(error.message);
    }
  }

  try {
    // Phantom 부모는 본인 재고가 없으므로 자식만 증감.
    if (!parentIsPhantom) {
      await applyDelta(parentProductId, parentSign * parentQty);
    }
    await applyDelta(childId, childSign * childDelta);
  } catch (e: any) {
    return { error: '재고 갱신 실패: ' + (e?.message || 'unknown') };
  }

  // 4. inventory_movements 기록 — quantity 는 절대값. Phantom 부모는 자식 movement 만.
  const memo = params.memo || (direction === 'UNPACK'
    ? `박스 분해: ${parent.name} ${parentQty} → ${child.name} ${childDelta}`
    : `재포장: ${child.name} ${childDelta} → ${parent.name} ${parentQty}`);

  const movements = [
    ...(parentIsPhantom ? [] : [{
      branch_id: branchId,
      product_id: parentProductId,
      movement_type: direction === 'UNPACK' ? 'OUT' : 'IN',
      quantity: parentQty,
      reference_type: 'PACK_UNPACK',
      memo,
    }]),
    {
      branch_id: branchId,
      product_id: childId,
      movement_type: direction === 'UNPACK' ? 'IN' : 'OUT',
      quantity: childDelta,
      reference_type: 'PACK_UNPACK',
      memo,
    },
  ];
  const { error: mErr } = await supabase.from('inventory_movements').insert(movements);
  if (mErr) {
    // movements 실패해도 inventories 는 이미 갱신됨 — 로그만 남기고 진행
    console.warn('[packUnpackInventory] movement insert failed:', mErr.message);
  }

  revalidatePath('/inventory');
  return {
    success: true,
    parentDelta: parentIsPhantom ? 0 : parentSign * parentQty,
    childDelta: childSign * childDelta,
    childName: child.name,
    parentIsPhantom,
  };
}
