'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireSession, requireRole, writeAuditLog } from '@/lib/session';

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

export async function getProductionOrders(filters?: { branchId?: string; status?: string; factoryId?: string }) {
  const supabase = await createClient();
  const db = supabase as any;

  // oem_factory join 시도 → 컬럼이 없으면(마이그 047 미적용) 폴백
  const baseCols = '*, product:products(id, name, code), branch:branches(id, name), produced_by_user:users!production_orders_produced_by_fkey(name)';
  let sel = `${baseCols}, factory:oem_factories(id, name, code)`;

  let q = db.from('production_orders').select(sel).order('created_at', { ascending: false }).limit(100);
  if (filters?.branchId)  q = q.eq('branch_id', filters.branchId);
  if (filters?.factoryId) q = q.eq('oem_factory_id', filters.factoryId);
  if (filters?.status)    q = q.eq('status', filters.status);

  let { data, error } = await q;
  if (error && isMissingColumnError(error)) {
    let q2 = db.from('production_orders').select(baseCols).order('created_at', { ascending: false }).limit(100);
    if (filters?.branchId) q2 = q2.eq('branch_id', filters.branchId);
    if (filters?.status)   q2 = q2.eq('status', filters.status);
    const r = await q2;
    data = r.data; error = r.error;
  }

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

// ─── 생산 지시 생성 (PENDING) ──────────────────────────────────────────────────
//   OEM 위탁 모델: 본사에서만 지시. 공장이 재료를 자체 조달하므로 재고 사전 검증 없음.
//   branch_id = 완제품 입고 지점 (기본: 본사)

export async function createProductionOrder(formData: FormData) {
  let session;
  try { session = await requireRole(['SUPER_ADMIN', 'HQ_OPERATOR']); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;
  const userId = session.id;

  const productId = formData.get('product_id') as string;
  const branchId  = formData.get('branch_id') as string; // 입고 지점
  const factoryId = (formData.get('oem_factory_id') as string) || null;
  const quantity  = parseInt(formData.get('quantity') as string);
  const memo      = (formData.get('memo') as string) || null;

  if (!productId || !branchId || !quantity || quantity < 1) {
    return { error: '필수 항목을 입력해주세요.' };
  }

  const orderNumber = genProductionNumber();

  const row: any = {
    order_number: orderNumber,
    product_id: productId,
    branch_id: branchId,
    quantity,
    status: 'PENDING',
    produced_by: userId,
    memo,
  };
  if (factoryId) row.oem_factory_id = factoryId;

  let { error } = await db.from('production_orders').insert(row);
  // 마이그 047 미적용 시 폴백(공장 없이 등록)
  if (error && isMissingColumnError(error) && factoryId) {
    delete row.oem_factory_id;
    const retry = await db.from('production_orders').insert(row);
    error = retry.error;
  }

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

// ─── 생산 완료 (IN_PROGRESS → COMPLETED) ──────────────────────────────────────
//   OEM 위탁 모델: 완제품을 입고 지점(branch_id)에 증가 + BOM에 등록된 부자재를
//   입고 지점 재고에서 차감(본사 → OEM 조달). 원재료는 BOM 미등록 원칙(OEM 자체 조달).

export async function completeProductionOrder(id: string) {
  const supabase = await createClient();
  const db = supabase as any;

  const { data: order } = await db
    .from('production_orders')
    .select('*, branch_id, product_id, quantity, order_number, produced_by')
    .eq('id', id)
    .single();

  if (!order || order.status !== 'IN_PROGRESS') {
    return { error: '진행중 상태의 생산 지시만 완료 처리할 수 있습니다.' };
  }

  const branchId = order.branch_id;
  if (!branchId) return { error: '입고 지점 정보가 없습니다.' };

  // ─ BOM 부자재 소요량 계산 + 재고 사전 체크 ───────────────────────────────
  const { data: bomItems } = await db
    .from('product_bom')
    .select('material_id, quantity, loss_rate, material:products!product_bom_material_id_fkey(name, unit)')
    .eq('product_id', order.product_id);

  type Deduction = { invId: string; materialId: string; currentQty: number; required: number; name: string; unit: string };
  const deductions: Deduction[] = [];

  for (const item of (bomItems as any[] || [])) {
    const lossRate = Number(item.loss_rate || 0);
    const required = Math.ceil(item.quantity * order.quantity * (1 + lossRate / 100));
    if (required <= 0) continue;

    const { data: matInv } = await db
      .from('inventories').select('id, quantity')
      .eq('branch_id', branchId).eq('product_id', item.material_id).maybeSingle();

    const curQty = matInv?.quantity ?? 0;
    const name = item.material?.name || '(이름없음)';
    const unit = item.material?.unit || '개';

    if (!matInv) {
      return { error: `부자재 "${name}" 재고 레코드 없음 — 입고 지점에 해당 자재가 등록되지 않았습니다.` };
    }
    if (curQty < required) {
      return { error: `부자재 "${name}" 재고 부족 (현재 ${curQty}${unit}, 필요 ${required}${unit})` };
    }
    deductions.push({ invId: matInv.id, materialId: item.material_id, currentQty: curQty, required, name, unit });
  }

  try {
    // ① 부자재 차감 + 이동 기록
    for (const d of deductions) {
      await db.from('inventories')
        .update({ quantity: d.currentQty - d.required })
        .eq('id', d.invId);
      await db.from('inventory_movements').insert({
        branch_id: branchId,
        product_id: d.materialId,
        movement_type: 'PRODUCTION',
        quantity: d.required,
        reference_id: id,
        reference_type: 'PRODUCTION_ORDER',
        memo: `부자재 소진: ${order.order_number} (${order.quantity}개 생산 기준)`,
      });
    }

    // ② 완제품 재고 증가 + 이동 기록
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
      memo: `OEM 입고: ${order.order_number}`,
    });

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

// ─── 재료 소요량 미리보기 (OEM 원가 참고용) ─────────────────────────────────
//   재고 차감은 없지만, BOM 기반 예상 원가를 보여주기 위해 유지.

export async function getProductionPreview(productId: string, _branchId: string, quantity: number) {
  if (!productId || quantity < 1) return { data: [] };

  const supabase = await createClient();
  const db = supabase as any;

  const { data: bomItems } = await db
    .from('product_bom')
    .select('material_id, quantity, loss_rate, material:products!product_bom_material_id_fkey(name, unit, cost, product_type)')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });

  if (!bomItems) return { data: [] };

  const preview = bomItems.map((item: any) => {
    const lossRate = Number(item.loss_rate || 0);
    const base = item.quantity * quantity;
    const required = base * (1 + lossRate / 100);
    return {
      material_id: item.material_id,
      material_name: item.material?.name,
      material_type: item.material?.product_type,
      unit: item.material?.unit || '개',
      cost: item.material?.cost || 0,
      base_required: base,
      loss_rate: lossRate,
      required,
    };
  });

  return { data: preview };
}
