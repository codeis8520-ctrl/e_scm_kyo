'use server';

// ════════════════════════════════════════════════════════════════════════════
// 스마트스토어 주문 엑셀 임포트 — 미리보기/매핑 (Phase 3)
//
//  previewSmartstoreOrders: 파일+비번 → 복호화·파싱 → 상품매핑/회원매칭/중복 판정 →
//    화면 미리보기 구조 반환(생성 안 함). 읽기 전용.
//  saveSmartstoreMapping: (상품번호,옵션) → 내부 product 매핑 upsert(미매핑 채우기).
//  commit(전표 생성)은 별도 — processPosCheckout 재사용 예정(Phase 4).
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { parseSmartstoreExcel, normalizePhone, type SmartstoreOrder } from './parse';
import { deductOnlineOrderInventory } from '@/lib/cafe24/online-inventory';
import { createSaleJournal } from '@/lib/accounting-actions';

export interface SSItemPreview {
  productOrderNo: string;
  productNo: string;
  productName: string;
  option: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  mappedProductId: string | null;   // 매핑된 내부 제품
  mappedProductName: string | null;
}
export interface SSOrderPreview {
  orderNo: string;
  orderedAt: string | null;
  paidAt: string | null;
  status: string;
  payMethod: string;
  revenue: number;                   // 매출(= Σ lineTotal)
  buyerName: string;
  buyerPhone: string;                // 정규화(숫자만)
  recipientName: string;
  recipientAddress: string;
  courier: string;
  trackingNo: string;
  alreadyImported: boolean;          // smartstore_order_id 존재 → 중복
  customerId: string | null;         // 전화 매칭된 회원
  customerName: string | null;
  items: SSItemPreview[];
  unmappedCount: number;
}
export interface SSPreviewResult {
  ok: true;
  orders: SSOrderPreview[];
  summary: { total: number; newOrders: number; duplicates: number; unmappedItems: number; matchedMembers: number };
  // 미매핑 품목(매핑 UI용) — (상품번호,옵션) 유니크
  unmapped: { productNo: string; option: string; productName: string }[];
}
export type SSPreviewError = { ok: false; error: string };

const mapKey = (productNo: string, option: string) => `${productNo}\n${option}`;

async function resolveOrders(db: any, parsed: SmartstoreOrder[]): Promise<SSPreviewResult> {
  // 1) 매핑 테이블 로드
  const { data: maps } = await db.from('smartstore_product_map').select('smartstore_product_no, option_value, product_id');
  const mapByKey = new Map<string, string>();
  for (const m of (maps as any[]) || []) mapByKey.set(mapKey(String(m.smartstore_product_no), String(m.option_value ?? '')), m.product_id);
  const mappedIds = [...new Set([...mapByKey.values()])];
  const nameById = new Map<string, string>();
  if (mappedIds.length) {
    const { data: prods } = await db.from('products').select('id, name').in('id', mappedIds);
    for (const p of (prods as any[]) || []) nameById.set(p.id, p.name);
  }

  // 2) 중복(기존 smartstore_order_id)
  const orderNos = parsed.map((o) => o.orderNo).filter(Boolean);
  const existing = new Set<string>();
  if (orderNos.length) {
    const { data: ex } = await db.from('sales_orders').select('smartstore_order_id').in('smartstore_order_id', orderNos);
    for (const e of (ex as any[]) || []) if (e.smartstore_order_id) existing.add(String(e.smartstore_order_id));
  }

  // 3) 회원 매칭(구매자 전화) — customers.phone 정규화 비교
  const phones = [...new Set(parsed.map((o) => normalizePhone(o.buyer.phone)).filter(Boolean))];
  const custByPhone = new Map<string, { id: string; name: string }>();
  if (phones.length) {
    // customers.phone 도 정규화 비교 — DB엔 하이픈 포함 가능하므로 후보를 넓게 가져와 JS에서 정규화 매칭
    const { data: cs } = await db.from('customers').select('id, name, phone').eq('is_active', true);
    for (const c of (cs as any[]) || []) {
      const np = normalizePhone(c.phone);
      if (np && !custByPhone.has(np)) custByPhone.set(np, { id: c.id, name: c.name });
    }
  }

  const unmappedSet = new Map<string, { productNo: string; option: string; productName: string }>();
  let unmappedItems = 0, matchedMembers = 0, duplicates = 0;

  const orders: SSOrderPreview[] = parsed.map((o) => {
    const bp = normalizePhone(o.buyer.phone);
    const cust = bp ? custByPhone.get(bp) : undefined;
    if (cust) matchedMembers++;
    const already = existing.has(o.orderNo);
    if (already) duplicates++;
    let unmapped = 0;
    const items: SSItemPreview[] = o.items.map((it) => {
      const pid = mapByKey.get(mapKey(it.productNo, it.option)) || null;
      if (!pid) {
        unmapped++; unmappedItems++;
        const k = mapKey(it.productNo, it.option);
        if (!unmappedSet.has(k)) unmappedSet.set(k, { productNo: it.productNo, option: it.option, productName: it.productName });
      }
      return {
        productOrderNo: it.productOrderNo, productNo: it.productNo, productName: it.productName,
        option: it.option, quantity: it.quantity, unitPrice: it.unitPrice, lineTotal: it.lineTotal,
        mappedProductId: pid, mappedProductName: pid ? (nameById.get(pid) ?? null) : null,
      };
    });
    return {
      orderNo: o.orderNo, orderedAt: o.orderedAt, paidAt: o.paidAt, status: o.status, payMethod: o.payMethod,
      revenue: o.items.reduce((s, x) => s + x.lineTotal, 0),
      buyerName: o.buyer.name, buyerPhone: bp,
      recipientName: o.recipient.name, recipientAddress: `${o.recipient.address} ${o.recipient.addressDetail}`.trim(),
      courier: o.shipping.courier, trackingNo: o.shipping.trackingNo,
      alreadyImported: already, customerId: cust?.id ?? null, customerName: cust?.name ?? null,
      items, unmappedCount: unmapped,
    };
  });

  return {
    ok: true,
    orders,
    summary: {
      total: orders.length,
      newOrders: orders.filter((o) => !o.alreadyImported).length,
      duplicates,
      unmappedItems,
      matchedMembers,
    },
    unmapped: [...unmappedSet.values()],
  };
}

/** 파일+비번 → 미리보기(생성 없음). */
export async function previewSmartstoreOrders(formData: FormData): Promise<SSPreviewResult | SSPreviewError> {
  try { await requireSession(); } catch (e: any) { return { ok: false, error: e.message }; }
  const file = formData.get('file') as File | null;
  const password = String(formData.get('password') || '');
  if (!file) return { ok: false, error: '파일을 선택하세요.' };
  let parsed: SmartstoreOrder[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    parsed = parseSmartstoreExcel(buf, password);
  } catch (e: any) {
    if (e?.message === 'PASSWORD_REQUIRED') return { ok: false, error: '비밀번호를 입력하세요.' };
    if (e?.message === 'PASSWORD_INVALID') return { ok: false, error: '비밀번호가 올바르지 않습니다.' };
    return { ok: false, error: `엑셀 분석 실패: ${e?.message || 'unknown'}` };
  }
  if (parsed.length === 0) return { ok: false, error: '주문 데이터가 없습니다. 올바른 발주발송관리 엑셀인지 확인하세요.' };
  const db = (await createClient()) as any;
  return resolveOrders(db, parsed);
}

/** (상품번호,옵션) → 내부 product 매핑 upsert. */
export async function saveSmartstoreMapping(input: {
  smartstore_product_no: string; option_value: string; product_id: string; product_name?: string;
}): Promise<{ success: true } | { error: string }> {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  if (!input.smartstore_product_no || !input.product_id) return { error: '상품번호/내부 제품이 필요합니다.' };
  const db = (await createClient()) as any;
  const { error } = await db.from('smartstore_product_map').upsert({
    smartstore_product_no: input.smartstore_product_no,
    option_value: input.option_value || '',
    product_id: input.product_id,
    product_name_snapshot: input.product_name || null,
  }, { onConflict: 'smartstore_product_no,option_value' });
  if (error) return { error: `매핑 저장 실패: ${error.message}` };
  revalidatePath('/pos');
  return { success: true };
}

// 스마트스토어 결제수단 → 내부 분개 수금계정 결정용. 온라인 정산이라 카드성 미수금(1120)으로 통일.
//   원본 표기는 payment_info 에 보존.
const SS_PAYMENT_METHOD = 'card';

export interface SSCommitResult {
  success: true;
  created: number;
  skippedDuplicate: number;
  skippedUnmapped: number;
  skippedOrderNos: string[];
}

/** 파일+비번 재파싱 → 매핑·중복 재판정 → 신규·전량매핑 주문만 전표·재고·배송·분개 생성. */
export async function commitSmartstoreOrders(formData: FormData): Promise<SSCommitResult | { error: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }
  const file = formData.get('file') as File | null;
  const password = String(formData.get('password') || '');
  if (!file) return { error: '파일을 선택하세요.' };

  let parsed: SmartstoreOrder[];
  try {
    parsed = parseSmartstoreExcel(Buffer.from(await file.arrayBuffer()), password);
  } catch (e: any) {
    if (e?.message === 'PASSWORD_REQUIRED') return { error: '비밀번호를 입력하세요.' };
    if (e?.message === 'PASSWORD_INVALID') return { error: '비밀번호가 올바르지 않습니다.' };
    return { error: `엑셀 분석 실패: ${e?.message || 'unknown'}` };
  }
  if (parsed.length === 0) return { error: '주문 데이터가 없습니다.' };

  const db = (await createClient()) as any;

  // 본사(출고·매출처) — is_headquarters
  const { data: hq } = await db.from('branches').select('id, name, sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail').eq('is_headquarters', true).maybeSingle();
  if (!hq?.id) return { error: '본사(is_headquarters) 지점이 없어 임포트할 수 없습니다.' };
  const hqId = hq.id;

  // 매핑·중복·회원·제품메타 일괄 로드
  const { data: maps } = await db.from('smartstore_product_map').select('smartstore_product_no, option_value, product_id');
  const mapByKey = new Map<string, string>();
  for (const m of (maps as any[]) || []) mapByKey.set(mapKey(String(m.smartstore_product_no), String(m.option_value ?? '')), m.product_id);

  const orderNos = parsed.map((o) => o.orderNo).filter(Boolean);
  const existing = new Set<string>();
  if (orderNos.length) {
    const { data: ex } = await db.from('sales_orders').select('smartstore_order_id').in('smartstore_order_id', orderNos);
    for (const e of (ex as any[]) || []) if (e.smartstore_order_id) existing.add(String(e.smartstore_order_id));
  }

  const phones = [...new Set(parsed.map((o) => normalizePhone(o.buyer.phone)).filter(Boolean))];
  const custByPhone = new Map<string, string>();
  if (phones.length) {
    const { data: cs } = await db.from('customers').select('id, phone').eq('is_active', true);
    for (const c of (cs as any[]) || []) { const np = normalizePhone(c.phone); if (np && !custByPhone.has(np)) custByPhone.set(np, c.id); }
  }

  // 매핑된 제품 메타(원가·과세) — cogs·taxable 계산용
  const allPids = [...new Set([...mapByKey.values()])];
  const metaById = new Map<string, { cost: number; taxable: boolean }>();
  if (allPids.length) {
    const { data: prods } = await db.from('products').select('id, cost, is_taxable').in('id', allPids);
    for (const p of (prods as any[]) || []) metaById.set(p.id, { cost: Number(p.cost) || 0, taxable: p.is_taxable !== false });
  }

  let created = 0, skippedDuplicate = 0, skippedUnmapped = 0;
  const skippedOrderNos: string[] = [];

  for (const o of parsed) {
    if (existing.has(o.orderNo)) { skippedDuplicate++; continue; }
    // 전량 매핑된 주문만 생성(미매핑 있으면 재고·원가 부정확 → 매핑 후 재시도)
    const resolved = o.items.map((it) => ({ it, pid: mapByKey.get(mapKey(it.productNo, it.option)) || null }));
    if (resolved.some((r) => !r.pid)) { skippedUnmapped++; skippedOrderNos.push(o.orderNo); continue; }

    const gross = o.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
    const net = o.items.reduce((s, it) => s + it.lineTotal, 0);          // 매출(VAT 포함)
    const discount = Math.max(0, gross - net);
    const taxableNet = resolved.reduce((s, r) => s + (metaById.get(r.pid!)?.taxable ? r.it.lineTotal : 0), 0);
    const cogs = resolved.reduce((s, r) => s + (metaById.get(r.pid!)?.cost || 0) * r.it.quantity, 0);
    const orderedAt = o.paidAt || o.orderedAt || new Date().toISOString();
    const receiptStatus = o.shipping.trackingNo ? 'PARCEL_SHIPPED' : 'PARCEL_PLANNED';
    const payInfoLines = [`스마트스토어 결제수단: ${o.payMethod || '-'}`, o.shippingFee ? `배송비 ${o.shippingFee.toLocaleString('ko-KR')}원` : ''].filter(Boolean);

    // 1) 주문
    const { data: newOrder, error: oErr } = await db.from('sales_orders').insert({
      order_number: `SS-${o.orderNo}`,
      channel: 'SMARTSTORE',
      branch_id: hqId,
      ship_from_branch_id: hqId,
      smartstore_order_id: o.orderNo,
      customer_id: custByPhone.get(normalizePhone(o.buyer.phone)) ?? null,
      buyer_name: o.buyer.name || null,
      buyer_phone: o.buyer.phone || null,
      recipient_name: o.recipient.name || null,
      recipient_phone: o.recipient.phone || null,
      recipient_zipcode: o.recipient.zipcode || null,
      recipient_address: o.recipient.address || null,
      recipient_address_detail: o.recipient.addressDetail || null,
      ordered_by: session.id,
      total_amount: gross,
      discount_amount: discount,
      taxable_amount: taxableNet,
      exempt_amount: Math.max(0, net - taxableNet),
      status: 'COMPLETED',
      payment_method: SS_PAYMENT_METHOD,
      ordered_at: orderedAt,
      receipt_status: receiptStatus,
      receipt_date: (o.shipping.shippedAt || orderedAt).slice(0, 10),
      payment_info: payInfoLines.join('\n'),
    }).select('id').single();
    if (oErr || !newOrder) {
      // unique(smartstore_order_id) 경합 → 이미 생성됨으로 간주(멱등)
      if (String(oErr?.message || '').toLowerCase().includes('duplicate')) { skippedDuplicate++; continue; }
      return { error: `주문 생성 실패(${o.orderNo}): ${oErr?.message}` };
    }
    const orderId = newOrder.id;

    // 2) 품목
    const itemRows = resolved.map((r) => ({
      sales_order_id: orderId,
      product_id: r.pid,
      item_text: r.it.productName || null,
      quantity: r.it.quantity,
      unit_price: r.it.unitPrice,
      total_price: r.it.lineTotal,
      order_option: r.it.option || null,
      smartstore_product_order_no: r.it.productOrderNo,
      delivery_type: 'PARCEL',
      receipt_status: receiptStatus,
    }));
    await db.from('sales_order_items').insert(itemRows);

    // 3) 재고 차감(본사·ONLINE_SALE·멱등). 팬텀/미추적은 skip(카페24 동일 — 알려진 갭).
    await deductOnlineOrderInventory(db, orderId);

    // 4) 배송(송장)
    if (o.shipping.trackingNo || o.recipient.address) {
      await db.from('shipments').insert({
        sales_order_id: orderId,
        branch_id: hqId,
        source: 'smartstore',
        delivery_type: 'PARCEL',
        status: o.shipping.trackingNo ? 'SHIPPED' : 'PENDING',
        tracking_number: o.shipping.trackingNo || null,
        sender_name: hq.sender_name || null,
        sender_phone: hq.sender_phone || null,
        sender_zipcode: hq.sender_zipcode || null,
        sender_address: hq.sender_address || null,
        sender_address_detail: hq.sender_address_detail || null,
        recipient_name: o.recipient.name || null,
        recipient_phone: o.recipient.phone || null,
        recipient_zipcode: o.recipient.zipcode || null,
        recipient_address: o.recipient.address || null,
        recipient_address_detail: o.recipient.addressDetail || null,
        delivery_message: o.recipient.message || null,
        ...(o.shipping.shippedAt ? { created_at: o.shipping.shippedAt } : {}),
      });
    }

    // 5) 매출 분개(포인트·알림톡 없음). 매출=net(VAT 포함), 과세분만 VAT 분리.
    await createSaleJournal({
      orderId,
      orderNumber: `SS-${o.orderNo}`,
      orderDate: (o.paidAt || orderedAt).slice(0, 10),
      totalAmount: net,
      paymentMethod: SS_PAYMENT_METHOD,
      cogs,
      taxableAmount: taxableNet,
      sourceType: 'SALE',
      createdBy: session.id,
    });

    created++;
  }

  revalidatePath('/pos');
  revalidatePath('/inventory');
  return { success: true, created, skippedDuplicate, skippedUnmapped, skippedOrderNos };
}
