'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireSession, writeAuditLog } from '@/lib/session';

function getUserId(): string | null {
  try {
    const cookieStore = cookies();
    return (cookieStore as any).get('user_id')?.value || null;
  } catch {
    return null;
  }
}

function genProductionNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `WO-${date}-${rand}`;
}

// ─── BOM ──────────────────────────────────────────────────────────────────────

export async function getBomList() {
  const supabase = await createClient();
  const db = supabase as any;
  // product_bom은 products를 두 번 참조(product_id, material_id) → FK 명시 필수
  let res = await db
    .from('product_bom')
    .select('*, product:products!product_bom_product_id_fkey(id, name, code, product_type), material:products!product_bom_material_id_fkey(id, name, code, unit, cost, product_type)')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  // 마이그레이션 042 미적용(product_type/sort_order 부재) 시 폴백
  if (res.error && isMissingColumnError(res.error)) {
    console.warn('[getBomList] 마이그레이션 042 미적용 — minimal 폴백');
    res = await db
      .from('product_bom')
      .select('*, product:products!product_bom_product_id_fkey(id, name, code), material:products!product_bom_material_id_fkey(id, name, code, unit, cost)')
      .order('created_at', { ascending: false });
  }

  if (res.error) {
    console.error('[getBomList] query failed:', res.error);
    return { data: [], error: res.error.message };
  }
  return { data: res.data || [] };
}

type BomLine = {
  id?: string;
  material_id: string;
  quantity: number;
  loss_rate?: number;
  notes?: string | null;
  sort_order?: number;
};

export async function createBom(
  productId: string,
  materialId: string,
  quantity: number,
  opts?: { loss_rate?: number; notes?: string | null; sort_order?: number },
) {
  if (!productId || !materialId || quantity <= 0) {
    return { error: '입력값이 올바르지 않습니다.' };
  }
  const supabase = await createClient();
  const { error } = await (supabase as any).from('product_bom').insert({
    product_id: productId,
    material_id: materialId,
    quantity,
    loss_rate: opts?.loss_rate ?? 0,
    notes: opts?.notes ?? null,
    sort_order: opts?.sort_order ?? 0,
  });
  if (error) return { error: error.message };
  revalidatePath('/production');
  return { success: true };
}

export async function updateBom(
  id: string,
  patch: { quantity?: number; loss_rate?: number; notes?: string | null; sort_order?: number },
) {
  if (!id) return { error: 'id가 필요합니다.' };
  const supabase = await createClient();
  const { error } = await (supabase as any).from('product_bom').update(patch).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/production');
  return { success: true };
}

// 마이그레이션 042 미적용(loss_rate/notes/sort_order 컬럼 부재) 대응
function isMissingColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  const code = String(err.code || '');
  return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
}

// ─── BOM 기반 원가 산정 (자동 롤업) ─────────────────────────────────────────────
//   완제품 1단위 원가 = Σ(자재 원가 × quantity × (1 + loss_rate/100))
export async function computeBomCost(productId: string): Promise<number> {
  if (!productId) return 0;
  const supabase = await createClient();
  const { data } = await (supabase as any)
    .from('product_bom')
    .select('quantity, loss_rate, material:products!product_bom_material_id_fkey(cost)')
    .eq('product_id', productId);

  if (!data || data.length === 0) return 0;
  let total = 0;
  for (const row of data as any[]) {
    const matCost = Number(row.material?.cost || 0);
    const qty = Number(row.quantity || 0) * (1 + Number(row.loss_rate || 0) / 100);
    total += matCost * qty;
  }
  return Math.round(total);
}

// cost_source='BOM'인 완제품만 products.cost 갱신
async function applyBomCostIfAuto(db: any, productId: string): Promise<void> {
  if (!productId) return;
  const { data: product } = await db
    .from('products')
    .select('id, product_type, cost_source')
    .eq('id', productId)
    .maybeSingle();
  if (!product) return;
  if (product.product_type !== 'FINISHED') return;
  if (product.cost_source !== 'BOM') return;

  const cost = await computeBomCost(productId);
  await db.from('products').update({ cost }).eq('id', productId);
}

// 자재(RAW/SUB)의 cost가 변경됐거나 BOM 행이 바뀌었을 때,
// 해당 자재를 사용하는 완제품 중 cost_source='BOM'인 것들의 원가 갱신
async function applyBomCostForMaterialConsumers(db: any, materialId: string): Promise<void> {
  if (!materialId) return;
  const { data: rows } = await db
    .from('product_bom')
    .select('product_id')
    .eq('material_id', materialId);
  const ids = [...new Set(((rows || []) as any[]).map((r: any) => r.product_id))];
  for (const pid of ids) {
    await applyBomCostIfAuto(db, pid as string);
  }
}

// BOM 전체 저장 (완제품 하나의 BOM 일괄 upsert + 제거)
export async function saveBom(productId: string, lines: BomLine[]) {
  if (!productId) return { error: '완제품이 지정되지 않았습니다.' };
  const supabase = await createClient();
  const db = supabase as any;

  // 기존 행 조회 → 삭제 대상 추출
  const { data: existing, error: existErr } = await db
    .from('product_bom')
    .select('id, material_id')
    .eq('product_id', productId);

  if (existErr) {
    console.error('[saveBom] existing query failed:', existErr);
    return { error: `기존 BOM 조회 실패: ${existErr.message}` };
  }

  const existingIds: string[] = (existing || []).map((r: any) => r.id);
  const keepIds = new Set(lines.filter(l => l.id).map(l => l.id!));
  const toDelete = existingIds.filter(id => !keepIds.has(id));

  if (toDelete.length > 0) {
    const { error: delErr } = await db.from('product_bom').delete().in('id', toDelete);
    if (delErr) {
      console.error('[saveBom] delete failed:', delErr);
      return { error: `기존 행 삭제 실패: ${delErr.message}` };
    }
  }

  // 한 번은 enhanced(loss_rate/notes/sort_order 포함), 실패 시 minimal로 재시도
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.material_id || line.quantity <= 0) continue;

    const enhanced: any = {
      product_id: productId,
      material_id: line.material_id,
      quantity: line.quantity,
      loss_rate: line.loss_rate ?? 0,
      notes: line.notes ?? null,
      sort_order: line.sort_order ?? i,
    };
    const minimal: any = {
      product_id: productId,
      material_id: line.material_id,
      quantity: line.quantity,
    };

    if (line.id) {
      let { error } = await db.from('product_bom').update(enhanced).eq('id', line.id);
      if (error && isMissingColumnError(error)) {
        const retry = await db.from('product_bom').update(minimal).eq('id', line.id);
        error = retry.error;
      }
      if (error) {
        console.error('[saveBom] update failed:', error);
        return { error: `행 업데이트 실패: ${error.message}` };
      }
    } else {
      let { error } = await db.from('product_bom').insert(enhanced);
      if (error && isMissingColumnError(error)) {
        const retry = await db.from('product_bom').insert(minimal);
        error = retry.error;
      }
      if (error) {
        console.error('[saveBom] insert failed:', error);
        return { error: `행 추가 실패: ${error.message}` };
      }
    }
  }

  // BOM 변경 → cost_source='BOM'인 완제품은 자동 원가 재산정
  try {
    await applyBomCostIfAuto(db, productId);
  } catch (err) {
    console.error('[saveBom] applyBomCostIfAuto failed (ignored):', err);
  }

  revalidatePath('/production');
  revalidatePath('/products');
  return { success: true };
}

export async function deleteBom(id: string) {
  const supabase = await createClient();
  const { error } = await (supabase as any).from('product_bom').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/production');
  return { success: true };
}

// ─── BOM 복사 · Where-used ───────────────────────────────────────────────────

// 특정 완제품의 BOM 라인 (복사 소스로 사용)
export async function getBomByProduct(productId: string) {
  if (!productId) return { data: [] };
  const supabase = await createClient();
  const db = supabase as any;
  let res = await db
    .from('product_bom')
    .select('id, material_id, quantity, loss_rate, notes, sort_order, material:products!product_bom_material_id_fkey(id, name, code, unit, cost, product_type)')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });
  if (res.error && isMissingColumnError(res.error)) {
    res = await db
      .from('product_bom')
      .select('id, material_id, quantity, material:products!product_bom_material_id_fkey(id, name, code, unit, cost)')
      .eq('product_id', productId);
  }
  if (res.error) return { data: [], error: res.error.message };
  return { data: res.data || [] };
}

// 특정 자재(RAW/SUB)를 사용하는 완제품 목록 (where-used)
export async function getWhereUsed(materialId: string) {
  if (!materialId) return { data: [] };
  const supabase = await createClient();
  const db = supabase as any;
  let res = await db
    .from('product_bom')
    .select('id, quantity, loss_rate, notes, product:products!product_bom_product_id_fkey(id, name, code, unit, cost, product_type, cost_source)')
    .eq('material_id', materialId)
    .order('created_at', { ascending: false });
  if (res.error && isMissingColumnError(res.error)) {
    res = await db
      .from('product_bom')
      .select('id, quantity, product:products!product_bom_product_id_fkey(id, name, code, unit, cost)')
      .eq('material_id', materialId);
  }
  if (res.error) return { data: [], error: res.error.message };
  return { data: res.data || [] };
}

// ─── 생산 지시 조회 ────────────────────────────────────────────────────────────

export async function getProductionOrders(filters?: { branchId?: string; status?: string }) {
  const supabase = await createClient();
  let q = (supabase as any)
    .from('production_orders')
    .select('*, product:products(id, name, code), branch:branches(id, name), produced_by_user:users!production_orders_produced_by_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (filters?.branchId) q = q.eq('branch_id', filters.branchId);
  if (filters?.status)   q = q.eq('status', filters.status);

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

// ─── 생산 지시 생성 (PENDING) ──────────────────────────────────────────────────

export async function createProductionOrder(formData: FormData) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;
  const userId = session.id;

  const productId = formData.get('product_id') as string;
  const branchId  = formData.get('branch_id') as string;
  const quantity  = parseInt(formData.get('quantity') as string);
  const memo      = formData.get('memo') as string || null;

  if (!productId || !branchId || !quantity || quantity < 1) {
    return { error: '필수 항목을 입력해주세요.' };
  }

  // BOM 검증
  const { data: bomItems } = await db
    .from('product_bom')
    .select('material_id, quantity, loss_rate, material:products!product_bom_material_id_fkey(name)')
    .eq('product_id', productId);

  if (!bomItems || bomItems.length === 0) {
    return { error: '이 제품에는 BOM 정보가 없습니다.' };
  }

  // 재고 충분 여부 사전 확인 (지시 시점) — 손실률 반영
  for (const item of bomItems) {
    const { data: inv } = await db
      .from('inventories')
      .select('quantity')
      .eq('branch_id', branchId)
      .eq('product_id', item.material_id)
      .maybeSingle();

    const required = item.quantity * quantity * (1 + Number(item.loss_rate || 0) / 100);
    if (!inv || inv.quantity < required) {
      return { error: `원재료 "${item.material?.name}" 재고 부족 (필요: ${required.toFixed(3)}, 현재: ${inv?.quantity ?? 0})` };
    }
  }

  const orderNumber = genProductionNumber();

  const { error } = await db.from('production_orders').insert({
    order_number: orderNumber,
    product_id: productId,
    branch_id: branchId,
    quantity,
    status: 'PENDING',
    produced_by: userId,
    memo,
  });

  if (error) return { error: error.message };

  writeAuditLog({ userId, action: 'CREATE', tableName: 'production_orders', description: `생산 지시: ${orderNumber}` }).catch(() => {});
  revalidatePath('/production');
  return { success: true, orderNumber };
}

// ─── 생산 착수 (PENDING → IN_PROGRESS) ────────────────────────────────────────

export async function startProductionOrder(id: string) {
  const supabase = await createClient();
  const db = supabase as any;

  const { data: order } = await db
    .from('production_orders')
    .select('status')
    .eq('id', id)
    .single();

  if (!order || order.status !== 'PENDING') {
    return { error: '대기 상태의 생산 지시만 착수할 수 있습니다.' };
  }

  const { error } = await db
    .from('production_orders')
    .update({ status: 'IN_PROGRESS', started_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/production');
  return { success: true };
}

// ─── 생산 완료 (IN_PROGRESS → COMPLETED) + 재고 처리 ──────────────────────────

export async function completeProductionOrder(id: string) {
  const supabase = await createClient();
  const db = supabase as any;

  const { data: order } = await db
    .from('production_orders')
    .select('*, branch_id, product_id, quantity, order_number')
    .eq('id', id)
    .single();

  if (!order || order.status !== 'IN_PROGRESS') {
    return { error: '진행중 상태의 생산 지시만 완료 처리할 수 있습니다.' };
  }

  const branchId = order.branch_id;
  if (!branchId) return { error: '지점 정보가 없습니다.' };

  // BOM 조회 (손실률 포함)
  const { data: bomItems } = await db
    .from('product_bom')
    .select('material_id, quantity, loss_rate, material:products!product_bom_material_id_fkey(name)')
    .eq('product_id', order.product_id);

  if (!bomItems || bomItems.length === 0) {
    return { error: 'BOM 정보가 없습니다.' };
  }

  // 재고 충분 여부 재확인 (착수 이후 변동 가능) — 손실률 반영
  for (const item of bomItems) {
    const { data: inv } = await db
      .from('inventories')
      .select('quantity')
      .eq('branch_id', branchId)
      .eq('product_id', item.material_id)
      .maybeSingle();

    const required = item.quantity * order.quantity * (1 + Number(item.loss_rate || 0) / 100);
    if (!inv || inv.quantity < required) {
      return { error: `원재료 "${item.material?.name}" 재고 부족 (필요: ${required.toFixed(3)}, 현재: ${inv?.quantity ?? 0})` };
    }
  }

  try {
    // 원재료 재고 차감 + 이동 기록 (손실률 반영)
    for (const item of bomItems) {
      const required = item.quantity * order.quantity * (1 + Number(item.loss_rate || 0) / 100);

      const { data: inv } = await db
        .from('inventories')
        .select('id, quantity')
        .eq('branch_id', branchId)
        .eq('product_id', item.material_id)
        .single();

      await db.from('inventories')
        .update({ quantity: inv.quantity - required })
        .eq('id', inv.id);

      await db.from('inventory_movements').insert({
        branch_id: branchId,
        product_id: item.material_id,
        movement_type: 'PRODUCTION',
        quantity: -required,
        reference_id: id,
        reference_type: 'PRODUCTION_ORDER',
        memo: `생산 차감: ${order.order_number}${Number(item.loss_rate) > 0 ? ` (손실률 ${item.loss_rate}%)` : ''}`,
      });
    }

    // 완제품 재고 증가 + 이동 기록
    const { data: productInv } = await db
      .from('inventories')
      .select('id, quantity')
      .eq('branch_id', branchId)
      .eq('product_id', order.product_id)
      .maybeSingle();

    if (productInv) {
      await db.from('inventories')
        .update({ quantity: productInv.quantity + order.quantity })
        .eq('id', productInv.id);
    } else {
      await db.from('inventories').insert({
        branch_id: branchId,
        product_id: order.product_id,
        quantity: order.quantity,
        safety_stock: 0,
      });
    }

    await db.from('inventory_movements').insert({
      branch_id: branchId,
      product_id: order.product_id,
      movement_type: 'IN',
      quantity: order.quantity,
      reference_id: id,
      reference_type: 'PRODUCTION_ORDER',
      memo: `생산 입고: ${order.order_number}`,
    });

    // 상태 완료 처리
    await db.from('production_orders').update({
      status: 'COMPLETED',
      produced_at: new Date().toISOString(),
    }).eq('id', id);

  } catch (err: any) {
    return { error: `생산 완료 처리 실패: ${err.message}` };
  }

  writeAuditLog({ userId: order.produced_by, action: 'UPDATE', tableName: 'production_orders', recordId: id, description: `생산 완료: ${order.order_number}` }).catch(() => {});
  revalidatePath('/production');
  revalidatePath('/inventory');
  return { success: true };
}

// ─── 생산 취소 ─────────────────────────────────────────────────────────────────

export async function cancelProductionOrder(id: string) {
  const supabase = await createClient();
  const db = supabase as any;

  const { data: order } = await db
    .from('production_orders')
    .select('status')
    .eq('id', id)
    .single();

  if (!order || !['PENDING', 'IN_PROGRESS'].includes(order.status)) {
    return { error: '대기 또는 진행중 상태만 취소할 수 있습니다.' };
  }

  const { error } = await db
    .from('production_orders')
    .update({ status: 'CANCELLED' })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/production');
  return { success: true };
}

// ─── 재료 소요량 미리보기 ──────────────────────────────────────────────────────

export async function getProductionPreview(productId: string, branchId: string, quantity: number) {
  if (!productId || !branchId || quantity < 1) return { data: [] };

  const supabase = await createClient();
  const db = supabase as any;

  const { data: bomItems } = await db
    .from('product_bom')
    .select('material_id, quantity, loss_rate, material:products!product_bom_material_id_fkey(name, unit, cost, product_type)')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });

  if (!bomItems) return { data: [] };

  const preview = await Promise.all(
    bomItems.map(async (item: any) => {
      const { data: inv } = await db
        .from('inventories')
        .select('quantity')
        .eq('branch_id', branchId)
        .eq('product_id', item.material_id)
        .maybeSingle();

      const lossRate = Number(item.loss_rate || 0);
      const base = item.quantity * quantity;
      const required = base * (1 + lossRate / 100);
      const available = inv?.quantity ?? 0;
      return {
        material_id: item.material_id,
        material_name: item.material?.name,
        material_type: item.material?.product_type,
        unit: item.material?.unit || '개',
        cost: item.material?.cost || 0,
        base_required: base,
        loss_rate: lossRate,
        required,
        available,
        shortage: Math.max(0, required - available),
      };
    })
  );

  return { data: preview };
}
