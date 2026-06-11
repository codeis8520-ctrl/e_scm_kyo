'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession, writeAuditLog } from '@/lib/session';
import { kstTodayString } from '@/lib/date';

/**
 * 수령 전 전표 품목 추가/삭제 (Step 1)
 *
 * 대상: status=COMPLETED 이고 receipt_status !== 'RECEIVED' 인 전표.
 *   - 수령완료(RECEIVED) 또는 status≠COMPLETED 전표는 수정 불가.
 *   - receipt_status null/없음(051 미적용)도 RECEIVED로 간주 → 수정 불가(안전).
 *
 * 품목을 추가/삭제하면 그 즉시:
 *   - 재고 차감/복원 (inventory_movements OUT/IN, phantom은 BOM 분해)
 *   - total_amount/taxable/exempt/vat 스냅샷 재계산
 *   - 적립 포인트 차액 보정 (point_history adjust)
 *   - 결제 차액 기록 (sales_order_payments, PG 연동 없음 — DB 기록만)
 *   - 매출 분개 차액분 추가 (createSaleJournal sourceType='SALE_REVISE')
 *
 * 범위 밖(BUILD-LOG Known Gaps):
 *   - 주문 할인(discount_amount) 재배분 — 기존값 유지.
 *   - shipments 생성/void, delivery_type 전환 (Step 2/3).
 *   - 실제 PG/카드 취소·추가승인 — DB 기록 + 수기 안내만.
 */

// ── 컬럼 누락 판별 (42703 / "column ... does not exist") ──
function isMissingColumnError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
}

// ── 공통 가드: 주문 조회 + 수정 가능 여부 검증 ──
async function loadEditableOrder(db: any, orderId: string) {
  const { data: order, error } = await db
    .from('sales_orders')
    .select(`
      *,
      order_items:sales_order_items(*),
      branch:branches(id, name, code)
    `)
    .eq('id', orderId)
    .single();

  if (error || !order) return { error: '주문을 찾을 수 없습니다.' as string };
  if (order.status !== 'COMPLETED') {
    return { error: '완료 상태의 전표만 수정할 수 있습니다.' as string };
  }
  // null/미적용도 RECEIVED로 간주 → 수정 불가
  if (!order.receipt_status || order.receipt_status === 'RECEIVED') {
    return { error: '수령 완료된 전표는 수정할 수 없습니다.' as string };
  }
  return { order };
}

// ── 출고/재고 지점 결정 ──
//   shipments.branch_id(출고지점)가 있고 order.branch_id와 다르면 그 값을 우선.
async function resolveStockBranchId(db: any, order: any): Promise<string> {
  const { data: ship } = await db
    .from('shipments')
    .select('branch_id')
    .eq('sales_order_id', order.id)
    .maybeSingle();
  if (ship?.branch_id && ship.branch_id !== order.branch_id) return ship.branch_id;
  return order.branch_id;
}

// ── 제품 메타(과세·track_inventory·phantom) 조회 (processPosCheckout ⓪ 폴백 동일) ──
async function loadProductMeta(db: any, productId: string): Promise<
  | { error: string }
  | { name: string; isTaxable: boolean; productType: string | null; track: boolean; phantom: boolean }
> {
  let res: any = await db
    .from('products')
    .select('id, name, product_type, track_inventory, is_phantom, is_taxable')
    .eq('id', productId)
    .maybeSingle();
  if (res.error && /is_phantom/i.test(String(res.error.message))) {
    res = await db.from('products').select('id, name, product_type, track_inventory, is_taxable').eq('id', productId).maybeSingle();
  }
  if (res.error && /track_inventory/i.test(String(res.error.message))) {
    res = await db.from('products').select('id, name, product_type, is_taxable').eq('id', productId).maybeSingle();
  }
  if (res.error && /is_taxable/i.test(String(res.error.message))) {
    res = await db.from('products').select('id, name, product_type').eq('id', productId).maybeSingle();
  }
  if (res.error || !res.data) return { error: '제품을 찾을 수 없습니다.' };
  const p = res.data;
  if (p.product_type === 'RAW' || p.product_type === 'SUB') {
    return { error: '판매 가능한 제품이 아닙니다 (원·부자재).' };
  }
  const track = p.track_inventory ?? (p.product_type === 'SERVICE' ? false : true);
  return {
    name: p.name ?? productId,
    isTaxable: p.is_taxable !== false,
    productType: p.product_type ?? null,
    track,
    phantom: p.is_phantom === true,
  };
}

// ── phantom BOM 조회 ──
async function loadPhantomBom(db: any, productId: string): Promise<Array<{ material_id: string; quantity: number }>> {
  const { data } = await db
    .from('product_bom')
    .select('material_id, quantity')
    .eq('product_id', productId);
  return ((data || []) as any[]).map(r => ({ material_id: r.material_id, quantity: Number(r.quantity || 0) }));
}

// ── 재고 한 품목 증감 (movement_type OUT/IN, ref_type 지정) ──
async function adjustStock(
  db: any,
  branchId: string,
  productId: string,
  qty: number,
  movementType: 'OUT' | 'IN',
  refType: string,
  refId: string,
  memo: string,
) {
  const delta = movementType === 'OUT' ? -qty : qty;
  const { data: inv } = await db
    .from('inventories')
    .select('id, quantity')
    .eq('branch_id', branchId)
    .eq('product_id', productId)
    .maybeSingle();
  if (inv) {
    await db.from('inventories').update({ quantity: Number(inv.quantity) + delta }).eq('id', inv.id);
  } else {
    await db.from('inventories').insert({
      branch_id: branchId,
      product_id: productId,
      quantity: delta,
      safety_stock: 0,
    });
  }
  await db.from('inventory_movements').insert({
    branch_id: branchId,
    product_id: productId,
    movement_type: movementType,
    quantity: qty,
    reference_id: refId,
    reference_type: refType,
    memo,
  });
}

// ── 한 품목 재고 차감/복원 (phantom 분해 분기 포함) ──
async function applyStockForItem(
  db: any,
  branchId: string,
  meta: { track: boolean; phantom: boolean },
  productId: string,
  productName: string,
  qty: number,
  movementType: 'OUT' | 'IN',
  addRef: string,    // SALE_REVISE_ADD
  phantomRef: string, // PHANTOM_DECOMPOSE
  refId: string,
  memo: string,
) {
  if (meta.phantom) {
    const bom = await loadPhantomBom(db, productId);
    if (bom.length === 0) return; // BOM 없는 phantom: 차감 대상 없음 — skip(추가 시 가드에서 사전 차단)
    const phantomMemo = `세트분해: ${productName} ×${qty} · ${memo}`;
    for (const c of bom) {
      const total = Math.ceil(c.quantity * qty);
      if (total <= 0) continue;
      await adjustStock(db, branchId, c.material_id, total, movementType, phantomRef, refId, phantomMemo);
    }
    return;
  }
  if (!meta.track) return; // SERVICE 등 재고 비관리
  await adjustStock(db, branchId, productId, qty, movementType, addRef, refId, memo);
}

// ── 대표 결제수단 결정 (payment_info의 method가 아닌 order.payment_method 우선) ──
function representativePaymentMethod(order: any): string {
  const m = order.payment_method;
  // mixed/null이면 cash로 폴백 (분개·결제기록의 수금계정 결정용)
  if (!m || m === 'mixed') return 'cash';
  return m;
}

/**
 * 공용 재계산 — 삭제/추가 후 남은 items로 totals·과세·포인트 재산정.
 * @returns 재계산 전후 finalAmount/taxable 델타 (분개·결제기록용)
 */
async function recalcSalesOrderTotals(
  db: any,
  order: any,
): Promise<{ deltaFinal: number; deltaTaxable: number; newFinal: number }> {
  // 1) 남은 items 재조회
  const { data: items } = await db
    .from('sales_order_items')
    .select('id, product_id, quantity, unit_price')
    .eq('sales_order_id', order.id);
  const rows = (items || []) as any[];

  // 2) 새 총액 (할인 전 — sales_orders.total_amount 의미와 일치)
  const newTotal = rows.reduce((s, r) => s + Number(r.unit_price) * Number(r.quantity), 0);

  const discount = Number(order.discount_amount || 0);
  const pointsUsed = Number(order.points_used || 0);
  const newFinal = Math.max(0, newTotal - discount - pointsUsed);
  const oldFinal = Math.max(0, Number(order.total_amount || 0) - discount - pointsUsed);

  // 3) 과세/면세/VAT 스냅샷 — item별 is_taxable 비례배분 (processPosCheckout L2078~ 동일)
  let taxableAmount = 0;
  let exemptAmount = 0;
  let vatAmount = 0;
  if (rows.length > 0) {
    const productIds = Array.from(new Set(rows.map(r => r.product_id)));
    let taxRes: any = await db.from('products').select('id, is_taxable').in('id', productIds);
    if (taxRes.error && /is_taxable/i.test(String(taxRes.error.message))) {
      taxRes = await db.from('products').select('id').in('id', productIds);
    }
    const isTaxable = new Map<string, boolean>();
    for (const r of (taxRes.data as any[]) || []) {
      isTaxable.set(r.id, r.is_taxable !== false);
    }
    let taxableNet = 0;
    let exemptNet = 0;
    for (const r of rows) {
      const lineNet = Number(r.unit_price) * Number(r.quantity);
      if (isTaxable.get(r.product_id) === false) exemptNet += lineNet;
      else taxableNet += lineNet;
    }
    const net = taxableNet + exemptNet;
    if (net > 0) {
      taxableAmount = Math.round((newFinal * taxableNet) / net);
      exemptAmount = newFinal - taxableAmount;
      vatAmount = Math.round((taxableAmount * 10) / 110);
    } else {
      taxableAmount = newFinal;
      exemptAmount = 0;
      vatAmount = Math.round((taxableAmount * 10) / 110);
    }
  }

  const oldTaxable = Number(order.taxable_amount ?? oldFinal);

  // 4) 적립 포인트 재계산 — 차액만 adjust 기록
  let newEarned = Number(order.points_earned || 0);
  if (order.customer_id) {
    const rate = Number(order.point_rate_applied ?? 1.0) || 1.0;
    newEarned = Math.floor(newFinal * rate / 100);
    const diff = newEarned - Number(order.points_earned || 0);
    if (diff !== 0) {
      const { data: lastHist } = await db
        .from('point_history')
        .select('balance')
        .eq('customer_id', order.customer_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const currentBalance = Number(lastHist?.balance || 0);
      await db.from('point_history').insert({
        customer_id: order.customer_id,
        sales_order_id: order.id,
        type: 'adjust',
        points: diff,
        balance: Math.max(0, currentBalance + diff),
        description: `전표 수정 적립 조정 (${order.order_number})`,
      });
    }
  }

  // 5) sales_orders update (optional 컬럼 방어)
  const updatePayload: any = {
    total_amount: newTotal,
    taxable_amount: taxableAmount,
    exempt_amount: exemptAmount,
    vat_amount: vatAmount,
    points_earned: newEarned,
  };
  let upErr = (await db.from('sales_orders').update(updatePayload).eq('id', order.id)).error;
  if (upErr && isMissingColumnError(upErr)) {
    for (const k of ['taxable_amount', 'exempt_amount', 'vat_amount']) delete updatePayload[k];
    upErr = (await db.from('sales_orders').update(updatePayload).eq('id', order.id)).error;
  }

  return {
    deltaFinal: newFinal - oldFinal,
    deltaTaxable: taxableAmount - oldTaxable,
    newFinal,
  };
}

// ── 결제 차액 기록 (sales_order_payments) ──
// child CHECK(045+078): ('cash','card','card_keyin','kakao','credit','cod','mixed')
const PAYMENT_METHOD_ALLOWED = new Set([
  'cash', 'card', 'card_keyin', 'kakao', 'credit', 'cod', 'mixed',
]);
// 결제기록 전용 폴백: mixed는 078로 허용되어 그대로 보존, 목록 밖(null/unlisted)만 cash.
// (representativePaymentMethod는 분개 수금계정 결정용으로 mixed→cash 단순화이므로 별도.)
function paymentRecordMethod(order: any): string {
  const m = order.payment_method;
  return m && PAYMENT_METHOD_ALLOWED.has(m) ? m : 'cash';
}

// 차액 행 insert. 실패 시 호출자에 전파 — 재고·분개는 이미 조정됐는데 결제장부만
// 누락되는 정합성 깨짐을 막는다. 42703(레거시 컬럼 누락)만 폴백 재시도, 그 외(특히
// 23514 제약위반)는 삼키지 않고 에러 반환.
async function recordPaymentDelta(
  db: any, order: any, deltaFinal: number, createdBy: string,
): Promise<{ error?: string }> {
  if (deltaFinal === 0) return {};
  const memo = `전표 수정 자동 ${deltaFinal > 0 ? '추가결제' : '부분환불'} (단말기 별도처리 필요)`;
  const payload: any = {
    sales_order_id: order.id,
    payment_method: paymentRecordMethod(order),
    amount: deltaFinal, // 부호 보존 — 음수=부분환불 (Σ amount=순수금액)
    memo,
    created_by: createdBy,
  };
  let err = (await db.from('sales_order_payments').insert(payload)).error;
  if (err && isMissingColumnError(err)) {
    delete payload.created_by;
    err = (await db.from('sales_order_payments').insert(payload)).error;
  }
  if (err) {
    console.error('[recordPaymentDelta] insert failed:', err);
    return { error: `결제 차액 기록 실패: ${err.message ?? err}` };
  }
  return {};
}

// ── 매출 분개 차액분 추가 (createSaleJournal sourceType='SALE_REVISE') ──
async function recordJournalDelta(
  db: any,
  order: any,
  deltaFinal: number,
  deltaTaxable: number,
  createdBy: string,
) {
  if (deltaFinal === 0) return;
  try {
    const { createSaleJournal } = await import('@/lib/accounting-actions');
    await createSaleJournal({
      orderId: order.id,
      orderNumber: `REVISE-${order.order_number}`,
      orderDate: kstTodayString(),
      totalAmount: deltaFinal,
      taxableAmount: deltaTaxable,
      paymentMethod: representativePaymentMethod(order),
      cogs: 0,
      sourceType: 'SALE_REVISE',
      createdBy,
    });
  } catch {
    // 분개 실패는 경고만 — 전표 수정 자체는 진행 (cancelSalesOrder 동일)
  }
}

/**
 * 품목 추가
 */
export async function addSalesOrderItem(params: {
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  orderOption?: string | null;
  deliveryType?: 'PICKUP' | 'PARCEL' | 'QUICK';
}): Promise<{ success?: true; delta?: number; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  if (!params.productId) return { error: '제품을 선택해주세요.' };
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) return { error: '수량을 올바르게 입력해주세요.' };
  if (!Number.isFinite(params.unitPrice) || params.unitPrice < 0) return { error: '단가를 올바르게 입력해주세요.' };

  const supabase = await createClient();
  const db = supabase as any;

  const guard = await loadEditableOrder(db, params.orderId);
  if ('error' in guard) return { error: guard.error };
  const order = guard.order;

  const meta = await loadProductMeta(db, params.productId);
  if ('error' in meta) return { error: meta.error };

  // phantom인데 BOM이 없으면 거부 (재고 분해 불가)
  if (meta.phantom) {
    const bom = await loadPhantomBom(db, params.productId);
    if (bom.length === 0) {
      return { error: '세트 상품(Phantom)에 BOM이 등록되지 않아 추가할 수 없습니다. 제품 화면에서 구성품을 먼저 등록하세요.' };
    }
  }

  const stockBranchId = await resolveStockBranchId(db, order);

  const qty = Math.floor(params.quantity);
  const discount = Number(params.discount || 0);
  const dtype = params.deliveryType || 'PICKUP';
  const itemReceiptStatus = dtype === 'PARCEL' ? 'PARCEL_PLANNED'
    : dtype === 'QUICK' ? 'QUICK_PLANNED'
    : 'RECEIVED';

  // 1) 품목 insert (optional 컬럼 방어)
  const itemPayload: any = {
    sales_order_id: order.id,
    product_id: params.productId,
    quantity: qty,
    unit_price: params.unitPrice,
    discount_amount: discount,
    total_price: params.unitPrice * qty - discount,
    order_option: params.orderOption || null,
    delivery_type: dtype,
    receipt_status: itemReceiptStatus,
    receipt_date: null,
  };
  let insErr = (await db.from('sales_order_items').insert(itemPayload)).error;
  if (insErr && isMissingColumnError(insErr)) {
    for (const k of ['order_option', 'delivery_type', 'receipt_status', 'receipt_date']) delete itemPayload[k];
    insErr = (await db.from('sales_order_items').insert(itemPayload)).error;
  }
  if (insErr) return { error: '품목 추가에 실패했습니다.' };

  // 2) 재고 차감
  try {
    await applyStockForItem(
      db, stockBranchId, meta, params.productId,
      meta.name, qty, 'OUT',
      'SALE_REVISE_ADD', 'PHANTOM_DECOMPOSE', order.id,
      `전표 수정 품목 추가 (${order.order_number})`,
    );
  } catch (e: any) {
    console.error('[addSalesOrderItem] stock decrement failed:', e?.message);
  }

  // 3) 재계산 + 결제/분개 차액
  const { deltaFinal, deltaTaxable } = await recalcSalesOrderTotals(db, order);
  const payRes = await recordPaymentDelta(db, order, deltaFinal, session.id);
  if (payRes.error) return { error: payRes.error };
  await recordJournalDelta(db, order, deltaFinal, deltaTaxable, session.id);

  writeAuditLog({
    userId: session.id,
    action: 'UPDATE',
    tableName: 'sales_orders',
    recordId: order.id,
    description: `전표 품목 추가: ${order.order_number}, 수량 ${qty}, 단가 ${Number(params.unitPrice).toLocaleString()}원, 차액 ${deltaFinal.toLocaleString()}원`,
  }).catch(() => {});

  revalidatePath('/pos');
  revalidatePath('/inventory');
  revalidatePath('/reports');
  revalidatePath('/accounting');

  return { success: true, delta: deltaFinal };
}

/**
 * 품목 삭제
 */
export async function removeSalesOrderItem(params: {
  orderId: string;
  itemId: string;
}): Promise<{ success?: true; delta?: number; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  const guard = await loadEditableOrder(db, params.orderId);
  if ('error' in guard) return { error: guard.error };
  const order = guard.order;

  const items = (order.order_items || []) as any[];
  const target = items.find(it => it.id === params.itemId);
  if (!target) return { error: '해당 품목을 찾을 수 없습니다.' };

  // 안전장치: 이미 수령된 품목 / 마지막 1개 품목 삭제 거부
  if (target.receipt_status === 'RECEIVED') {
    return { error: '이미 수령된 품목은 삭제할 수 없습니다.' };
  }
  if (items.length <= 1) {
    return { error: '전표의 마지막 품목은 삭제할 수 없습니다. 판매 취소를 사용하세요.' };
  }

  const meta = await loadProductMeta(db, target.product_id);
  // 삭제 시 제품 메타 조회 실패해도 진행하되, track/phantom 분기 기본값(track=true) 사용
  const stockMeta = ('error' in meta)
    ? { track: true, phantom: false }
    : { track: meta.track, phantom: meta.phantom };
  const productName = ('error' in meta) ? target.product_id : meta.name;

  const stockBranchId = await resolveStockBranchId(db, order);

  // 1) 재고 복원
  try {
    await applyStockForItem(
      db, stockBranchId, stockMeta, target.product_id,
      productName, Number(target.quantity), 'IN',
      'SALE_REVISE_REMOVE', 'PHANTOM_DECOMPOSE', order.id,
      `전표 수정 품목 삭제 (${order.order_number})`,
    );
  } catch (e: any) {
    console.error('[removeSalesOrderItem] stock restore failed:', e?.message);
  }

  // 2) 품목 삭제
  const { error: delErr } = await db.from('sales_order_items').delete().eq('id', params.itemId);
  if (delErr) return { error: '품목 삭제에 실패했습니다.' };

  // 3) 재계산 + 결제/분개 차액
  const { deltaFinal, deltaTaxable } = await recalcSalesOrderTotals(db, order);
  const payRes = await recordPaymentDelta(db, order, deltaFinal, session.id);
  if (payRes.error) return { error: payRes.error };
  await recordJournalDelta(db, order, deltaFinal, deltaTaxable, session.id);

  writeAuditLog({
    userId: session.id,
    action: 'UPDATE',
    tableName: 'sales_orders',
    recordId: order.id,
    description: `전표 품목 삭제: ${order.order_number}, 차액 ${deltaFinal.toLocaleString()}원`,
  }).catch(() => {});

  revalidatePath('/pos');
  revalidatePath('/inventory');
  revalidatePath('/reports');
  revalidatePath('/accounting');

  return { success: true, delta: deltaFinal };
}
