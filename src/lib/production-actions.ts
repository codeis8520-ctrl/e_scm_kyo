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
  const { data, error } = await (supabase as any)
    .from('product_bom')
    .select('*, product:products(id, name, code, product_type), material:products!product_bom_material_id_fkey(id, name, code, unit, cost, product_type)')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
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

// BOM 전체 저장 (완제품 하나의 BOM 일괄 upsert + 제거)
export async function saveBom(productId: string, lines: BomLine[]) {
  if (!productId) return { error: '완제품이 지정되지 않았습니다.' };
  const supabase = await createClient();
  const db = supabase as any;

  // 기존 행 조회 → 삭제 대상 추출
  const { data: existing } = await db
    .from('product_bom')
    .select('id, material_id')
    .eq('product_id', productId);

  const existingIds: string[] = (existing || []).map((r: any) => r.id);
  const keepIds = new Set(lines.filter(l => l.id).map(l => l.id!));
  const toDelete = existingIds.filter(id => !keepIds.has(id));

  if (toDelete.length > 0) {
    const { error: delErr } = await db.from('product_bom').delete().in('id', toDelete);
    if (delErr) return { error: `기존 행 삭제 실패: ${delErr.message}` };
  }

  // upsert: id 있는 행은 update, 없는 행은 insert
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.material_id || line.quantity <= 0) continue;
    const payload = {
      product_id: productId,
      material_id: line.material_id,
      quantity: line.quantity,
      loss_rate: line.loss_rate ?? 0,
      notes: line.notes ?? null,
      sort_order: line.sort_order ?? i,
    };
    if (line.id) {
      const { error } = await db.from('product_bom').update(payload).eq('id', line.id);
      if (error) return { error: `행 업데이트 실패: ${error.message}` };
    } else {
      const { error } = await db.from('product_bom').insert(payload);
      if (error) return { error: `행 추가 실패: ${error.message}` };
    }
  }

  revalidatePath('/production');
  return { success: true };
}

export async function deleteBom(id: string) {
  const supabase = await createClient();
  const { error } = await (supabase as any).from('product_bom').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/production');
  return { success: true };
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
