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
