'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession, writeAuditLog } from '@/lib/session';
import { kstTodayString } from '@/lib/date';
import { toNum } from '@/lib/validators';

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
//   #101 opts.allowReceived: 품목 수정(수량·단가·추가·삭제·옵션)은 수령완료 전표도 허용
//   (재고·금액 재계산이 함께 따라감). 배송전환(convert)은 기본값(수령완료 차단) 유지.
async function loadEditableOrder(db: any, orderId: string, opts?: { allowReceived?: boolean }) {
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
  // 취소/환불 전표는 별도 흐름 → 수정 차단(품목 수정도 동일).
  if (['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.status)) {
    return { error: '취소/환불된 전표는 수정할 수 없습니다.' as string };
  }
  if (order.status !== 'COMPLETED') {
    return { error: '완료 상태의 전표만 수정할 수 있습니다.' as string };
  }
  // 수령완료(RECEIVED)·null: 품목 수정은 허용(allowReceived), 배송전환 등은 차단.
  if (!opts?.allowReceived && (!order.receipt_status || order.receipt_status === 'RECEIVED')) {
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
  // #105 음수(환불·반품) 총액은 clamp 금지 — 금액·매출·결제차액이 마이너스로 일관 반영돼야 함.
  //   (기존 Math.max(0,...)이 -35,000을 0으로 눌러 결제/매출 반영이 0원이 되던 버그.)
  const newFinal = newTotal - discount - pointsUsed;
  const oldFinal = Number(order.total_amount || 0) - discount - pointsUsed;

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
  // #101 음수 수량 허용(반품/환불 마이너스 품목) — 0만 차단.
  if (!Number.isFinite(params.quantity) || Math.trunc(params.quantity) === 0) return { error: '수량은 0이 아닌 정수여야 합니다. (음수=반품/환불)' };
  if (!Number.isFinite(params.unitPrice) || params.unitPrice < 0) return { error: '단가를 올바르게 입력해주세요.' };

  const supabase = await createClient();
  const db = supabase as any;

  const guard = await loadEditableOrder(db, params.orderId, { allowReceived: true });
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

  const qty = Math.trunc(params.quantity);   // #101 음수 허용
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

  // 2) 재고 반영 — #101 음수 품목(반품)은 IN(복원), 양수는 OUT(차감). quantity는 절대값.
  try {
    await applyStockForItem(
      db, stockBranchId, meta, params.productId,
      meta.name, Math.abs(qty), qty >= 0 ? 'OUT' : 'IN',
      'SALE_REVISE_ADD', 'PHANTOM_DECOMPOSE', order.id,
      `전표 수정 품목 추가 (${order.order_number})`,
    );
  } catch (e: any) {
    console.error('[addSalesOrderItem] stock adjust failed:', e?.message);
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

// ── 주문 receipt_status 재집계 (혼합 delivery_type 대응) ──
//   우선순위: PARCEL_PLANNED > QUICK_PLANNED > PICKUP_PLANNED > (전부 RECEIVED면 RECEIVED).
//   receipt_date: RECEIVED로 갈 때만 오늘, 그 외 null.
//   markItemReceived(SalesListTab)의 allDone 판정(전부 RECEIVED→주문 RECEIVED)과 의미 일치.
function deriveOrderReceiptStatus(
  items: Array<{ receipt_status?: string | null }>,
): { status: 'RECEIVED' | 'PARCEL_PLANNED' | 'QUICK_PLANNED' | 'PICKUP_PLANNED'; receiptDate: string | null } {
  const statuses = items.map(it => it.receipt_status || 'RECEIVED');
  if (statuses.some(s => s === 'PARCEL_PLANNED')) return { status: 'PARCEL_PLANNED', receiptDate: null };
  if (statuses.some(s => s === 'QUICK_PLANNED')) return { status: 'QUICK_PLANNED', receiptDate: null };
  if (statuses.some(s => s === 'PICKUP_PLANNED')) return { status: 'PICKUP_PLANNED', receiptDate: null };
  // 남은 건 전부 RECEIVED (null도 RECEIVED로 간주)
  return { status: 'RECEIVED', receiptDate: kstTodayString() };
}

// ── 주문 receipt_status 재집계 update (품목 재조회 → 도출 → sales_orders update) ──
//   052 미적용 환경: 품목 receipt_status 컬럼 부재 시 재집계 불가 → 조용히 skip(폴백).
async function reaggregateOrderReceiptStatus(db: any, orderId: string): Promise<void> {
  let res: any = await db
    .from('sales_order_items')
    .select('receipt_status')
    .eq('sales_order_id', orderId);
  if (res.error && isMissingColumnError(res.error)) return; // 052 미적용 — 재집계 생략
  const rows = (res.data || []) as Array<{ receipt_status?: string | null }>;
  if (rows.length === 0) return;
  const { status, receiptDate } = deriveOrderReceiptStatus(rows);
  let upErr = (await db
    .from('sales_orders')
    .update({ receipt_status: status, receipt_date: receiptDate })
    .eq('id', orderId)).error;
  if (upErr && isMissingColumnError(upErr)) return; // 051 미적용 — 주문 레벨 재집계 생략
}

/**
 * 방문(PICKUP) → 택배(PARCEL) 전환
 *
 * 수정 가능 전표 한정. 미수령 PICKUP 품목을 PARCEL/PARCEL_PLANNED로 바꾸고
 * shipment 레코드를 생성(없으면)하거나 update(있으면)한다. RECEIVED 품목은 보존.
 * 금액 불변 — recalc/payment/journal 호출 안 함.
 */
export async function convertOrderToParcel(params: {
  orderId: string;
  recipient: {
    name: string;
    phone: string;
    address: string;
    zipcode?: string | null;
    addressDetail?: string | null;
    message?: string | null;
  };
}): Promise<{ success?: true; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  const guard = await loadEditableOrder(db, params.orderId);
  if ('error' in guard) return { error: guard.error };
  const order = guard.order;

  // 1) 수령자 필수값 검증 (NOT NULL 3종)
  const name = (params.recipient?.name || '').trim();
  const phone = (params.recipient?.phone || '').trim();
  const address = (params.recipient?.address || '').trim();
  if (!name || !phone || !address) {
    return { error: '수령자명·연락처·주소는 필수 입력 항목입니다.' };
  }

  // 2) 미수령 품목 → PARCEL/PARCEL_PLANNED (이미 RECEIVED인 품목은 제외·보존)
  let itemUpd: any = await db
    .from('sales_order_items')
    .update({ delivery_type: 'PARCEL', receipt_status: 'PARCEL_PLANNED', receipt_date: null })
    .eq('sales_order_id', order.id)
    .neq('receipt_status', 'RECEIVED');
  if (itemUpd.error && isMissingColumnError(itemUpd.error)) {
    // 050/052 미적용: delivery_type/receipt_status 컬럼 부재 → 품목 갱신 생략(전환 자체는 shipment로 표현)
    itemUpd = { error: null };
  }
  if (itemUpd.error) return { error: '품목 배송방식 변경에 실패했습니다.' };

  // 3) shipment upsert — 있으면 update, 없으면 insert(processPosCheckout ②-b 폴백 복제)
  const { data: existing } = await db
    .from('shipments')
    .select('id')
    .eq('sales_order_id', order.id)
    .maybeSingle();

  if (existing?.id) {
    // 기존 shipment 존재(택배→퀵 잔존 등) → delivery_type=PARCEL + 수령자/주소 갱신
    const updPayload: any = {
      delivery_type: 'PARCEL',
      recipient_name: name,
      recipient_phone: phone,
      recipient_zipcode: params.recipient.zipcode || null,
      recipient_address: address,
      recipient_address_detail: params.recipient.addressDetail || null,
      delivery_message: params.recipient.message || null,
    };
    let updErr = (await db.from('shipments').update(updPayload).eq('id', existing.id)).error;
    if (updErr && isMissingColumnError(updErr)) {
      delete updPayload.delivery_type;
      updErr = (await db.from('shipments').update(updPayload).eq('id', existing.id)).error;
    }
    if (updErr) return { error: '배송 정보 갱신에 실패했습니다.' };
  } else {
    // 신규 insert — processPosCheckout ②-b 폴백 패턴 복제
    const stockBranchId = await resolveStockBranchId(db, order);
    // 출고지점 발신정보 조회 (NOT NULL 방어 — 없으면 '')
    const { data: senderBranch } = await db
      .from('branches')
      .select('name, phone')
      .eq('id', stockBranchId)
      .maybeSingle();
    const senderName = senderBranch?.name || '';
    const senderPhone = senderBranch?.phone || '';

    // items_summary: PARCEL 대상(미수령) 품목 요약 — 제품명으로 (이름 조회 실패 시 product_id 폴백)
    const items = (order.order_items || []) as any[];
    const shipItems = items.filter(it => (it.receipt_status || 'RECEIVED') !== 'RECEIVED');
    const summarySource = shipItems.length > 0 ? shipItems : items;
    const nameMap = new Map<string, string>();
    const pids = Array.from(new Set(summarySource.map(it => it.product_id).filter(Boolean)));
    if (pids.length > 0) {
      const { data: prods } = await db.from('products').select('id, name').in('id', pids);
      for (const p of (prods || []) as any[]) nameMap.set(p.id, p.name);
    }
    const itemsSummary = summarySource
      .map(it => {
        const label = nameMap.get(it.product_id) || String(it.product_id);
        return Number(it.quantity) > 1 ? `${label} x${it.quantity}` : label;
      })
      .join(', ');

    const payloadBase: any = {
      source: 'STORE',
      sales_order_id: order.id,
      branch_id: stockBranchId,
      sender_name: senderName,
      sender_phone: senderPhone,
      recipient_name: name,
      recipient_phone: phone,
      recipient_zipcode: params.recipient.zipcode || null,
      recipient_address: address,
      recipient_address_detail: params.recipient.addressDetail || null,
      delivery_message: params.recipient.message || null,
      items_summary: itemsSummary || null,
      status: 'PENDING',
      created_by: session.id,
    };
    const payloadFull = {
      ...payloadBase,
      delivery_type: 'PARCEL',
    };

    let shipErr = (await db.from('shipments').insert(payloadFull)).error;
    if (shipErr && isMissingColumnError(shipErr)) {
      // delivery_type 미적용(050 없음) 우선 제거
      const { delivery_type, ...withoutType } = payloadFull;
      const retryA = await db.from('shipments').insert(withoutType);
      if (retryA.error && isMissingColumnError(retryA.error)) {
        // created_by 등 추가 누락 — base에서 created_by 제거 후 재시도
        const { created_by, ...withoutCreatedBy } = withoutType;
        shipErr = (await db.from('shipments').insert(withoutCreatedBy)).error;
      } else {
        shipErr = retryA.error;
      }
    }
    if (shipErr) {
      console.error('[convertOrderToParcel] shipments insert failed:', shipErr);
      return { error: '배송 정보 저장에 실패했습니다.' };
    }
  }

  // 4) 주문 receipt_status 재집계
  await reaggregateOrderReceiptStatus(db, order.id);

  writeAuditLog({
    userId: session.id,
    action: 'UPDATE',
    tableName: 'sales_orders',
    recordId: order.id,
    description: `전표 배송전환 방문→택배: ${order.order_number}, 수령자 ${name}`,
  }).catch(() => {});

  revalidatePath('/pos');
  revalidatePath('/shipping');

  return { success: true };
}

/**
 * 택배(PARCEL/QUICK) → 방문(PICKUP) 전환
 *
 * 수정 가능 전표 한정. shipment.status='PENDING'(송장 미발행)일 때만 허용 —
 * PRINTED/SHIPPED/DELIVERED는 거부. PENDING shipment는 하드 DELETE.
 * 미수령 품목을 PICKUP/RECEIVED(오늘)로 바꾼다. RECEIVED 품목은 보존.
 * 금액 불변.
 */
export async function convertOrderToPickup(params: {
  orderId: string;
}): Promise<{ success?: true; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  const guard = await loadEditableOrder(db, params.orderId);
  if ('error' in guard) return { error: guard.error };
  const order = guard.order;

  // 1) shipment 조회 → 가드 → void(DELETE)
  const { data: shipment } = await db
    .from('shipments')
    .select('id, status')
    .eq('sales_order_id', order.id)
    .maybeSingle();

  if (shipment?.id) {
    if (shipment.status !== 'PENDING') {
      return { error: '이미 송장이 발행/발송된 배송은 방문 수령으로 전환할 수 없습니다. 배송을 먼저 취소/회수하세요.' };
    }
    const { error: delErr } = await db.from('shipments').delete().eq('id', shipment.id);
    if (delErr) {
      console.error('[convertOrderToPickup] shipments delete failed:', delErr);
      return { error: '배송 레코드 삭제에 실패했습니다.' };
    }
  }

  // 2) 미수령 품목 → PICKUP/RECEIVED/오늘 (이미 RECEIVED 품목은 제외·보존)
  const today = kstTodayString();
  let itemUpd: any = await db
    .from('sales_order_items')
    .update({ delivery_type: 'PICKUP', receipt_status: 'RECEIVED', receipt_date: today })
    .eq('sales_order_id', order.id)
    .neq('receipt_status', 'RECEIVED');
  if (itemUpd.error && isMissingColumnError(itemUpd.error)) {
    itemUpd = { error: null }; // 050/052 미적용 — 품목 갱신 생략
  }
  if (itemUpd.error) return { error: '품목 배송방식 변경에 실패했습니다.' };

  // 3) 주문 receipt_status 재집계
  await reaggregateOrderReceiptStatus(db, order.id);

  writeAuditLog({
    userId: session.id,
    action: 'UPDATE',
    tableName: 'sales_orders',
    recordId: order.id,
    description: `전표 배송전환 택배→방문: ${order.order_number}`,
  }).catch(() => {});

  revalidatePath('/pos');
  revalidatePath('/shipping');

  return { success: true };
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

  // #101 품목 삭제도 수령완료 전표 허용(재고 복원 동반).
  const guard = await loadEditableOrder(db, params.orderId, { allowReceived: true });
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

/**
 * 품목 수량/단가 수정 (#36)
 *
 * 대상: 수정 가능 전표(COMPLETED + 미수령) 의 미수령 품목. 판매번호(order_number) 불변.
 * 수량 변경 → 차액만큼 재고 차감(증가)/복원(감소, phantom은 BOM 분해). 단가 변경 → 금액만.
 * 변경 후 totals·과세·적립포인트 재계산 + 결제/분개 차액 기록 + audit 기록(수정 이력).
 * 결제 차액은 sales_order_payments 행으로 기록(추가결제/부분환불) — 실제 PG/단말기는 수기 안내.
 */
export async function updateSalesOrderItem(params: {
  orderId: string;
  itemId: string;
  quantity?: number;   // 새 수량(정수). 미지정 시 기존 유지.
  unitPrice?: number;  // 새 단가. 미지정 시 기존 유지.
  discount?: number;   // 새 품목 할인. 미지정 시 기존 유지.
  orderOption?: string | null;  // #75 주문 옵션(보자기/쇼핑백/선물구성 등). 미지정 시 기존 유지.
}): Promise<{ success?: true; delta?: number; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  // #101 품목 수정은 수령완료 전표도 허용(재고·금액 재계산 동반).
  const guard = await loadEditableOrder(db, params.orderId, { allowReceived: true });
  if ('error' in guard) return { error: guard.error };
  const order = guard.order;

  const items = (order.order_items || []) as any[];
  const target = items.find(it => it.id === params.itemId);
  if (!target) return { error: '해당 품목을 찾을 수 없습니다.' };

  const oldQty = Number(target.quantity);
  const oldUnit = Number(target.unit_price);
  const oldDiscount = Number(target.discount_amount || 0);
  const newQty = params.quantity !== undefined ? Math.trunc(params.quantity) : oldQty;
  const newUnit = params.unitPrice !== undefined ? Number(params.unitPrice) : oldUnit;
  const newDiscount = params.discount !== undefined ? Number(params.discount) : oldDiscount;
  // #75 주문 옵션
  const oldOption = (target.order_option ?? null) as string | null;
  const newOption = params.orderOption !== undefined
    ? (((params.orderOption ?? '').toString().trim()) || null)
    : oldOption;

  // #101 음수 수량 허용(반품/정정) — 0만 차단. 재고·금액이 부호대로 재반영.
  if (!Number.isFinite(newQty) || newQty === 0) return { error: '수량은 0이 아닌 정수여야 합니다. (음수=반품/정정)' };
  if (!Number.isFinite(newUnit) || newUnit < 0) return { error: '단가를 올바르게 입력해주세요.' };
  if (!Number.isFinite(newDiscount) || newDiscount < 0) return { error: '할인 금액을 올바르게 입력해주세요.' };

  // 변경 없음 → no-op (옵션 포함)
  if (newQty === oldQty && newUnit === oldUnit && newDiscount === oldDiscount && newOption === oldOption) {
    return { success: true, delta: 0 };
  }

  const meta = await loadProductMeta(db, target.product_id);
  const stockMeta = ('error' in meta) ? { track: true, phantom: false } : { track: meta.track, phantom: meta.phantom };
  const productName = ('error' in meta) ? target.product_id : meta.name;

  const stockBranchId = await resolveStockBranchId(db, order);

  // 1) 수량 차액만큼 재고 조정 (증가→OUT 차감, 감소→IN 복원). 단가만 바뀌면 재고 불변.
  const qtyDelta = newQty - oldQty;
  if (qtyDelta !== 0) {
    try {
      await applyStockForItem(
        db, stockBranchId, stockMeta, target.product_id,
        productName, Math.abs(qtyDelta), qtyDelta > 0 ? 'OUT' : 'IN',
        'SALE_REVISE_EDIT', 'PHANTOM_DECOMPOSE', order.id,
        `전표 수정 수량변경 ${oldQty}→${newQty} (${order.order_number})`,
      );
    } catch (e: any) {
      console.error('[updateSalesOrderItem] stock adjust failed:', e?.message);
    }
  }

  // 2) 품목 update (discount_amount 컬럼 누락 방어)
  const itemPayload: any = {
    quantity: newQty,
    unit_price: newUnit,
    discount_amount: newDiscount,
    total_price: newUnit * newQty - newDiscount,
  };
  let upErr = (await db.from('sales_order_items').update(itemPayload).eq('id', params.itemId)).error;
  if (upErr && isMissingColumnError(upErr)) {
    delete itemPayload.discount_amount;
    itemPayload.total_price = newUnit * newQty;
    upErr = (await db.from('sales_order_items').update(itemPayload).eq('id', params.itemId)).error;
  }
  if (upErr) return { error: '품목 수정에 실패했습니다.' };

  // 2-b) #75 주문 옵션 변경 — 별도 update(컬럼 누락 환경 허용). 택배관리/송장 order_options는 이 값에서 파생.
  if (newOption !== oldOption) {
    const { error: optErr } = await db.from('sales_order_items').update({ order_option: newOption }).eq('id', params.itemId);
    if (optErr && !isMissingColumnError(optErr)) return { error: '옵션 수정에 실패했습니다.' };
  }

  // 3) 재계산 + 결제/분개 차액 (recalc 가 갱신된 품목을 재조회해 totals·포인트 갱신)
  const { deltaFinal, deltaTaxable } = await recalcSalesOrderTotals(db, order);
  const payRes = await recordPaymentDelta(db, order, deltaFinal, session.id);
  if (payRes.error) return { error: payRes.error };
  await recordJournalDelta(db, order, deltaFinal, deltaTaxable, session.id);

  writeAuditLog({
    userId: session.id,
    action: 'UPDATE',
    tableName: 'sales_orders',
    recordId: order.id,
    description: `전표 품목 수정: ${order.order_number}, ${productName} 수량 ${oldQty}→${newQty}, 단가 ${oldUnit.toLocaleString()}→${newUnit.toLocaleString()}원${newOption !== oldOption ? `, 옵션 '${oldOption ?? '-'}'→'${newOption ?? '-'}'` : ''}, 차액 ${deltaFinal.toLocaleString()}원`,
  }).catch(() => {});

  revalidatePath('/pos');
  revalidatePath('/inventory');
  revalidatePath('/reports');
  revalidatePath('/accounting');

  return { success: true, delta: deltaFinal };
}

// ── 전표 상세 직접 수정 (고객 재연결 / 표시명 / 수령일 / 받는분) ─────────────────
//
// 판매번호(order_number)는 절대 불변. 취소·환불 전표는 수정 불가.
// 부분 업데이트: payload 에 전달된(undefined 아닌) 필드만 반영.
// 받는분(recipient_*) 변경 시 sales_orders 항상 update + shipment 존재 시 동기화.
// 변경된 필드만 모아 audit_logs 에 1건(UPDATE) 기록. 변경 0건이면 스킵.
const DETAIL_FIELD_LABELS: Record<string, string> = {
  customer_id: '고객연결',
  buyer_name: '표시명',
  buyer_phone: '연락처(표시)',
  ordered_at: '판매일시',
  branch_id: '매출처',
  ordered_by: '담당자',
  receipt_status: '수령상태',
  receipt_date: '수령일',
  recipient_name: '받는분',
  recipient_phone: '연락처',
  recipient_zipcode: '우편',
  recipient_address: '주소',
  recipient_address_detail: '상세주소',
};
const RECIPIENT_FIELDS = [
  'recipient_name', 'recipient_phone', 'recipient_zipcode',
  'recipient_address', 'recipient_address_detail',
] as const;

// #97 비택배 → 택배 전환 시 PENDING shipment 생성(택배관리 등록).
//   받는분=updatePayload 우선→주문 recipient→구매자, 출고처=ship_from→매출지점, 품목요약 자동.
async function createPendingShipmentForOrder(
  db: any, orderId: string, order: any, updatePayload: Record<string, any>, userId: string,
): Promise<void> {
  try {
    const pick = (f: string, alt?: any) => {
      const v = f in updatePayload ? updatePayload[f] : (order[f] ?? null);
      return (v ?? alt ?? null);
    };
    const name = pick('recipient_name', order.buyer_name);
    const phone = pick('recipient_phone', order.buyer_phone);

    // 출고처(sender) + 품목요약 — 최신 주문 재조회.
    const { data: full } = await db
      .from('sales_orders')
      .select('branch_id, ship_from_branch_id, order_items:sales_order_items(product_id, quantity, receipt_status)')
      .eq('id', orderId).maybeSingle();
    const sendBranchId = full?.ship_from_branch_id || full?.branch_id || order.branch_id || null;
    let senderName = '', senderPhone = '';
    if (sendBranchId) {
      const { data: b } = await db.from('branches').select('name, phone').eq('id', sendBranchId).maybeSingle();
      senderName = b?.name || ''; senderPhone = b?.phone || '';
    }
    const items = (full?.order_items || []) as any[];
    const shipItems = items.filter(it => (it.receipt_status || 'RECEIVED') !== 'RECEIVED');
    const src = shipItems.length ? shipItems : items;
    const pids = Array.from(new Set(src.map(it => it.product_id).filter(Boolean)));
    const nameMap = new Map<string, string>();
    if (pids.length) {
      const { data: prods } = await db.from('products').select('id, name').in('id', pids);
      for (const p of (prods || []) as any[]) nameMap.set(p.id, p.name);
    }
    const itemsSummary = src
      .map(it => { const l = nameMap.get(it.product_id) || String(it.product_id); return Number(it.quantity) > 1 ? `${l} x${it.quantity}` : l; })
      .join(', ');

    const payload: any = {
      source: 'STORE', sales_order_id: orderId, branch_id: sendBranchId,
      sender_name: senderName, sender_phone: senderPhone,
      recipient_name: name, recipient_phone: phone,
      recipient_zipcode: pick('recipient_zipcode'), recipient_address: pick('recipient_address'),
      recipient_address_detail: pick('recipient_address_detail'),
      items_summary: itemsSummary || null, status: 'PENDING', created_by: userId, delivery_type: 'PARCEL',
    };
    let { error } = await db.from('shipments').insert(payload);
    if (error && isMissingColumnError(error)) {
      const { delivery_type, ...rest } = payload;
      ({ error } = await db.from('shipments').insert(rest));
    }
    if (error) console.error('[createPendingShipmentForOrder] insert failed:', error);
  } catch (e) {
    console.error('[createPendingShipmentForOrder] error:', e);
  }
}

export async function updateSalesOrderDetails(input: {
  orderId: string;
  customer_id?: string | null;
  buyer_name?: string | null;
  buyer_phone?: string | null;
  ordered_at?: string | null;
  branch_id?: string | null;
  ordered_by?: string | null;
  receipt_status?: string | null;
  receipt_date?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  recipient_zipcode?: string | null;
  recipient_address?: string | null;
  recipient_address_detail?: string | null;
  reason?: string;
}): Promise<{ success: true } | { error: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  // 현재값 조회
  const { data: order, error: fetchErr } = await db
    .from('sales_orders')
    .select(`order_number, status, customer_id, buyer_name, buyer_phone,
             ordered_at, branch_id, ordered_by, receipt_status, receipt_date,
             recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail`)
    .eq('id', input.orderId)
    .single();

  if (fetchErr || !order) {
    // recipient_* 미적용(083 전) 환경 방어: 5필드 빼고 재조회
    if (fetchErr && isMissingColumnError(fetchErr)) {
      const retry = await db
        .from('sales_orders')
        .select('order_number, status, customer_id, buyer_name, buyer_phone, ordered_at, branch_id, ordered_by, receipt_status, receipt_date')
        .eq('id', input.orderId)
        .single();
      if (retry.error || !retry.data) return { error: '전표를 찾을 수 없습니다.' };
      return finishUpdateSalesOrderDetails(db, retry.data, input, session.id);
    }
    return { error: '전표를 찾을 수 없습니다.' };
  }

  return finishUpdateSalesOrderDetails(db, order, input, session.id);
}

async function finishUpdateSalesOrderDetails(
  db: any,
  order: any,
  input: Parameters<typeof updateSalesOrderDetails>[0],
  userId: string,
): Promise<{ success: true } | { error: string }> {
  if (['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.status)) {
    return { error: '취소/환불된 전표는 수정할 수 없습니다.' };
  }

  try {
    // 전달된(undefined 아닌) 필드만 비교 → 변경분만 수집
    const updatePayload: Record<string, any> = {};
    const oldData: Record<string, any> = {};
    const newData: Record<string, any> = {};
    const candidates: (keyof typeof DETAIL_FIELD_LABELS)[] = [
      'customer_id', 'buyer_name', 'buyer_phone',
      'ordered_at', 'branch_id', 'ordered_by', 'receipt_status', 'receipt_date',
      'recipient_name', 'recipient_phone', 'recipient_zipcode',
      'recipient_address', 'recipient_address_detail',
    ];

    for (const key of candidates) {
      const next = (input as any)[key];
      if (next === undefined) continue;
      const before = order[key] ?? null;
      const after = next === '' ? null : next;
      if (before === after) continue;
      updatePayload[key] = after;
      oldData[key] = before;
      newData[key] = after;
    }

    const changedKeys = Object.keys(updatePayload);
    if (changedKeys.length === 0) return { success: true };

    // #97 수령방식(receipt_status) 변경 → 택배관리(shipments) 실시간 연동 준비.
    //   택배예정(PARCEL_PLANNED) ↔ 그 외(방문/퀵/수령완료) 경계를 넘을 때만 동작.
    //   택배→비택배: 대기(PENDING) shipment 삭제(택배관리서 제외). 이미 발송(PRINTED+)이면 차단(경고).
    //   비택배→택배: PENDING shipment 생성(택배관리에 등록).
    let shipSyncAction: 'delete' | 'create' | null = null;
    let shipToDeleteId: string | null = null;
    if ('receipt_status' in updatePayload) {
      const wasParcel = (order.receipt_status ?? null) === 'PARCEL_PLANNED';
      const isParcel = updatePayload.receipt_status === 'PARCEL_PLANNED';
      if (wasParcel !== isParcel) {
        const { data: ship } = await db.from('shipments').select('id, status').eq('sales_order_id', input.orderId).maybeSingle();
        if (!isParcel && ship?.id) {
          if (ship.status !== 'PENDING') {
            return { error: '이미 송장이 발행/발송된 건입니다. 택배관리에서 발송을 먼저 취소/회수한 뒤 수령방식을 변경하세요.' };
          }
          shipSyncAction = 'delete'; shipToDeleteId = ship.id;
        } else if (isParcel && !ship?.id) {
          shipSyncAction = 'create';
        }
      }
    }

    // sales_orders update (083 미적용 방어: recipient_* 누락 시 5필드 빼고 재시도)
    let { error: updErr } = await db
      .from('sales_orders')
      .update(updatePayload)
      .eq('id', input.orderId);

    if (updErr && isMissingColumnError(updErr)) {
      const slim = { ...updatePayload };
      for (const f of RECIPIENT_FIELDS) delete slim[f];
      if (Object.keys(slim).length > 0) {
        const retry = await db.from('sales_orders').update(slim).eq('id', input.orderId);
        updErr = retry.error;
      } else {
        updErr = null;
      }
    }
    if (updErr) return { error: `수정 실패: ${updErr.message}` };

    // 받는분 변경분은 shipment 존재 시 동기화 (shipments recipient_* 는 046부터 존재 → 폴백 불필요)
    const recipientUpdate: Record<string, any> = {};
    for (const f of RECIPIENT_FIELDS) {
      if (f in updatePayload) recipientUpdate[f] = updatePayload[f];
    }
    if (Object.keys(recipientUpdate).length > 0) {
      const { data: ship } = await db
        .from('shipments')
        .select('id')
        .eq('sales_order_id', input.orderId)
        .maybeSingle();
      if (ship?.id) {
        const { error: shipErr } = await db
          .from('shipments')
          .update(recipientUpdate)
          .eq('id', ship.id);
        if (shipErr) {
          // sales_orders는 이미 반영됨. shipment 동기화 실패 시 두 테이블이 어긋나므로
          // audit를 성공으로 기록하지 않고 에러를 표면화한다.
          console.error('[updateSalesOrderDetails] shipments recipient sync failed:', shipErr);
          return { error: '받는분 정보의 배송 동기화에 실패했습니다.' };
        }
      }
    }

    // #97 shipment 연동 실행 (sales_orders 반영 후) — 택배관리 실시간 반영.
    if (shipSyncAction === 'delete' && shipToDeleteId) {
      const { error: delErr } = await db.from('shipments').delete().eq('id', shipToDeleteId);
      if (delErr) console.error('[updateSalesOrderDetails] #97 shipment delete failed:', delErr);
      revalidatePath('/shipping');
    } else if (shipSyncAction === 'create') {
      await createPendingShipmentForOrder(db, input.orderId, order, updatePayload, userId);
      revalidatePath('/shipping');
    }

    // audit 1건
    const labels = changedKeys.map(k => DETAIL_FIELD_LABELS[k]).join(', ');
    writeAuditLog({
      userId,
      action: 'UPDATE',
      tableName: 'sales_orders',
      recordId: input.orderId,
      description: `판매상세 수정: ${order.order_number}, 변경: [${labels}], 사유: ${input.reason?.trim() || '-'}`,
      oldData,
      newData,
    }).catch(() => {});

    revalidatePath('/pos');
    return { success: true };
  } catch (err: any) {
    return { error: `수정 실패: ${err.message}` };
  }
}

/**
 * 출고처(재고 차감 지점) 변경 — 기존 매출 수정 폼에서 호출.
 *
 * 출고처 = 재고가 실제로 차감된 지점. 잘못 등록된 출고처를 정정하면서 이미 차감된
 * 재고도 함께 새 지점으로 옮긴다(옛 지점 복원 +, 새 지점 차감 −, movements 지점 재지정).
 *
 * 동작:
 *  1. 이 전표의 출고 movement(reference_id=주문/품목, OUT/IN) 를 모두 수집.
 *  2. (현재 지점, 제품)별 순차감량 = ΣOUT − ΣIN 계산. 새 지점과 다른 지점 그룹만 이전.
 *  3. 옛 지점 재고 += 순차감량(복원), 새 지점 재고 −= 순차감량(재차감, 음수 허용=판매 정책).
 *  4. 해당 movement 행의 branch_id 를 새 지점으로 재지정(이력이 새 출고처를 가리키게).
 *  5. shipments 있으면 shipments.branch_id, 항상 sales_orders.ship_from_branch_id 갱신.
 *
 * 재고 미관리/서비스 품목 등 movement 가 없으면 라벨(ship_from)만 갱신.
 * 트랜잭션은 기존 코드 일관성상 비사용(Supabase) — 라인 단위 순차 처리.
 */
export async function changeSalesOrderShipFromBranch(input: {
  orderId: string;
  ship_from_branch_id: string;
  reason?: string;
}): Promise<{ success: true; moved: number } | { error: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  if (!input.orderId) return { error: '전표가 지정되지 않았습니다.' };
  if (!input.ship_from_branch_id) return { error: '새 출고처를 선택하세요.' };

  const supabase = await createClient();
  const db = supabase as any;

  // 전표·상태 확인
  const { data: order, error: ordErr } = await db
    .from('sales_orders')
    .select('id, order_number, status, branch_id, ship_from_branch_id')
    .eq('id', input.orderId)
    .single();
  if (ordErr || !order) return { error: '전표를 찾을 수 없습니다.' };
  if (['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.status)) {
    return { error: '취소/환불된 전표는 출고처를 변경할 수 없습니다.' };
  }

  const newBranchId = input.ship_from_branch_id;

  // 새 지점 유효성
  const { data: newBranch } = await db.from('branches').select('id, name').eq('id', newBranchId).maybeSingle();
  if (!newBranch) return { error: '선택한 출고처 지점을 찾을 수 없습니다.' };

  try {
    // 1) 이 전표의 출고 관련 movement 수집 — POS(reference_id=주문) + 온라인(reference_id=품목)
    const { data: itemRows } = await db.from('sales_order_items').select('id').eq('sales_order_id', input.orderId);
    const itemIds = ((itemRows as any[]) || []).map((r) => r.id);
    const refIds = [input.orderId, ...itemIds];

    const { data: movRows } = await db
      .from('inventory_movements')
      .select('id, branch_id, product_id, movement_type, quantity')
      .in('reference_id', refIds);
    const movements = ((movRows as any[]) || []).filter((m) =>
      m.movement_type === 'OUT' || m.movement_type === 'IN');

    // 2) (현재 지점, 제품)별 순차감량 = ΣOUT − ΣIN. 새 지점 그룹은 이전 불필요.
    //    netByBranchProduct[branch][product] = 양수면 그만큼 그 지점에서 빠져나간 양.
    const netByBP = new Map<string, Map<string, number>>();
    const moveMovementIds: string[] = [];
    for (const m of movements) {
      if (m.branch_id === newBranchId) continue; // 이미 새 지점 = 이전 대상 아님
      const sign = m.movement_type === 'OUT' ? 1 : -1; // OUT=차감(+net), IN=복원(−net)
      const bMap = netByBP.get(m.branch_id) || new Map<string, number>();
      bMap.set(m.product_id, (bMap.get(m.product_id) || 0) + sign * toNum(m.quantity));
      netByBP.set(m.branch_id, bMap);
      moveMovementIds.push(m.id);
    }

    // 3) 재고 이전 — 옛 지점 복원(+net), 새 지점 차감(−net). net<=0(순복원/0)도 안전 처리.
    let movedLines = 0;
    for (const [oldBranchId, prodMap] of netByBP) {
      for (const [productId, net] of prodMap) {
        if (net === 0) continue;
        // 옛 지점: +net 복원
        await adjustBranchStock(db, oldBranchId, productId, net);
        // 새 지점: −net 차감(음수 허용)
        await adjustBranchStock(db, newBranchId, productId, -net);
        movedLines++;
      }
    }

    // 4) movement 행 재지정 — 새 출고처를 가리키게
    if (moveMovementIds.length > 0) {
      // chunk 로 안전하게 update (in() 길이 제한 회피)
      for (let i = 0; i < moveMovementIds.length; i += 100) {
        const chunk = moveMovementIds.slice(i, i + 100);
        await db.from('inventory_movements').update({ branch_id: newBranchId }).in('id', chunk);
      }
    }

    // 5) 라벨 저장 — shipment 있으면 shipments.branch_id, 항상 sales_orders.ship_from_branch_id
    const { data: ship } = await db.from('shipments').select('id').eq('sales_order_id', input.orderId).maybeSingle();
    if (ship?.id) {
      await db.from('shipments').update({ branch_id: newBranchId }).eq('id', ship.id);
    }
    await db.from('sales_orders').update({ ship_from_branch_id: newBranchId }).eq('id', input.orderId);

    // audit
    writeAuditLog({
      userId: session.id,
      action: 'UPDATE',
      tableName: 'sales_orders',
      recordId: input.orderId,
      description: `출고처 변경: ${order.order_number} → ${newBranch.name}, 재고이전 ${movedLines}품목, 사유: ${input.reason?.trim() || '-'}`,
      oldData: { ship_from_branch_id: order.ship_from_branch_id ?? order.branch_id },
      newData: { ship_from_branch_id: newBranchId },
    }).catch(() => {});

    revalidatePath('/pos');
    revalidatePath('/inventory');
    return { success: true, moved: movedLines };
  } catch (err: any) {
    return { error: `출고처 변경 실패: ${err.message}` };
  }
}

// 단일 (지점,제품) 재고를 delta 만큼 증감. 행 없으면 delta 로 신규(음수 허용). 음수 재고 허용.
async function adjustBranchStock(db: any, branchId: string, productId: string, delta: number): Promise<void> {
  const { data: arr } = await db.from('inventories').select('id, quantity').eq('branch_id', branchId).eq('product_id', productId);
  const cur = (arr as any[] | null)?.[0];
  if (!cur) {
    await db.from('inventories').insert({ branch_id: branchId, product_id: productId, quantity: delta, safety_stock: 0 });
  } else {
    await db.from('inventories').update({ quantity: toNum(cur.quantity) + delta }).eq('id', cur.id);
  }
}
