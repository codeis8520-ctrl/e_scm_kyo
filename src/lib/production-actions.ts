'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireSession, requireRole, writeAuditLog } from '@/lib/session';
import { kstTodayString } from '@/lib/date';

function getUserId(): string | null {
  try {
    const cookieStore = cookies();
    return (cookieStore as any).get('user_id')?.value || null;
  } catch {
    return null;
  }
}

function genProductionNumber(): string {
  const date = kstTodayString().replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `WO-${date}-${rand}`;
}

// 단위(unit) 표시 방어 — 빈 문자열 또는 숫자만이면 '개'로 대체.
// products.unit 데이터에 "1" 같은 숫자 문자열이 들어있으면
// "40{unit}" 식으로 붙여 표시할 때 "401"처럼 오인되는 문제 방지.
function normalizeUnit(raw: any): string {
  const s = String(raw ?? '').trim();
  return s && !/^\d+$/.test(s) ? s : '개';
}

// 본사(is_headquarters=true) 지점 조회.
// - 마이그 047 미적용이면 컬럼 자체가 없어 에러 → kind='no_column'
// - 적용됐지만 지정이 안 됐으면 kind='no_hq'
async function loadHeadquartersBranch(db: any): Promise<
  | { ok: true; id: string; name: string }
  | { ok: false; kind: 'no_column' | 'no_hq' | 'error'; message: string }
> {
  const res = await db.from('branches').select('id, name').eq('is_headquarters', true).maybeSingle();
  if (res.error) {
    if (isMissingColumnError(res.error)) {
      return { ok: false, kind: 'no_column', message: '마이그레이션 047 미적용 — branches.is_headquarters 컬럼이 없습니다.' };
    }
    return { ok: false, kind: 'error', message: res.error.message };
  }
  if (!res.data) {
    return { ok: false, kind: 'no_hq', message: '본사 지점이 지정되지 않았습니다. 지점 관리에서 본사(is_headquarters)를 먼저 지정하세요.' };
  }
  return { ok: true, id: res.data.id, name: res.data.name };
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

// BOM 전체 저장 (완제품 하나의 BOM 일괄 wipe + bulk insert)
//
// 이전엔 lines 배열을 순차 for 루프로 row 단위 update/insert (round trip × N).
// BOM 10행이면 직렬 supabase 호출 10번 → 2초+. 마이그 폴백 재시도 시 최대 20번.
// 단순 lookup table 이라 "전체 wipe → bulk insert" 트랜잭션 의미 동일.
// 새 패턴: 1 RT (delete) + 1 RT (bulk insert) + 1 RT (cost) = ≈600ms.
export async function saveBom(productId: string, lines: BomLine[]) {
  if (!productId) return { error: '완제품이 지정되지 않았습니다.' };
  const supabase = await createClient();
  const db = supabase as any;

  // 1) 전체 wipe — 기존 행 모두 삭제
  const { error: delErr } = await db.from('product_bom').delete().eq('product_id', productId);
  if (delErr) {
    console.error('[saveBom] wipe failed:', delErr);
    return { error: `기존 BOM 삭제 실패: ${delErr.message}` };
  }

  // 2) 유효 라인만 추출 (material_id 있고 quantity > 0)
  const validLines = lines.filter(l => l.material_id && l.quantity > 0);

  if (validLines.length > 0) {
    // enhanced 행 (loss_rate/notes/sort_order 포함)
    const enhancedRows = validLines.map((l, i) => ({
      product_id: productId,
      material_id: l.material_id,
      quantity: l.quantity,
      loss_rate: l.loss_rate ?? 0,
      notes: l.notes ?? null,
      sort_order: l.sort_order ?? i,
    }));

    // 3) bulk insert — 1 round trip
    let { error } = await db.from('product_bom').insert(enhancedRows);

    // 마이그 미적용 환경 폴백 — loss_rate/notes/sort_order 컬럼 없으면 minimal 재시도
    if (error && isMissingColumnError(error)) {
      const minimalRows = validLines.map(l => ({
        product_id: productId,
        material_id: l.material_id,
        quantity: l.quantity,
      }));
      const retry = await db.from('product_bom').insert(minimalRows);
      error = retry.error;
    }
    if (error) {
      console.error('[saveBom] bulk insert failed:', error);
      return { error: `행 추가 실패: ${error.message}` };
    }
  }

  // 4) BOM 변경 → cost_source='BOM'인 완제품은 자동 원가 재산정
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

// 상태별 카운트 — 상단 통계 카드용. 상태 필터는 무시하고 지점·공장 필터만 적용.
async function loadProductionStatusStats(
  db: any,
  branchId?: string,
  factoryId?: string,
): Promise<{ pending: number; inProgress: number; completed: number }> {
  const statuses: Array<'PENDING' | 'IN_PROGRESS' | 'COMPLETED'> = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];
  const counts = await Promise.all(statuses.map(async (s) => {
    let q = db.from('production_orders').select('id', { count: 'exact', head: true }).eq('status', s);
    if (branchId)  q = q.eq('branch_id', branchId);
    if (factoryId) q = q.eq('oem_factory_id', factoryId);
    let res = await q;
    // 마이그 047 미적용 시 oem_factory_id 컬럼이 없어 실패 → factory 필터 생략 재시도
    if (res.error && factoryId && isMissingColumnError(res.error)) {
      let q2 = db.from('production_orders').select('id', { count: 'exact', head: true }).eq('status', s);
      if (branchId) q2 = q2.eq('branch_id', branchId);
      res = await q2;
    }
    if (res.error) return 0;
    return res.count ?? 0;
  }));
  return { pending: counts[0], inProgress: counts[1], completed: counts[2] };
}

export async function getProductionOrders(filters?: {
  branchId?: string;
  status?: string;
  factoryId?: string;
  productIds?: string[]; // 카테고리·유형 필터로 미리 좁힌 제품 id 목록
  page?: number;
  pageSize?: number;
  dateFrom?: string; // YYYY-MM-DD (KST 캘린더 date)
  dateTo?: string;   // YYYY-MM-DD
}) {
  const supabase = await createClient();
  const db = supabase as any;

  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, filters?.pageSize ?? 30));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // YYYY-MM-DD → ISO 경계. KST 자정 기준으로 +09:00 오프셋 명시.
  const fromIso = filters?.dateFrom ? `${filters.dateFrom}T00:00:00+09:00` : undefined;
  const toIso   = filters?.dateTo   ? `${filters.dateTo}T23:59:59+09:00`   : undefined;

  // oem_factory join 시도 → 컬럼이 없으면(마이그 047 미적용) 폴백
  const baseCols = '*, product:products(id, name, code, product_type, category_id), branch:branches(id, name), produced_by_user:users!production_orders_produced_by_fkey(name)';
  let sel = `${baseCols}, factory:oem_factories(id, name, code)`;

  let q = db
    .from('production_orders')
    .select(sel, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (filters?.branchId)  q = q.eq('branch_id', filters.branchId);
  if (filters?.factoryId) q = q.eq('oem_factory_id', filters.factoryId);
  if (filters?.status)    q = q.eq('status', filters.status);
  if (fromIso) q = q.gte('created_at', fromIso);
  if (toIso)   q = q.lte('created_at', toIso);
  if (filters?.productIds && filters.productIds.length > 0) {
    q = q.in('product_id', filters.productIds);
  }

  let { data, error, count } = await q;
  if (error && isMissingColumnError(error)) {
    let q2 = db
      .from('production_orders')
      .select(baseCols, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters?.branchId) q2 = q2.eq('branch_id', filters.branchId);
    if (filters?.status)   q2 = q2.eq('status', filters.status);
    if (fromIso) q2 = q2.gte('created_at', fromIso);
    if (toIso)   q2 = q2.lte('created_at', toIso);
    if (filters?.productIds && filters.productIds.length > 0) {
      q2 = q2.in('product_id', filters.productIds);
    }
    const r = await q2;
    data = r.data; error = r.error; count = r.count;
  }

  const stats = await loadProductionStatusStats(db, filters?.branchId, filters?.factoryId);
  if (error) return { data: [], count: 0, stats, error: error.message };
  return { data: data || [], count: count ?? 0, stats };
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
//   OEM 위탁 모델:
//     - 부자재는 "본사(is_headquarters=true) 재고"에서만 차감 (본사 조달 원칙)
//     - 완제품은 생산 지시의 "입고 지점(branch_id)"에 증가
//   원재료는 BOM에 등록하지 않음(OEM 자체 조달).

export async function completeProductionOrder(id: string) {
  const supabase = await createClient();
  const db = supabase as any;

  const { data: order } = await db
    .from('production_orders')
    .select('*, branch_id, product_id, quantity, order_number, produced_by, branch:branches!branch_id(id, name)')
    .eq('id', id)
    .single();

  if (!order || order.status !== 'IN_PROGRESS') {
    return { error: '진행중 상태의 생산 지시만 완료 처리할 수 있습니다.' };
  }

  const receivingBranchId = order.branch_id;
  if (!receivingBranchId) return { error: '입고 지점 정보가 없습니다.' };
  const receivingBranchName = order.branch?.name || receivingBranchId;

  // 부자재 차감 지점 = 본사 (정책: 부자재는 본사에서만 관리)
  const hqRes = await loadHeadquartersBranch(db);
  if (!hqRes.ok) {
    if (hqRes.kind === 'no_column') {
      return { error: `${hqRes.message} 마이그 적용 후 본사 지점을 지정해야 생산 완료가 가능합니다.` };
    }
    return { error: hqRes.message };
  }
  const hqBranchId = hqRes.id;

  // ─ BOM 부자재 소요량 계산 (음수 재고 허용 — 사전 차단 없음) ──────────────
  const { data: bomItems } = await db
    .from('product_bom')
    .select('material_id, quantity, loss_rate, material:products!product_bom_material_id_fkey(name, unit)')
    .eq('product_id', order.product_id);

  type Deduction = { invId: string | null; materialId: string; currentQty: number; required: number; name: string; unit: string };
  const deductions: Deduction[] = [];

  // 음수 재고 허용 — 부자재 부족해도 마이너스로 차감하고 진행 (추후 입고 시 누적 복원)
  for (const item of (bomItems as any[] || [])) {
    const lossRate = Number(item.loss_rate || 0);
    const required = Math.ceil(Number(item.quantity) * order.quantity * (1 + lossRate / 100));
    if (required <= 0) continue;

    const { data: matInv } = await db
      .from('inventories').select('id, quantity')
      .eq('branch_id', hqBranchId).eq('product_id', item.material_id).maybeSingle();

    const curQty = matInv?.quantity ?? 0;
    const name = item.material?.name || '(이름없음)';
    const unit = normalizeUnit(item.material?.unit);

    deductions.push({
      invId: matInv?.id ?? null,
      materialId: item.material_id,
      currentQty: curQty,
      required, name, unit,
    });
  }

  try {
    // ① 부자재 차감 — 본사 재고에서 + 이동 기록도 본사 지점에 기록
    //    레코드가 없으면 음수로 신규 생성, 부족 시 마이너스 누적
    for (const d of deductions) {
      const after = d.currentQty - d.required;
      if (d.invId) {
        await db.from('inventories').update({ quantity: after }).eq('id', d.invId);
      } else {
        await db.from('inventories').insert({
          branch_id: hqBranchId,
          product_id: d.materialId,
          quantity: after,
          safety_stock: 0,
        });
      }
      await db.from('inventory_movements').insert({
        branch_id: hqBranchId,
        product_id: d.materialId,
        movement_type: 'PRODUCTION',
        quantity: d.required,
        reference_id: id,
        reference_type: 'PRODUCTION_ORDER',
        memo: `부자재 소진: ${order.order_number} (${order.quantity}개 생산 · 입고 ${receivingBranchName})`,
      });
    }

    // ② 완제품 재고 증가 — 지시에 지정된 입고 지점으로
    const { data: productInv } = await db
      .from('inventories')
      .select('id, quantity')
      .eq('branch_id', receivingBranchId)
      .eq('product_id', order.product_id)
      .maybeSingle();

    if (productInv) {
      await db.from('inventories')
        .update({ quantity: productInv.quantity + order.quantity })
        .eq('id', productInv.id);
    } else {
      await db.from('inventories').insert({
        branch_id: receivingBranchId,
        product_id: order.product_id,
        quantity: order.quantity,
        safety_stock: 0,
      });
    }

    await db.from('inventory_movements').insert({
      branch_id: receivingBranchId,
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

// ─── 재료 소요량 미리보기 ───────────────────────────────────────────────────
//   생산 지시 모달에서 BOM 기반 예상 원가 + 본사 재고 대비 부족 여부를 표시.
//   실제 차감은 completeProductionOrder 가 본사 재고에서 수행.

export async function getProductionPreview(productId: string, _branchId: string, quantity: number) {
  if (!productId || quantity < 1) return { data: [], hq: null };

  const supabase = await createClient();
  const db = supabase as any;

  const { data: bomItems } = await db
    .from('product_bom')
    .select('material_id, quantity, loss_rate, material:products!product_bom_material_id_fkey(name, unit, cost, product_type)')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });

  if (!bomItems || bomItems.length === 0) return { data: [], hq: null };

  // 본사 지점 조회 — 컬럼 없거나 미지정이면 hq=null (UI에서 '—' 표시)
  const hqRes = await loadHeadquartersBranch(db);
  const hq = hqRes.ok ? { id: hqRes.id, name: hqRes.name } : null;

  // 본사 재고를 한 번의 쿼리로
  let hqStockByMaterial: Record<string, number> = {};
  if (hq) {
    const materialIds = (bomItems as any[]).map((b: any) => b.material_id);
    const { data: invs } = await db
      .from('inventories')
      .select('product_id, quantity')
      .eq('branch_id', hq.id)
      .in('product_id', materialIds);
    for (const row of ((invs || []) as any[])) {
      hqStockByMaterial[row.product_id] = Number(row.quantity || 0);
    }
  }

  const preview = (bomItems as any[]).map((item: any) => {
    const lossRate = Number(item.loss_rate || 0);
    const base = Number(item.quantity) * quantity;
    const required = base * (1 + lossRate / 100);
    const hq_stock = hq ? (hqStockByMaterial[item.material_id] ?? 0) : null;
    return {
      material_id: item.material_id,
      material_name: item.material?.name,
      material_type: item.material?.product_type,
      unit: normalizeUnit(item.material?.unit),
      cost: item.material?.cost || 0,
      base_required: base,
      loss_rate: lossRate,
      required,
      hq_stock,
      hq_shortage: hq_stock !== null ? Math.max(0, Math.ceil(required) - hq_stock) : null,
    };
  });

  return { data: preview, hq };
}
