'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createPurchaseReceiptJournal } from '@/lib/accounting-actions';
import { writeAuditLog } from '@/lib/session';

function getUserId(): string | null {
  try {
    const cookieStore = cookies();
    return (cookieStore as any).get('user_id')?.value || null;
  } catch {
    return null;
  }
}

function genPoNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${date}-${rand}`;
}

function genSupplierCode(): string {
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SUP-${rand}`;
}

// ─── 공급업체 ──────────────────────────────────────────────────────────────────

export async function getSuppliers() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('name');
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function createSupplier(formData: FormData) {
  const supabase = await createClient();
  const code = genSupplierCode();

  const { error } = await (supabase as any).from('suppliers').insert({
    code,
    name: formData.get('name') as string,
    business_number: formData.get('business_number') as string || null,
    representative: formData.get('representative') as string || null,
    phone: formData.get('phone') as string || null,
    email: formData.get('email') as string || null,
    fax: formData.get('fax') as string || null,
    address: formData.get('address') as string || null,
    payment_terms: parseInt(formData.get('payment_terms') as string) || 30,
    bank_name: formData.get('bank_name') as string || null,
    bank_account: formData.get('bank_account') as string || null,
    bank_holder: formData.get('bank_holder') as string || null,
    memo: formData.get('memo') as string || null,
  });

  if (error) return { error: error.message };
  revalidatePath('/purchases/suppliers');
  revalidatePath('/purchases');
  return { success: true };
}

export async function updateSupplier(id: string, formData: FormData) {
  const supabase = await createClient();

  const { error } = await (supabase as any).from('suppliers').update({
    name: formData.get('name') as string,
    business_number: formData.get('business_number') as string || null,
    representative: formData.get('representative') as string || null,
    phone: formData.get('phone') as string || null,
    email: formData.get('email') as string || null,
    fax: formData.get('fax') as string || null,
    address: formData.get('address') as string || null,
    payment_terms: parseInt(formData.get('payment_terms') as string) || 30,
    bank_name: formData.get('bank_name') as string || null,
    bank_account: formData.get('bank_account') as string || null,
    bank_holder: formData.get('bank_holder') as string || null,
    memo: formData.get('memo') as string || null,
    is_active: formData.get('is_active') !== 'false',
  }).eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/purchases/suppliers');
  return { success: true };
}

export async function toggleSupplierActive(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from('suppliers')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/purchases/suppliers');
  return { success: true };
}

// ─── 발주서 조회 ───────────────────────────────────────────────────────────────

export async function getPurchaseOrders(filters?: {
  status?: string;
  supplierId?: string;
  branchId?: string;
}) {
  const supabase = await createClient();
  let q = (supabase as any)
    .from('purchase_orders')
    .select(`
      id, po_number, status, total_amount, expected_date, ordered_at, memo,
      supplier:suppliers(id, name, code),
      branch:branches(id, name),
      ordered_by_user:users!purchase_orders_ordered_by_fkey(name),
      items:purchase_order_items(id, ordered_quantity, received_quantity)
    `)
    .order('ordered_at', { ascending: false });

  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.supplierId) q = q.eq('supplier_id', filters.supplierId);
  if (filters?.branchId) q = q.eq('branch_id', filters.branchId);

  const { data, error } = await q.limit(100);
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function getPurchaseOrderDetail(id: string) {
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from('purchase_orders')
    .select(`
      *,
      supplier:suppliers(*),
      branch:branches(id, name),
      ordered_by_user:users!purchase_orders_ordered_by_fkey(name),
      items:purchase_order_items(
        *,
        product:products(id, name, code, unit)
      ),
      receipts:purchase_receipts(
        *,
        received_by_user:users!purchase_receipts_received_by_fkey(name),
        receipt_items:purchase_receipt_items(
          *,
          product:products(name)
        )
      )
    `)
    .eq('id', id)
    .single();

  if (error) return { data: null, error: error.message };
  return { data };
}

// ─── 발주서 생성 ───────────────────────────────────────────────────────────────

export async function createPurchaseOrder(formData: FormData) {
  const supabase = await createClient();
  const userId = getUserId();

  const itemsJson = formData.get('items') as string;
  let items: { product_id: string; ordered_quantity: number; unit_price: number }[] = [];
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return { error: '발주 항목이 올바르지 않습니다.' };
  }

  if (!items.length) return { error: '발주 항목을 1개 이상 추가해주세요.' };

  const totalAmount = items.reduce((sum, i) => sum + i.ordered_quantity * i.unit_price, 0);
  const poNumber = genPoNumber();

  const { data: po, error: poError } = await (supabase as any)
    .from('purchase_orders')
    .insert({
      po_number: poNumber,
      supplier_id: formData.get('supplier_id') as string,
      branch_id: formData.get('branch_id') as string,
      ordered_by: userId,
      total_amount: totalAmount,
      expected_date: formData.get('expected_date') as string || null,
      memo: formData.get('memo') as string || null,
      status: 'DRAFT',
    })
    .select('id')
    .single();

  if (poError) return { error: poError.message };

  const poItems = items.map(i => ({
    purchase_order_id: po.id,
    product_id: i.product_id,
    ordered_quantity: i.ordered_quantity,
    unit_price: i.unit_price,
    total_price: i.ordered_quantity * i.unit_price,
  }));

  const { error: itemError } = await (supabase as any)
    .from('purchase_order_items')
    .insert(poItems);

  if (itemError) {
    await (supabase as any).from('purchase_orders').delete().eq('id', po.id);
    return { error: itemError.message };
  }

  revalidatePath('/purchases');
  return { success: true, poNumber };
}

// ─── 발주서 확정 ───────────────────────────────────────────────────────────────

export async function confirmPurchaseOrder(id: string) {
  const supabase = await createClient();
  const db = supabase as any;
  const userId = getUserId();

  const { data: po } = await db
    .from('purchase_orders')
    .select('id, status, supplier_id, items:purchase_order_items(product_id, unit_price)')
    .eq('id', id)
    .single();

  if (!po || po.status !== 'DRAFT') {
    return { error: '초안(DRAFT) 상태의 발주서만 확정할 수 있습니다.' };
  }

  const { error } = await db
    .from('purchase_orders')
    .update({ status: 'CONFIRMED', confirmed_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return { error: error.message };

  // 매입 단가 히스토리 기록 (source=PO_CONFIRMED)
  await recordPurchasePrices(db, {
    supplierId: po.supplier_id,
    items: (po.items || []).map((i: any) => ({ product_id: i.product_id, unit_price: Number(i.unit_price || 0) })),
    source: 'PO_CONFIRMED',
    poId: id,
    userId,
  });

  revalidatePath('/purchases');
  revalidatePath(`/purchases/${id}`);
  return { success: true };
}

// ─── 매입 단가 이력 업서트 공통 헬퍼 ────────────────────────────────────────────

async function recordPurchasePrices(
  db: any,
  args: {
    supplierId: string;
    items: { product_id: string; unit_price: number }[];
    source: 'PO_CONFIRMED' | 'PO_RECEIVED' | 'MANUAL';
    poId?: string | null;
    userId?: string | null;
  },
) {
  if (!args.supplierId || !args.items?.length) return;
  const today = new Date().toISOString().slice(0, 10);

  const rows = args.items
    .filter(i => i.product_id && i.unit_price >= 0)
    .map(i => ({
      supplier_id: args.supplierId,
      product_id: i.product_id,
      unit_price: Math.round(Number(i.unit_price)),
      effective_from: today,
      source: args.source,
      source_po_id: args.poId || null,
      created_by: args.userId || null,
    }));

  if (!rows.length) return;

  // UPSERT (같은 공급사·제품·같은날 이미 있으면 단가 덮어쓰기)
  try {
    await db
      .from('supplier_product_prices')
      .upsert(rows, { onConflict: 'supplier_id,product_id,effective_from' });
  } catch (err) {
    console.error('supplier_product_prices upsert failed:', err);
    // 단가 기록 실패는 발주 전체 실패로 간주하지 않음
  }
}

// ─── 발주서 취소 ───────────────────────────────────────────────────────────────

export async function cancelPurchaseOrder(id: string) {
  const supabase = await createClient();

  const { data: po } = await (supabase as any)
    .from('purchase_orders')
    .select('status')
    .eq('id', id)
    .single();

  if (!po || !['DRAFT', 'CONFIRMED'].includes(po.status)) {
    return { error: '초안 또는 확정 상태의 발주서만 취소할 수 있습니다.' };
  }

  const { error } = await (supabase as any)
    .from('purchase_orders')
    .update({ status: 'CANCELLED' })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/purchases');
  revalidatePath(`/purchases/${id}`);
  return { success: true };
}

// ─── 입고 처리 ─────────────────────────────────────────────────────────────────

interface ReceiptItem {
  purchase_order_item_id: string;
  product_id: string;
  quantity: number;
}

export async function receivePurchaseOrder(formData: FormData) {
  const supabase = await createClient();
  const db = supabase as any;
  const userId = getUserId();

  const poId = formData.get('purchase_order_id') as string;
  const branchId = formData.get('branch_id') as string;
  const memo = formData.get('memo') as string || null;

  let receiptItems: ReceiptItem[] = [];
  try {
    receiptItems = JSON.parse(formData.get('items') as string);
  } catch {
    return { error: '입고 항목이 올바르지 않습니다.' };
  }

  const validItems = receiptItems.filter(i => i.quantity > 0);
  if (!validItems.length) return { error: '입고 수량을 1개 이상 입력해주세요.' };

  // 발주서 상태 검증
  const { data: po } = await db
    .from('purchase_orders')
    .select('status, items:purchase_order_items(*)')
    .eq('id', poId)
    .single();

  if (!po || !['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
    return { error: '확정 또는 부분입고 상태의 발주서만 입고 처리할 수 있습니다.' };
  }

  // 입고 수량 검증 (발주수량 초과 방지)
  for (const item of validItems) {
    const poItem = po.items.find((i: any) => i.id === item.purchase_order_item_id);
    if (!poItem) return { error: '발주 항목을 찾을 수 없습니다.' };
    const remaining = poItem.ordered_quantity - poItem.received_quantity;
    if (item.quantity > remaining) {
      return { error: `입고 수량이 잔여 발주 수량(${remaining}개)을 초과합니다.` };
    }
  }

  // 1. 입고 전표 생성
  const rcDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rcRand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const receiptNumber = `RC-${rcDate}-${rcRand}`;
  const totalReceiptAmount = validItems.reduce((s, i) => {
    const poItem = po.items.find((p: any) => p.id === i.purchase_order_item_id);
    return s + i.quantity * (poItem?.unit_price || 0);
  }, 0);

  const { data: receipt, error: receiptError } = await db
    .from('purchase_receipts')
    .insert({
      receipt_number: receiptNumber,
      purchase_order_id: poId,
      branch_id: branchId,
      received_by: userId,
      memo,
      received_at: new Date().toISOString(),
      total_amount: totalReceiptAmount,
    })
    .select('id')
    .single();

  if (receiptError) return { error: receiptError.message };

  const receiptId = receipt.id;

  try {
    // 2. 입고 항목 저장 (unit_price/total_price는 PO 항목에서 가져옴)
    await db.from('purchase_receipt_items').insert(
      validItems.map(i => {
        const poItem = po.items.find((p: any) => p.id === i.purchase_order_item_id);
        const unitPrice = poItem?.unit_price || 0;
        return {
          receipt_id: receiptId,
          purchase_order_item_id: i.purchase_order_item_id,
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: unitPrice,
          total_price: i.quantity * unitPrice,
        };
      })
    );

    // 3. 각 항목별 재고 처리
    for (const item of validItems) {
      // 발주 항목 received_quantity 업데이트
      const poItem = po.items.find((i: any) => i.id === item.purchase_order_item_id);
      await db
        .from('purchase_order_items')
        .update({ received_quantity: poItem.received_quantity + item.quantity })
        .eq('id', item.purchase_order_item_id);

      // 재고 증가
      const { data: inv } = await db
        .from('inventories')
        .select('id, quantity')
        .eq('branch_id', branchId)
        .eq('product_id', item.product_id)
        .maybeSingle();

      if (inv) {
        await db
          .from('inventories')
          .update({ quantity: inv.quantity + item.quantity })
          .eq('id', inv.id);
      } else {
        await db.from('inventories').insert({
          branch_id: branchId,
          product_id: item.product_id,
          quantity: item.quantity,
          safety_stock: 0,
        });
      }

      // 재고 이동 기록
      await db.from('inventory_movements').insert({
        branch_id: branchId,
        product_id: item.product_id,
        movement_type: 'IN',
        quantity: item.quantity,
        reference_id: receiptId,
        reference_type: 'PURCHASE_RECEIPT',
        memo: `발주서 ${po?.po_number || ''} 입고`,
      });
    }

    // 4. 발주서 상태 업데이트
    const updatedItems = await db
      .from('purchase_order_items')
      .select('ordered_quantity, received_quantity')
      .eq('purchase_order_id', poId);

    const allReceived = (updatedItems.data || []).every(
      (i: any) => i.received_quantity >= i.ordered_quantity
    );

    await db.from('purchase_orders').update({
      status: allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
      ...(allReceived ? { completed_at: new Date().toISOString() } : {}),
    }).eq('id', poId);

  } catch (err: any) {
    // 롤백: 입고 전표 삭제 (cascade로 receipt_items도 삭제)
    await db.from('purchase_receipts').delete().eq('id', receiptId);
    return { error: `입고 처리 실패: ${err.message}` };
  }

  writeAuditLog({ userId, action: 'CREATE', tableName: 'purchase_receipts', description: `입고 처리: ${receiptNumber}, 금액: ${totalReceiptAmount.toLocaleString()}원` }).catch(() => {});

  // 자동 분개: 재고자산 증가 / 미지급금 증가
  createPurchaseReceiptJournal({
    receiptId,
    receiptNumber,
    receiptDate: new Date().toISOString().slice(0, 10),
    totalAmount: totalReceiptAmount,
  }).catch(() => {}); // 분개 실패해도 입고는 성공으로 처리

  // 입고 시에도 단가 히스토리 기록(PO 대비 변동 없어도 하루 기준 upsert → 노이즈 없음)
  const supplierIdForHistory = (await db
    .from('purchase_orders')
    .select('supplier_id')
    .eq('id', poId)
    .single()).data?.supplier_id;
  if (supplierIdForHistory) {
    const items = validItems.map(i => {
      const poItem = po.items.find((p: any) => p.id === i.purchase_order_item_id);
      return { product_id: i.product_id, unit_price: Number(poItem?.unit_price || 0) };
    });
    await recordPurchasePrices(db, {
      supplierId: supplierIdForHistory,
      items,
      source: 'PO_RECEIVED',
      poId,
      userId,
    });
  }

  revalidatePath('/purchases');
  revalidatePath(`/purchases/${poId}`);
  revalidatePath('/inventory');
  return { success: true };
}

// ─── 공급사별 매입 단가 히스토리 조회 ────────────────────────────────────────

export async function getLatestSupplierPrice(supplierId: string, productId: string) {
  if (!supplierId || !productId) return { data: null };
  const supabase = await createClient();
  const { data } = await (supabase as any)
    .from('supplier_product_prices')
    .select('unit_price, effective_from, source, memo, created_at')
    .eq('supplier_id', supplierId)
    .eq('product_id', productId)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: data || null };
}

// 특정 제품의 공급사별 최근 단가 비교
export async function getSupplierPricesForProduct(productId: string) {
  if (!productId) return { data: [] };
  const supabase = await createClient();
  const db = supabase as any;

  // 각 공급사 × 해당 제품의 최신 row — LATERAL 대신 후처리로 간단히
  const { data: rows } = await db
    .from('supplier_product_prices')
    .select('supplier_id, unit_price, effective_from, source, supplier:suppliers(id, name, code)')
    .eq('product_id', productId)
    .order('effective_from', { ascending: false })
    .limit(500);

  const seen = new Set<string>();
  const latest: any[] = [];
  for (const r of (rows || []) as any[]) {
    if (seen.has(r.supplier_id)) continue;
    seen.add(r.supplier_id);
    latest.push(r);
  }
  // 낮은 단가 순 정렬
  latest.sort((a, b) => Number(a.unit_price) - Number(b.unit_price));
  return { data: latest };
}

// 특정 제품의 단가 이력 (최신순, 공급사명 포함)
export async function getProductPriceHistory(productId: string, limit = 50) {
  if (!productId) return { data: [] };
  const supabase = await createClient();
  const { data } = await (supabase as any)
    .from('supplier_product_prices')
    .select('id, unit_price, effective_from, source, memo, source_po_id, created_at, supplier:suppliers(id, name, code)')
    .eq('product_id', productId)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [] };
}

// 특정 공급사가 공급한 제품별 최신 단가
export async function getSupplierPriceSheet(supplierId: string) {
  if (!supplierId) return { data: [] };
  const supabase = await createClient();
  const db = supabase as any;

  const { data: rows } = await db
    .from('supplier_product_prices')
    .select('product_id, unit_price, effective_from, source, product:products(id, name, code, unit, product_type)')
    .eq('supplier_id', supplierId)
    .order('effective_from', { ascending: false })
    .limit(1000);

  const seen = new Set<string>();
  const latest: any[] = [];
  for (const r of (rows || []) as any[]) {
    if (seen.has(r.product_id)) continue;
    seen.add(r.product_id);
    latest.push(r);
  }
  return { data: latest };
}

// 수동 단가 등록
export async function recordManualSupplierPrice(
  supplierId: string,
  productId: string,
  unitPrice: number,
  opts?: { effective_from?: string; memo?: string },
) {
  if (!supplierId || !productId || !(unitPrice >= 0)) {
    return { error: '필수 입력값을 확인해 주세요.' };
  }
  const supabase = await createClient();
  const userId = getUserId();
  const { error } = await (supabase as any)
    .from('supplier_product_prices')
    .upsert({
      supplier_id: supplierId,
      product_id: productId,
      unit_price: Math.round(unitPrice),
      effective_from: opts?.effective_from || new Date().toISOString().slice(0, 10),
      source: 'MANUAL',
      memo: opts?.memo || null,
      created_by: userId,
    }, { onConflict: 'supplier_id,product_id,effective_from' });
  if (error) return { error: error.message };
  revalidatePath('/purchases');
  revalidatePath('/purchases/prices');
  return { success: true };
}
