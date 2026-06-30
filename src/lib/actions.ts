'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fireNotificationTrigger } from '@/lib/notification-triggers';
import { computeBomCost } from '@/lib/production-actions';
import { kstTodayString } from '@/lib/date';
import { requireSession, type SessionUser } from '@/lib/session';
import { toNum, parseStockInput } from '@/lib/validators';
import { createSaleJournal } from '@/lib/accounting-actions';

// ============ Products ============

export async function getProducts(search?: string) {
  const supabase = await createClient();
  let query = supabase.from('products').select('*, category:categories(*)').order('created_at', { ascending: false });
  
  if (search) {
    const s = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    query = query.or(`name.ilike."%${s}%",code.ilike."%${s}%"`);
  }

  const { data } = await query;
  return { data: data || [] };
}

export async function createProduct(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get('name') as string;
  // 제품코드 — 사용자가 입력했으면 그 값(uppercase), 비웠으면 자동 생성
  const rawCode = ((formData.get('code') as string) || '').trim().toUpperCase();
  let code: string;
  if (rawCode) {
    code = rawCode;
  } else {
    const nameCode = name
      .replace(/[^a-zA-Z0-9가-힣]/g, '')
      .substring(0, 4)
      .toUpperCase()
      .padEnd(4, 'X');
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    code = `KYO-${nameCode}-${randomCode}`;
  }

  const rawCategoryId = formData.get('category_id') as string;
  const rawBarcode = formData.get('barcode') as string;
  const rawImageUrl = formData.get('image_url') as string;
  const rawSpec = formData.get('spec') as string;
  const rawType = formData.get('product_type') as string;
  const productType = ['RAW', 'SUB', 'FINISHED', 'SERVICE'].includes(rawType) ? rawType : 'FINISHED';
  const rawCostSource = formData.get('cost_source') as string;
  let costSource: 'MANUAL' | 'BOM' = (rawCostSource === 'BOM' ? 'BOM' : 'MANUAL');
  if (productType !== 'FINISHED') costSource = 'MANUAL'; // RAW/SUB/SERVICE는 항상 수동

  const priceInput = parseInt(formData.get('price') as string);
  const costInput = parseInt(formData.get('cost') as string) || null;

  // RAW/SUB는 판매가 UI가 숨겨지므로 price = cost로 동기화 (schema NOT NULL 회피)
  // SERVICE는 판매가 그대로 사용
  const finalPrice = (productType === 'RAW' || productType === 'SUB')
    ? (costInput || 0)
    : (Number.isFinite(priceInput) ? priceInput : 0);

  // 재고 관리 여부 — 폼에서 명시. SERVICE 기본값 false, 그 외 true.
  const rawTrack = formData.get('track_inventory');
  const trackInventory = rawTrack == null
    ? (productType === 'SERVICE' ? false : true)
    : rawTrack !== 'false';

  // Phantom BOM 여부 — 완제품에만 의미. true면 본인 재고는 차감 안 함(track_inventory 자동 false).
  const rawPhantom = formData.get('is_phantom');
  const isPhantom = rawPhantom == null ? false : rawPhantom === 'true';
  const finalTrackInventory = isPhantom ? false : trackInventory;

  // 판매등록 위젯 노출 — 폼값 우선, 부재 시 규칙(FINISHED & 비-phantom) 폴백.
  const rawPosWidget = formData.get('pos_widget');
  const posWidget = rawPosWidget == null
    ? (productType === 'FINISHED' && !isPhantom)
    : rawPosWidget === 'true';

  // 소수점 재고 허용(#28) — 폼값 우선, 부재 시 false. 비허용 제품은 기존 정수 동작 유지.
  const rawAllowDecimal = formData.get('allow_decimal_stock');
  const allowDecimalStock = rawAllowDecimal == null ? false : rawAllowDecimal === 'true';

  // 박스 분해/재포장 — pack_child_id 와 pack_child_qty 는 짝으로만 의미. Phantom 과 배타.
  const rawPackChildId = formData.get('pack_child_id');
  const rawPackChildQty = formData.get('pack_child_qty');
  const packChildId = (typeof rawPackChildId === 'string' && rawPackChildId && rawPackChildId !== 'null')
    ? rawPackChildId : null;
  const packChildQtyNum = rawPackChildQty == null ? NaN : parseInt(String(rawPackChildQty), 10);
  const packChildQty = (packChildId && Number.isFinite(packChildQtyNum) && packChildQtyNum > 0)
    ? packChildQtyNum : null;
  const finalPackChildId = (packChildQty && packChildId) ? packChildId : null;

  const productData: any = {
    name,
    code,
    category_id: (rawCategoryId && rawCategoryId !== 'null') ? rawCategoryId : null,
    product_type: productType,
    cost_source: costSource,
    unit: formData.get('unit') as string || '개',
    price: finalPrice,
    cost: costInput,
    barcode: (rawBarcode && rawBarcode !== 'null' && productType === 'FINISHED') ? rawBarcode : null,
    is_taxable: formData.get('is_taxable') !== 'false',
    image_url: rawImageUrl || null,
    spec: rawSpec ? JSON.parse(rawSpec) : {},
    description: (formData.get('description') as string) || null,
    track_inventory: finalTrackInventory,
    is_phantom: isPhantom,
    pos_widget: posWidget,
    allow_decimal_stock: allowDecimalStock,
    pack_child_id: finalPackChildId,
    pack_child_qty: finalPackChildId ? packChildQty : null,
  };

  // 마이그 087/071/066/061/059 미적용 폴백 — 컬럼이 없으면 단계적으로 제거 후 재시도
  let { data: newProduct, error } = await (supabase as any)
    .from('products').insert(productData).select().single();
  if (error && /allow_decimal_stock/i.test(String(error.message))) {
    delete productData.allow_decimal_stock;
    const retry = await (supabase as any).from('products').insert(productData).select().single();
    newProduct = retry.data; error = retry.error;
  }
  if (error && /pos_widget/i.test(String(error.message))) {
    delete productData.pos_widget;
    const retry = await (supabase as any).from('products').insert(productData).select().single();
    newProduct = retry.data; error = retry.error;
  }
  if (error && /pack_child/i.test(String(error.message))) {
    delete productData.pack_child_id;
    delete productData.pack_child_qty;
    const retry = await (supabase as any).from('products').insert(productData).select().single();
    newProduct = retry.data; error = retry.error;
  }
  if (error && /is_phantom/i.test(String(error.message))) {
    delete productData.is_phantom;
    const retry = await (supabase as any).from('products').insert(productData).select().single();
    newProduct = retry.data; error = retry.error;
  }
  if (error && /column.*track_inventory|track_inventory.*does not exist/i.test(String(error.message))) {
    delete productData.track_inventory;
    const retry = await (supabase as any).from('products').insert(productData).select().single();
    newProduct = retry.data; error = retry.error;
  }
  if (error && /violates check constraint.*products_product_type_check/i.test(String(error.message))) {
    return { error: '제품 유형(SERVICE)이 DB에 반영되지 않았습니다. Supabase에 migration 059를 적용해 주세요.' };
  }

  if (error) {
    return { error: error.message };
  }

  // 제품 생성 시 활성 지점에 재고 레코드 자동 생성 — 본인 재고 추적 대상일 때만
  // (phantom=true이면 finalTrackInventory=false → inventories 행 안 만듦)
  if (finalTrackInventory) {
    const { data: branches } = await supabase
      .from('branches')
      .select('id')
      .eq('is_active', true);

    if (branches && branches.length > 0) {
      const inventoryRecords = branches.map((branch: any) => ({
        product_id: newProduct.id,
        branch_id: branch.id,
        quantity: 0,
        safety_stock: 0,
      }));

      await supabase.from('inventories').insert(inventoryRecords as any);
    }
  }

  revalidatePath('/products');
  revalidatePath('/inventory');
  return { success: true };
}

export async function updateProduct(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const rawCategoryId = formData.get('category_id') as string;
  const rawBarcode = formData.get('barcode') as string;
  const rawImageUrl = formData.get('image_url') as string;
  const rawCode = (formData.get('code') as string)?.trim().toUpperCase();
  const rawSpec = formData.get('spec') as string;
  const rawType = formData.get('product_type') as string;
  const productType = ['RAW', 'SUB', 'FINISHED', 'SERVICE'].includes(rawType) ? rawType : undefined;
  const rawCostSource = formData.get('cost_source') as string;
  const costSource: 'MANUAL' | 'BOM' | undefined =
    rawCostSource === 'BOM' ? 'BOM' : rawCostSource === 'MANUAL' ? 'MANUAL' : undefined;
  const finalCostSource = (productType === 'RAW' || productType === 'SUB' || productType === 'SERVICE')
    ? 'MANUAL' : costSource;

  const priceInput = parseInt(formData.get('price') as string);
  const costInput = parseInt(formData.get('cost') as string) || null;

  // RAW/SUB은 판매가 UI가 숨겨지므로 price = cost (NOT NULL 회피)
  const isMaterial = productType === 'RAW' || productType === 'SUB';
  const finalPrice = isMaterial
    ? (costInput || 0)
    : (Number.isFinite(priceInput) ? priceInput : 0);

  const rawTrack = formData.get('track_inventory');
  const trackInventory = rawTrack == null ? undefined : rawTrack !== 'false';

  // Phantom BOM — true면 본인 재고 차감 X, BOM 분해 차감. track_inventory 자동 false.
  const rawPhantom = formData.get('is_phantom');
  const isPhantom = rawPhantom == null ? undefined : rawPhantom === 'true';
  const finalTrackInventory = isPhantom === true ? false : trackInventory;

  // 판매등록 위젯 노출 — 폼값 우선. 부재 시: product_type 명시되면 규칙(FINISHED & 비-phantom) 폴백, 아니면 미변경.
  const rawPosWidget = formData.get('pos_widget');
  const posWidget = rawPosWidget != null
    ? rawPosWidget === 'true'
    : (productType !== undefined ? (productType === 'FINISHED' && isPhantom !== true) : undefined);

  // 소수점 재고 허용(#28) — 폼값 있을 때만 갱신(없으면 미변경).
  const rawAllowDecimal = formData.get('allow_decimal_stock');
  const allowDecimalStock = rawAllowDecimal == null ? undefined : rawAllowDecimal === 'true';

  // 박스 분해/재포장 — pack_child_id / pack_child_qty 짝으로만 의미.
  const rawPackChildId = formData.get('pack_child_id');
  const rawPackChildQty = formData.get('pack_child_qty');
  const packChildIdPresent = rawPackChildId != null;
  const packChildId = (typeof rawPackChildId === 'string' && rawPackChildId && rawPackChildId !== 'null')
    ? rawPackChildId : null;
  const packChildQtyNum = rawPackChildQty == null ? NaN : parseInt(String(rawPackChildQty), 10);
  const packChildQty = (packChildId && Number.isFinite(packChildQtyNum) && packChildQtyNum > 0)
    ? packChildQtyNum : null;
  const finalPackChildId = (packChildQty && packChildId) ? packChildId : null;

  const productData: any = {
    name: formData.get('name') as string,
    ...(rawCode ? { code: rawCode } : {}),
    category_id: (rawCategoryId && rawCategoryId !== 'null') ? rawCategoryId : null,
    ...(productType ? { product_type: productType } : {}),
    ...(finalCostSource ? { cost_source: finalCostSource } : {}),
    unit: formData.get('unit') as string || '개',
    price: finalPrice,
    cost: costInput,
    // 완제품 외 유형은 바코드 보유 의미가 없어 비움
    barcode: (rawBarcode && rawBarcode !== 'null' && productType === 'FINISHED') ? rawBarcode : null,
    is_active: formData.get('is_active') === 'true',
    is_taxable: formData.get('is_taxable') !== 'false',
    image_url: rawImageUrl || null,
    ...(rawSpec ? { spec: JSON.parse(rawSpec) } : {}),
    description: (formData.get('description') as string) || null,
    ...(finalTrackInventory !== undefined ? { track_inventory: finalTrackInventory } : {}),
    ...(isPhantom !== undefined ? { is_phantom: isPhantom } : {}),
    ...(posWidget !== undefined ? { pos_widget: posWidget } : {}),
    ...(allowDecimalStock !== undefined ? { allow_decimal_stock: allowDecimalStock } : {}),
    // pack_child_* 는 폼에 포함되어 있을 때만(=명시적으로 비우려는 의도 포함) 갱신
    ...(packChildIdPresent ? { pack_child_id: finalPackChildId, pack_child_qty: finalPackChildId ? packChildQty : null } : {}),
  };

  // 마이그 087/071/066/061/059 미적용 폴백 — 단계적으로 컬럼 제거 후 재시도
  let res = await (supabase as any).from('products').update(productData).eq('id', id);
  let error = res.error;
  if (error && /allow_decimal_stock/i.test(String(error.message))) {
    delete productData.allow_decimal_stock;
    res = await (supabase as any).from('products').update(productData).eq('id', id);
    error = res.error;
  }
  if (error && /pos_widget/i.test(String(error.message))) {
    delete productData.pos_widget;
    res = await (supabase as any).from('products').update(productData).eq('id', id);
    error = res.error;
  }
  if (error && /pack_child/i.test(String(error.message))) {
    delete productData.pack_child_id;
    delete productData.pack_child_qty;
    res = await (supabase as any).from('products').update(productData).eq('id', id);
    error = res.error;
  }
  if (error && /is_phantom/i.test(String(error.message))) {
    delete productData.is_phantom;
    res = await (supabase as any).from('products').update(productData).eq('id', id);
    error = res.error;
  }
  if (error && /column.*track_inventory|track_inventory.*does not exist/i.test(String(error.message))) {
    delete productData.track_inventory;
    res = await (supabase as any).from('products').update(productData).eq('id', id);
    error = res.error;
  }

  if (error) {
    return { error: error.message };
  }

  // 후처리: BOM 원가 자동 반영
  //   1) 완제품이 cost_source=BOM이면 BOM 합계로 cost 재산정
  //   2) RAW/SUB의 cost가 바뀌었으면 이를 사용하는 완제품(cost_source=BOM)의 cost 재산정
  try {
    const db = supabase as any;
    if (productType === 'FINISHED' && finalCostSource === 'BOM') {
      const newCost = await computeBomCost(id);
      await db.from('products').update({ cost: newCost }).eq('id', id);
    }
    if (isMaterial) {
      const { data: usedRows } = await db
        .from('product_bom')
        .select('product_id')
        .eq('material_id', id);
      const usedIds = [...new Set(((usedRows || []) as any[]).map((r: any) => r.product_id))];
      for (const pid of usedIds) {
        const { data: p } = await db
          .from('products')
          .select('id, cost_source, product_type')
          .eq('id', pid)
          .maybeSingle();
        if (p?.cost_source === 'BOM' && p?.product_type === 'FINISHED') {
          const newCost = await computeBomCost(pid as string);
          await db.from('products').update({ cost: newCost }).eq('id', pid);
        }
      }
    }
  } catch (err) {
    console.error('[updateProduct] BOM cost roll-up failed (ignored):', err);
  }

  revalidatePath('/products');
  revalidatePath('/production');
  return { success: true };
}

// ─── 제품 일괄 등록 (엑셀 임포트) ─────────────────────────────────────────
//   매칭 키: code (UNIQUE). 빈 코드는 자동 생성하여 새로 등록.
//   카테고리는 pathName / pathCode / leafName 순으로 매칭.
export type ProductImportRow = {
  name: string;
  code?: string;
  product_type?: string;        // FINISHED | RAW | SUB | SERVICE
  unit?: string;
  price?: number | string;
  cost?: number | string;
  barcode?: string;
  is_taxable?: string;          // 과세 | 면세
  track_inventory?: string;     // 예 | 아니오
  category?: string;            // 경로명 / [코드] / 잎 이름
  description?: string;
};

function normalizeIntInput(v: any): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v).replace(/[^0-9.-]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// 카테고리 트리 빌드 + 매칭 헬퍼 (서버 사이드)
function buildServerCategoryMap(categories: any[]): {
  byPathName: Map<string, string>;
  byPathCode: Map<string, string>;
  byLeafName: Map<string, string>; // 첫 번째 매칭만
} {
  const byParent = new Map<string | null, any[]>();
  for (const c of categories) {
    const list = byParent.get(c.parent_id ?? null) || [];
    list.push(c);
    byParent.set(c.parent_id ?? null, list);
  }
  for (const list of byParent.values()) {
    list.sort((a: any, b: any) => (a.sort_order - b.sort_order) || String(a.name).localeCompare(b.name, 'ko'));
  }
  const byPathName = new Map<string, string>();
  const byPathCode = new Map<string, string>();
  const byLeafName = new Map<string, string>();
  const walk = (pid: string | null, parentCode: string, parentName: string) => {
    const list = byParent.get(pid) || [];
    list.forEach((c: any, i: number) => {
      const pos = i + 1;
      const pathCode = parentCode ? `${parentCode}-${pos}` : String(pos);
      const pathName = parentName ? `${parentName} / ${c.name}` : c.name;
      byPathCode.set(pathCode, c.id);
      byPathName.set(pathName, c.id);
      if (!byLeafName.has(c.name)) byLeafName.set(c.name, c.id);
      walk(c.id, pathCode, pathName);
    });
  };
  walk(null, '', '');
  return { byPathName, byPathCode, byLeafName };
}

// 엑셀 카테고리 경로(A / B / C)를 DB 계층으로 자동 생성.
// 이미 있는 노드는 건드리지 않고, 없는 노드만 생성 후 갱신된 전체 목록 반환.
async function ensureCategoryPaths(paths: string[], db: any): Promise<any[]> {
  const { data: existing } = await db.from('categories').select('id, name, parent_id, sort_order');
  const all: any[] = existing || [];

  // parentId(null='__root__') → name → id 빠른 조회용
  const lookup = new Map<string, Map<string, string>>();
  const key = (pid: string | null) => pid ?? '__root__';
  for (const c of all) {
    if (!lookup.has(key(c.parent_id))) lookup.set(key(c.parent_id), new Map());
    lookup.get(key(c.parent_id))!.set(c.name, c.id);
  }

  let created = false;
  for (const path of paths) {
    const parts = path.split('/').map((p: string) => p.trim()).filter(Boolean);
    let parentId: string | null = null;
    for (const part of parts) {
      const k = key(parentId);
      if (!lookup.has(k)) lookup.set(k, new Map());
      if (!lookup.get(k)!.has(part)) {
        const { data } = await db
          .from('categories')
          .insert({ name: part, parent_id: parentId, sort_order: 0 })
          .select('id')
          .single();
        if (data?.id) {
          lookup.get(k)!.set(part, data.id);
          all.push({ id: data.id, name: part, parent_id: parentId, sort_order: 0 });
          created = true;
        }
      }
      parentId = lookup.get(k)!.get(part) ?? null;
    }
  }

  if (created) {
    const { data: fresh } = await db.from('categories').select('id, name, parent_id, sort_order');
    return fresh || [];
  }
  return all;
}

function resolveCategoryId(
  raw: string | undefined,
  maps: ReturnType<typeof buildServerCategoryMap>,
): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // [1-1-1] 또는 1-1-1 형식
  const codeMatch = s.match(/^\[?\s*([\d-]+)\s*\]?$/);
  if (codeMatch) {
    const code = codeMatch[1];
    if (maps.byPathCode.has(code)) return maps.byPathCode.get(code)!;
  }
  // 경로명: "A / B / C"
  if (s.includes('/')) {
    const normalized = s.split('/').map(p => p.trim()).filter(Boolean).join(' / ');
    if (maps.byPathName.has(normalized)) return maps.byPathName.get(normalized)!;
  }
  // 잎 이름 매칭
  if (maps.byLeafName.has(s)) return maps.byLeafName.get(s)!;
  return null;
}

// 행 가공 헬퍼 — 사이드 이펙트 없는 순수 함수
function normalizeProductType(v: string | undefined): 'FINISHED' | 'RAW' | 'SUB' | 'SERVICE' {
  const s = (v || '').trim();
  if (!s) return 'FINISHED';
  const map: Record<string, 'FINISHED' | 'RAW' | 'SUB' | 'SERVICE'> = {
    '완제품': 'FINISHED', '원자재': 'RAW', '부자재': 'SUB',
    '무형상품': 'SERVICE', '서비스': 'SERVICE',
  };
  if (map[s]) return map[s];
  const upper = s.toUpperCase();
  return (['FINISHED', 'RAW', 'SUB', 'SERVICE'] as const).includes(upper as any) ? upper as any : 'FINISHED';
}
function normalizeIsTaxable(v: string | undefined): boolean {
  const s = (v || '').trim();
  if (!s) return true;
  return !['면세', 'EXEMPT', 'FALSE', '아니오', 'X'].includes(s.toUpperCase());
}
function normalizeTrackInventory(v: string | undefined, productType: string): boolean {
  const s = (v || '').trim();
  if (s) return !['아니오', 'NO', 'FALSE', 'N', 'X'].includes(s.toUpperCase());
  return productType !== 'SERVICE';
}

// 일괄 import — Vercel Hobby(10초 함수 timeout) 환경 안정성을 위해
//   ① 사전 조회는 1회씩  ② 행 가공은 메모리에서  ③ DB 쓰기는 batch upsert + bulk insert로
// 처리량: 433행 ≈ 1~3초 (기존 sequential 35~60초 → 약 20배 단축)
export async function bulkImportProducts(rows: ProductImportRow[]) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: '등록할 행이 없습니다.', created: 0, updated: 0, skipped: [] };
  }
  if (rows.length > 1000) {
    return { error: '한 번에 최대 1000행까지 처리할 수 있습니다.', created: 0, updated: 0, skipped: [] };
  }

  const supabase = await createClient();
  const db = supabase as any;

  // ① 사전 조회 (병렬) — 활성 지점
  const branchesRes = await db.from('branches').select('id').eq('is_active', true);
  const activeBranchIds = ((branchesRes.data || []) as any[]).map((b: any) => b.id);

  // ① 카테고리: 엑셀 경로 기준으로 없는 계층 자동 생성 후 맵 빌드
  const uniqueCatPaths = Array.from(new Set(
    rows.map(r => (r.category || '').trim()).filter(Boolean)
  ));
  const freshCats = await ensureCategoryPaths(uniqueCatPaths, db);
  const catMaps = buildServerCategoryMap(freshCats);

  // ② 기존 제품 전체 컬럼 조회 — merge용 (빈 칸은 기존 값 유지)
  const inputCodes = Array.from(new Set(rows.map(r => (r.code || '').trim()).filter(Boolean)));
  const existingByCode = new Map<string, any>();
  if (inputCodes.length > 0) {
    for (let i = 0; i < inputCodes.length; i += 200) {
      const chunk = inputCodes.slice(i, i + 200);
      const { data } = await db.from('products')
        .select('id, code, name, product_type, unit, price, cost, barcode, is_taxable, track_inventory, category_id, description')
        .in('code', chunk);
      for (const p of (data || []) as any[]) existingByCode.set(p.code, p);
    }
  }

  // ③ 행 가공 — 메모리에서 모든 검증·merge 끝내기
  type Validated =
    | { ok: true; rowNo: number; code: string; isExisting: boolean; trackInventory: boolean; upsertRow: any }
    | { ok: false; rowNo: number; reason: string };

  const validated: Validated[] = [];
  const usedCodes = new Set<string>(); // 같은 batch 내 코드 중복 방지

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    const name = (r.name || '').trim();
    if (!name) { validated.push({ ok: false, rowNo, reason: '제품명 누락' }); continue; }

    const productType = normalizeProductType(r.product_type);
    const unit = (r.unit || '개').trim() || '개';
    const priceRaw = normalizeIntInput(r.price);
    const costRaw = normalizeIntInput(r.cost);
    const finalPrice = (productType === 'RAW' || productType === 'SUB')
      ? (costRaw ?? 0) : (priceRaw ?? 0);
    const isTaxable = normalizeIsTaxable(r.is_taxable);
    const trackInventory = normalizeTrackInventory(r.track_inventory, productType);
    const categoryId = resolveCategoryId(r.category, catMaps);

    const inputCode = (r.code || '').trim();
    const existing = inputCode ? existingByCode.get(inputCode) : undefined;

    // 코드 자동 생성 (신규 + 입력 없을 때)
    let codeToUse = inputCode;
    if (!existing && !codeToUse) {
      const nameCode = name.replace(/[^a-zA-Z0-9가-힣]/g, '').substring(0, 4).toUpperCase().padEnd(4, 'X');
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
      codeToUse = `KYO-${nameCode}-${rand}`;
    }

    if (usedCodes.has(codeToUse)) {
      validated.push({ ok: false, rowNo, reason: `같은 batch 내 코드 중복: ${codeToUse}` });
      continue;
    }
    usedCodes.add(codeToUse);

    let upsertRow: any;
    if (existing) {
      // 빈 칸이 아닌 항목만 새 값 사용 — 그 외엔 기존 값 유지 (기존 동작 보존)
      upsertRow = {
        id: existing.id,
        code: codeToUse,
        name, // 제품명은 항상 update (필수값)
        product_type: r.product_type ? productType : existing.product_type,
        unit: r.unit ? unit : existing.unit,
        price: (priceRaw != null || productType === 'RAW' || productType === 'SUB') ? finalPrice : existing.price,
        cost: costRaw != null ? costRaw : existing.cost,
        barcode: r.barcode
          ? ((productType === 'FINISHED' && String(r.barcode).trim()) ? String(r.barcode).trim() : null)
          : existing.barcode,
        is_taxable: r.is_taxable ? isTaxable : existing.is_taxable,
        track_inventory: r.track_inventory ? trackInventory : existing.track_inventory,
        category_id: categoryId ?? existing.category_id,
        description: r.description ? ((r.description || '').trim() || null) : existing.description,
      };
    } else {
      upsertRow = {
        code: codeToUse,
        name,
        product_type: productType,
        unit,
        price: finalPrice,
        cost: costRaw,
        barcode: (productType === 'FINISHED' && r.barcode) ? String(r.barcode).trim() || null : null,
        is_taxable: isTaxable,
        track_inventory: trackInventory,
        category_id: categoryId,
        description: (r.description || '').trim() || null,
        cost_source: 'MANUAL',
      };
    }

    validated.push({ ok: true, rowNo, code: codeToUse, isExisting: !!existing, trackInventory, upsertRow });
  }

  const validRows = validated.filter((v): v is Extract<Validated, { ok: true }> => v.ok);
  const skipped: { row: number; reason: string }[] = validated
    .filter((v): v is Extract<Validated, { ok: false }> => !v.ok)
    .map(e => ({ row: e.rowNo, reason: e.reason }));

  if (validRows.length === 0) {
    return { created: 0, updated: 0, skipped };
  }

  // ④ products upsert — chunk 단위로 안전하게
  //    PostgREST 본문 크기·트랜잭션 길이 고려해 100행씩
  const PRODUCT_CHUNK = 100;
  const upsertedRows: { id: string; code: string }[] = [];

  for (let i = 0; i < validRows.length; i += PRODUCT_CHUNK) {
    const slice = validRows.slice(i, i + PRODUCT_CHUNK);
    let payload = slice.map(v => v.upsertRow);

    let res = await db.from('products')
      .upsert(payload, { onConflict: 'code' })
      .select('id, code');

    // 마이그 059 미적용 폴백 — track_inventory 컬럼 제거 후 재시도
    if (res.error && /track_inventory/i.test(String(res.error.message))) {
      payload = payload.map(p => { const x = { ...p }; delete x.track_inventory; return x; });
      res = await db.from('products')
        .upsert(payload, { onConflict: 'code' })
        .select('id, code');
    }

    // 마이그 059 미적용 + product_type='SERVICE' 충돌 폴백
    if (res.error && /product_type_check/i.test(String(res.error.message))) {
      const filtered: any[] = [];
      const sliceMap = new Map(slice.map(v => [v.upsertRow.code, v]));
      for (const p of payload) {
        if (p.product_type === 'SERVICE') {
          const v = sliceMap.get(p.code);
          if (v) skipped.push({ row: v.rowNo, reason: 'product_type SERVICE 미적용 — migration 059 필요' });
        } else {
          filtered.push(p);
        }
      }
      if (filtered.length > 0) {
        res = await db.from('products')
          .upsert(filtered, { onConflict: 'code' })
          .select('id, code');
      } else {
        continue;
      }
    }

    if (res.error) {
      const reason = `등록 실패: ${res.error.message}`;
      for (const v of slice) skipped.push({ row: v.rowNo, reason });
      continue;
    }
    upsertedRows.push(...((res.data as any[]) || []));
  }

  // ⑤ created/updated 카운트 + 신규 + track_inventory=true 모음
  const validByCode = new Map(validRows.map(v => [v.code, v]));
  let created = 0;
  let updated = 0;
  const newProductIds: string[] = [];
  for (const u of upsertedRows) {
    const v = validByCode.get(u.code);
    if (!v) continue;
    if (v.isExisting) updated++;
    else {
      created++;
      if (v.trackInventory) newProductIds.push(u.id);
    }
  }

  // ⑥ inventories bulk INSERT — 신규 + track_inventory=true × 활성 지점
  if (newProductIds.length > 0 && activeBranchIds.length > 0) {
    const invRows: any[] = [];
    for (const pid of newProductIds) {
      for (const bid of activeBranchIds) {
        invRows.push({ product_id: pid, branch_id: bid, quantity: 0, safety_stock: 0 });
      }
    }
    const INV_CHUNK = 500;
    for (let i = 0; i < invRows.length; i += INV_CHUNK) {
      const chunk = invRows.slice(i, i + INV_CHUNK);
      const { error } = await db.from('inventories').insert(chunk);
      if (error) console.error('[bulkImportProducts] inventories insert failed:', error.message);
    }
  }

  revalidatePath('/products');
  revalidatePath('/inventory');
  return { created, updated, skipped };
}

export async function deleteProduct(id: string) {
  const supabase = await createClient();


  const { error } = await supabase.from('products').delete().eq('id', id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/products');
  return { success: true };
}

// 제품 일괄 삭제 — 선택된 id들을 한 번에 처리.
//   참조된 데이터(BOM·발주·매출 등)에 의해 막히는 경우는 개별 실패로 분리.
//
// 주의: products는 inventories.product_id에서 참조됨(ON DELETE 명시 없음 → NO ACTION).
//   개별 deleteProduct가 성공하던 이유: 사용자가 등록한 직후 inventories rows가
//   quantity=0으로 자동 생성되지만, Supabase REST는 NO ACTION을 RESTRICT처럼 처리.
//   사실 개별 .delete()가 성공한다면, 해당 제품에 inventories row가 모두 삭제 가능한
//   상태였거나(다른 트리거가 사전 정리), 또는 관련 row가 없는 경우.
//   따라서 inventories를 사전 정리(자식부터 삭제)한 뒤 본 row 삭제로 일관성 확보.
export async function bulkDeleteProducts(ids: string[]) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { error: '삭제할 제품이 없습니다.', deleted: 0, failed: [] };
  }
  const supabase = await createClient();
  const db = supabase as any;

  const DELETE_CHUNK = 200;
  let totalDeleted = 0;
  const allFailed: { id: string; reason: string }[] = [];

  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const chunk = ids.slice(i, i + DELETE_CHUNK);

    // 1) 자식 테이블 사전 정리
    await db.from('inventories').delete().in('product_id', chunk);
    await db.from('inventory_movements').delete().in('product_id', chunk);
    await db.from('product_files').delete().in('product_id', chunk);
    await db.from('product_bom').delete().in('product_id', chunk);
    await db.from('product_bom').delete().in('material_id', chunk);

    // 2) 일괄 시도
    const tryBulk = await db.from('products').delete().in('id', chunk);
    if (!tryBulk.error) {
      totalDeleted += chunk.length;
      continue;
    }

    console.warn('[bulkDeleteProducts] chunk 일괄 실패, 개별 시도:', tryBulk.error);

    // 3) 일괄 실패 시 개별 시도 — FK 위반 등 정확한 실패 id 식별
    for (const id of chunk) {
      const r = await db.from('products').delete().eq('id', id);
      if (r.error) {
        allFailed.push({ id, reason: r.error.message });
      } else {
        totalDeleted++;
      }
    }
  }

  revalidatePath('/products');
  revalidatePath('/inventory');
  return { deleted: totalDeleted, failed: allFailed };
}

// ============ Customers ============

export async function getCustomers(search?: string, grade?: string) {
  const supabase = await createClient();
  let query = supabase.from('customers').select('*, primary_branch:branches(*)').order('created_at', { ascending: false });
  
  if (search) {
    const s = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    query = query.or(`name.ilike."%${s}%",phone.ilike."%${s}%"`);
  }


  if (grade) {
    query = query.eq('grade', grade);
  }
  
  const { data } = await query;
  return { data: data || [] };
}

export async function createCustomer(formData: FormData) {
  const supabase = await createClient();
  

  const customerData = {
    name: formData.get('name') as string,
    phone: formData.get('phone') as string,
    phone2: (formData.get('phone2') as string)?.trim() || null,
    email: formData.get('email') as string || null,
    address: formData.get('address') as string || null,
    grade: formData.get('grade') as string || 'NORMAL',
    primary_branch_id: formData.get('primary_branch_id') as string || null,
    health_note: formData.get('health_note') as string || null,
  };

  // @ts-ignore
  const { error } = await supabase.from('customers').insert(customerData);

  if (error) {
    return { error: error.message };
  }

  // 신규 회원가입 알림톡 자동 발송 (매핑 등록된 경우만)
  if (customerData.name && customerData.phone) {
    fireNotificationTrigger({
      eventType: 'WELCOME',
      customer: { name: customerData.name, phone: customerData.phone },
      context: { customerGrade: customerData.grade },
    }).catch(() => {});
  }

  revalidatePath('/customers');
  return { success: true };
}

export async function updateCustomer(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const customerData = {
    name: formData.get('name') as string,
    phone: formData.get('phone') as string,
    phone2: (formData.get('phone2') as string)?.trim() || null,
    email: formData.get('email') as string || null,
    address: formData.get('address') as string || null,
    grade: formData.get('grade') as string || 'NORMAL',
    primary_branch_id: formData.get('primary_branch_id') as string || null,
    health_note: formData.get('health_note') as string || null,
    is_active: formData.get('is_active') === 'true',
  };

  // @ts-ignore
  const { error } = await supabase.from('customers').update(customerData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/customers');
  return { success: true };
}

// ─── 고객 일괄 등록 (엑셀 임포트) ─────────────────────────────────────────────
//   매칭 키: phone (UNIQUE). 기존 고객은 빈 칸이 아닌 항목만 업데이트 — 덮어쓰기 X.
//   primary_branch_name(지점명)은 서버에서 branches.id로 변환 후 저장.
export type CustomerImportRow = {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  grade?: string;
  health_note?: string;
  primary_branch_name?: string;
};

const NORMALIZE_PHONE_RE = /[\s\-]/g;
function normalizeImportPhone(p: string): string {
  return (p || '').replace(NORMALIZE_PHONE_RE, '');
}
function isValidImportPhone(p: string): boolean {
  const c = normalizeImportPhone(p);
  return /^(0\d{7,10}|1\d{7,8})$/.test(c);
}

export async function bulkImportCustomers(rows: CustomerImportRow[]) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: '등록할 행이 없습니다.', created: 0, updated: 0, skipped: [] };
  }
  if (rows.length > 1000) {
    return { error: '한 번에 최대 1000행까지 처리할 수 있습니다.', created: 0, updated: 0, skipped: [] };
  }

  const supabase = await createClient();
  const db = supabase as any;

  // 지점 매핑 (이름 → id)
  const { data: branches } = await db.from('branches').select('id, name').eq('is_active', true);
  const branchByName = new Map<string, string>();
  for (const b of (branches || []) as any[]) branchByName.set(String(b.name).trim(), b.id);

  // 기존 고객 phone → id 매핑 (배치 조회)
  const phones = Array.from(new Set(
    rows.map(r => normalizeImportPhone(r.phone || '')).filter(Boolean)
  ));
  const existingByPhone = new Map<string, string>();
  if (phones.length > 0) {
    // chunk 200씩
    for (let i = 0; i < phones.length; i += 200) {
      const chunk = phones.slice(i, i + 200);
      const { data: existing } = await db
        .from('customers').select('id, phone').in('phone', chunk);
      for (const c of (existing || []) as any[]) {
        existingByPhone.set(normalizeImportPhone(c.phone), c.id);
      }
    }
  }

  let created = 0;
  let updated = 0;
  const skipped: { row: number; reason: string }[] = [];
  const newCustomers: { name: string; phone: string; grade: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    const name = (r.name || '').trim();
    const phone = (r.phone || '').trim();
    if (!name) { skipped.push({ row: rowNo, reason: '이름 누락' }); continue; }
    if (!phone) { skipped.push({ row: rowNo, reason: '연락처 누락' }); continue; }
    if (!isValidImportPhone(phone)) { skipped.push({ row: rowNo, reason: `연락처 형식 오류 (${phone})` }); continue; }

    const grade = ['NORMAL', 'VIP', 'VVIP'].includes((r.grade || '').toUpperCase().trim())
      ? (r.grade || 'NORMAL').toUpperCase().trim()
      : 'NORMAL';

    const branchId = r.primary_branch_name
      ? (branchByName.get(String(r.primary_branch_name).trim()) || null)
      : null;

    const phoneNorm = normalizeImportPhone(phone);
    const existingId = existingByPhone.get(phoneNorm);

    const baseRow: any = {
      name,
      phone,
      email: (r.email || '').trim() || null,
      address: (r.address || '').trim() || null,
      grade,
      health_note: (r.health_note || '').trim() || null,
      primary_branch_id: branchId,
    };

    if (existingId) {
      // 빈 칸이 아닌 항목만 업데이트 — 기존 데이터 보존
      const patch: any = { name };
      if (baseRow.email)         patch.email = baseRow.email;
      if (baseRow.address)       patch.address = baseRow.address;
      if (baseRow.grade)         patch.grade = baseRow.grade;
      if (baseRow.health_note)   patch.health_note = baseRow.health_note;
      if (baseRow.primary_branch_id) patch.primary_branch_id = baseRow.primary_branch_id;

      const { error } = await db.from('customers').update(patch).eq('id', existingId);
      if (error) skipped.push({ row: rowNo, reason: `업데이트 실패: ${error.message}` });
      else updated++;
    } else {
      const { error } = await db.from('customers').insert(baseRow);
      if (error) {
        // 23505 = unique_violation (다른 행에서 같은 phone이 먼저 들어간 경우)
        skipped.push({ row: rowNo, reason: `등록 실패: ${error.message}` });
      } else {
        created++;
        existingByPhone.set(phoneNorm, '_new'); // 같은 batch에서 중복 등록 방지
        newCustomers.push({ name, phone, grade });
      }
    }
  }

  // WELCOME 알림톡 fire-and-forget (실패해도 결과에 영향 X)
  for (const c of newCustomers) {
    fireNotificationTrigger({
      eventType: 'WELCOME',
      customer: { name: c.name, phone: c.phone },
      context: { customerGrade: c.grade },
    }).catch(() => {});
  }

  revalidatePath('/customers');
  return { created, updated, skipped };
}

export async function deleteCustomer(id: string) {
  const supabase = await createClient();


  const { error } = await supabase.from('customers').delete().eq('id', id);

  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/customers');
  return { success: true };
}

// ─── 고객 병합 (동명이인 분리 → 1인 통합) ─────────────────────────────────────
//   보조(secondary)의 모든 참조를 대표(primary)로 이전 후 보조 삭제 (원자적 RPC).
//   보조 전화번호는 대표 phone2 에 보존. point_history balance 는 재계산 안 함.
export async function mergeCustomers(primaryId: string, secondaryId: string) {
  if (!primaryId || !secondaryId) return { error: '대표/보조 고객을 모두 지정하세요' };
  if (primaryId === secondaryId) return { error: '같은 고객끼리는 병합할 수 없습니다' };

  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc('merge_customers', {
    p_primary: primaryId,
    p_secondary: secondaryId,
  });
  if (error) return { error: error.message };

  revalidatePath('/customers');
  revalidatePath(`/customers/${primaryId}`);
  return { success: true, ...(data || {}) };
}

// ============ Inventory ============

export async function getInventory(branchId?: string, search?: string) {
  const supabase = await createClient();
  let query = supabase
    .from('inventories')
    .select('*, branch:branches(*), product:products(*)')
    .order('updated_at', { ascending: false });
  
  if (branchId) {
    query = query.eq('branch_id', branchId);
  }
  
  if (search) {
    const s = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    query = query.or(`product.name.ilike."%${s}%",product.code.ilike."%${s}%"`);
  }


  const { data } = await query;
  return { data: data || [] };
}

export async function adjustInventory(formData: FormData) {
  const session = await requireSession();
  if (session.role !== 'SUPER_ADMIN' && session.role !== 'HQ_OPERATOR') {
    return { error: '재고 조정은 본사 권한만 가능합니다.' };
  }

  const supabase = await createClient();
  const db = supabase as any;

  const branchId = formData.get('branch_id') as string;
  const productId = formData.get('product_id') as string;
  const movementType = formData.get('movement_type') as string;
  const memo = formData.get('memo') as string;

  // ── 소수점 재고 허용 제품 판정 (#28) ──
  //   allow_decimal_stock=true 면 수량/안전재고를 소수(4자리)로 파싱·저장. 비허용은 정수 강제.
  //   폴백: 마이그 087 미적용 시 컬럼 부재 → 정수 동작 유지.
  let allowDecimal = false;
  let productType: string | null = null;
  try {
    let prodRes: any = await db
      .from('products').select('product_type, allow_decimal_stock').eq('id', productId).maybeSingle();
    if (prodRes?.error && /allow_decimal_stock/i.test(String(prodRes.error.message))) {
      prodRes = await db.from('products').select('product_type').eq('id', productId).maybeSingle();
    }
    productType = prodRes?.data?.product_type ?? null;
    allowDecimal = prodRes?.data?.allow_decimal_stock === true;
  } catch {
    // 폴백 — 정수 동작 유지
  }

  const quantity = parseStockInput(formData.get('quantity') as string, allowDecimal);
  const safetyStock = parseStockInput(formData.get('safety_stock') as string, allowDecimal);

  // ── 원자재·부자재는 본사(is_headquarters=true)에서만 입출고·조정 허용 ──
  //   OEM 위탁 생산 모델에서 RAW/SUB는 본사 관리 원칙(CLAUDE.md 생산관리 섹션).
  //   폴백: 마이그 042(product_type) 또는 047(is_headquarters) 미적용 시 제한 생략.
  try {
    const pt: string | null = productType;
    if (pt === 'RAW' || pt === 'SUB') {
      const hqRes = await db.from('branches').select('id').eq('is_headquarters', true).maybeSingle();
      const hqId: string | null = hqRes?.data?.id ?? null;
      if (hqId && branchId !== hqId) {
        return { error: '원자재·부자재 재고는 본사에서만 입출고·조정할 수 있습니다.' };
      }
    }
  } catch {
    // 폴백 — 컬럼 부재 등으로 확인 실패 시 제한 생략
  }

  const { data: currentArr } = await supabase
    .from('inventories')
    .select('quantity, safety_stock')
    .eq('branch_id', branchId)
    .eq('product_id', productId);
  
  const current = currentArr?.[0] as any;

  if (!current) {
    await supabase.from('inventories').insert({
      branch_id: branchId,
      product_id: productId,
      quantity: Math.abs(quantity),
      safety_stock: safetyStock,
    } as any);
  } else {
    let newQuantity: number;
    if (movementType === 'IN') {
      newQuantity = toNum(current.quantity) + quantity;
    } else if (movementType === 'OUT') {
      newQuantity = toNum(current.quantity) - quantity;
    } else {
      newQuantity = quantity;
    }
    
    await supabase
      .from('inventories')
      // @ts-ignore
      .update({
        // 음수 허용 — 가차감/마이너스 재고 누적 반영
        quantity: newQuantity,
        safety_stock: safetyStock
      })
      .eq('branch_id', branchId)
      .eq('product_id', productId);
  }

  await supabase.from('inventory_movements').insert({
    branch_id: branchId,
    product_id: productId,
    movement_type: movementType,
    quantity: quantity,
    reference_type: 'MANUAL',
    memo: memo || null,
  } as any);

  revalidatePath('/inventory');
  return { success: true };
}

// 강제조정 다건(#79 재고변동전표) — 각 품목 재고를 target 값으로 SET(맞춤). 본사 권한 전용.
//   기존 안전재고 보존. 이력은 델타(target−현재고) 부호로 IN/OUT, reference_type='MANUAL'.
//   RAW/SUB는 본사 지점에서만. 음수 target 허용(가차감/마이너스 재고 반영).
export async function adjustInventoryBatch(input: {
  branch_id: string;
  memo?: string;
  items: { product_id: string; target_quantity: number }[];
}): Promise<{ success?: true; count?: number; error?: string }> {
  const session = await requireSession();
  if (session.role !== 'SUPER_ADMIN' && session.role !== 'HQ_OPERATOR') {
    return { error: '강제 조정은 본사 권한(본부대표·HQ)만 가능합니다.' };
  }
  const supabase = await createClient();
  const db = supabase as any;
  const branchId = input.branch_id;
  const items = input.items || [];
  if (!branchId) return { error: '창고(지점)를 선택하세요.' };
  if (items.length === 0) return { error: '조정 품목을 1개 이상 추가하세요.' };

  // 검증 — 수량 유효성 + RAW/SUB 본사 제한(전수 통과 후 시작)
  let hqId: string | null = null;
  try { const r = await db.from('branches').select('id').eq('is_headquarters', true).maybeSingle(); hqId = r?.data?.id ?? null; } catch { /* 폴백 */ }
  for (const it of items) {
    if (!it.product_id) return { error: '품목 정보가 올바르지 않습니다.' };
    if (!Number.isFinite(it.target_quantity)) return { error: '조정(목표) 수량을 올바르게 입력하세요.' };
    if (hqId && branchId !== hqId) {
      const pr = await db.from('products').select('name, product_type').eq('id', it.product_id).maybeSingle();
      const pt: string | null = pr?.data?.product_type ?? null;
      if (pt === 'RAW' || pt === 'SUB') {
        return { error: `'${pr?.data?.name ?? it.product_id}' 원자재·부자재는 본사에서만 조정할 수 있습니다.` };
      }
    }
  }

  for (const it of items) {
    const target = it.target_quantity;
    const { data: curArr } = await db.from('inventories').select('id, quantity').eq('branch_id', branchId).eq('product_id', it.product_id);
    const cur = curArr?.[0];
    const before = cur ? toNum(cur.quantity) : 0;
    const delta = target - before;
    if (cur) {
      await db.from('inventories').update({ quantity: target }).eq('id', cur.id);  // 안전재고는 보존(미터치)
    } else {
      await db.from('inventories').insert({ branch_id: branchId, product_id: it.product_id, quantity: target, safety_stock: 0 });
    }
    if (delta !== 0) {
      await db.from('inventory_movements').insert({
        branch_id: branchId, product_id: it.product_id,
        movement_type: delta > 0 ? 'IN' : 'OUT', quantity: Math.abs(delta),
        reference_type: 'MANUAL', memo: input.memo || '강제 조정(맞춤)', created_by: session.id,
      });
    }
  }

  revalidatePath('/inventory');
  return { success: true, count: items.length };
}

// 재고 소모(사용유형) 다건 일괄 OUT 차감 — 판매 아님.
// inventory_movements 에 reference_type='USAGE' + usage_type_id 로 기록. 음수 재고 허용.
// 2-pass: 1) 검증+RAW/SUB 본사제한 전수 통과해야 시작, 2) 라인별 실제 차감.
export async function recordStockUsage(input: {
  branch_id: string;
  usage_type_id: string;
  memo?: string;
  items: { product_id: string; quantity: number }[];
}) {
  // #51 서버측 지점 권한검증 — UI(자기 지점만)와 동일하게 강제(직접 호출 우회 차단).
  //   HQ급은 전 지점, 지점고정 직원은 본인 지점 재고만 소모 가능. assertFromBranchOwnership 재사용.
  const session = await requireSession();
  const ownErr = assertFromBranchOwnership(session, input.branch_id);
  if (ownErr) return ownErr;

  const supabase = await createClient();
  const db = supabase as any;

  const branchId = input.branch_id;
  const usageTypeId = input.usage_type_id;
  const memo = input.memo;
  const items = input.items || [];

  // ── pass 1: 검증 (전체 거부, 처리 전) ──
  if (!branchId) return { error: '지점을 선택하세요.' };
  if (!usageTypeId) return { error: '사용유형을 선택하세요.' };
  if (items.length === 0) return { error: '소모 품목을 1개 이상 추가하세요.' };
  for (const item of items) {
    if (!item.product_id) return { error: '품목 정보가 올바르지 않습니다.' };
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return { error: '소모 수량은 1개 이상의 정수여야 합니다.' };
    }
  }

  // ── pass 1: 원자재·부자재 본사(is_headquarters=true) 제한 — adjustInventory 패턴 재사용 ──
  //   OEM 위탁 생산 모델에서 RAW/SUB는 본사 관리 원칙(CLAUDE.md 생산관리 섹션).
  //   폴백: product_type / is_headquarters 컬럼 미적용 시 제한 생략.
  try {
    const hqRes = await db.from('branches').select('id').eq('is_headquarters', true).maybeSingle();
    const hqId: string | null = hqRes?.data?.id ?? null;
    if (hqId && branchId !== hqId) {
      for (const item of items) {
        const prodRes = await db
          .from('products')
          .select('name, product_type')
          .eq('id', item.product_id)
          .maybeSingle();
        const pt: string | null = prodRes?.data?.product_type ?? null;
        if (pt === 'RAW' || pt === 'SUB') {
          const label: string = prodRes?.data?.name ?? item.product_id;
          return { error: `'${label}' 원자재·부자재는 본사에서만 소모 처리할 수 있습니다.` };
        }
      }
    }
  } catch {
    // 폴백 — 컬럼 부재 등으로 확인 실패 시 제한 생략
  }

  // ── pass 1.5: 품목 메타(팬텀/재고추적) 로드 ──
  //   팬텀(침향 10환 등)은 본인 재고가 없고 product_bom 으로 base(침향 30환)에서 분수 차감 —
  //   판매(processPosCheckout)와 동일 규칙. 소수점 재고 자재는 4자리 반올림, 아니면 올림.
  const itemIds = items.map((i) => i.product_id);
  let metaRows: any[] = [];
  {
    let r: any = await db.from('products').select('id, name, is_phantom, track_inventory').in('id', itemIds);
    if (r.error && /is_phantom/i.test(String(r.error?.message))) {
      r = await db.from('products').select('id, name, track_inventory').in('id', itemIds);
    }
    metaRows = r.error ? [] : (r.data || []);
  }
  const metaById = new Map<string, any>(metaRows.map((p: any) => [p.id, p]));

  // 단일 품목 OUT 차감 + 이력 1건 (음수 재고 허용). 순차 호출이라 동일 자재 중복도 안전(매번 재읽기).
  const deductOne = async (productId: string, qty: number, lineMemo: string | null) => {
    const { data: curArr } = await db
      .from('inventories').select('quantity')
      .eq('branch_id', branchId).eq('product_id', productId);
    const cur = curArr?.[0];
    if (!cur) {
      // 행 없음 → 음수 재고 행 생성 (소모는 OUT 이므로 음수가 맞음. abs 분기 복붙 금지.)
      await db.from('inventories').insert({ branch_id: branchId, product_id: productId, quantity: -qty, safety_stock: 0 });
    } else {
      await db.from('inventories').update({ quantity: toNum(cur.quantity) - qty }) // 음수 허용
        .eq('branch_id', branchId).eq('product_id', productId);
    }
    await db.from('inventory_movements').insert({
      branch_id: branchId, product_id: productId, movement_type: 'OUT',
      quantity: qty, reference_type: 'USAGE', usage_type_id: usageTypeId, memo: lineMemo,
      created_by: session.id, // 처리자(자가사용·시음·로스 등록자) — 변동 이력 표시용
    });
  };

  // ── pass 2: 실제 차감 (라인 루프, 비트랜잭션 — 기존 코드 일관) ──
  for (const item of items) {
    const meta = metaById.get(item.product_id);
    // 팬텀: BOM 분해 → base 자재에서 분수 차감 (예: 침향 10환 1개 → 침향 30환 0.333)
    if (meta?.is_phantom === true) {
      const { data: bomRows } = await db.from('product_bom')
        .select('material_id, quantity').eq('product_id', item.product_id);
      const bom = (bomRows as any[]) || [];
      if (bom.length === 0) continue; // BOM 없는 팬텀 — 차감 대상 없음(skip)
      const matIds = bom.map((b) => b.material_id);
      let decRows: any[] = [];
      {
        const r: any = await db.from('products').select('id, allow_decimal_stock').in('id', matIds);
        decRows = r.error ? [] : (r.data || []); // 087 미적용 폴백 → 전부 올림
      }
      const decById = new Map<string, boolean>(decRows.map((m: any) => [m.id, m.allow_decimal_stock === true]));
      const phantomMemo = [memo, `세트분해: ${meta.name || ''} ×${item.quantity}`].filter(Boolean).join(' · ');
      for (const c of bom) {
        const raw = toNum(c.quantity) * item.quantity;
        const qty = decById.get(c.material_id) ? Math.round(raw * 10000) / 10000 : Math.ceil(raw);
        if (qty <= 0) continue;
        await deductOne(c.material_id, qty, phantomMemo);
      }
      continue;
    }
    // 재고 비관리(SERVICE 등): skip
    if (meta && meta.track_inventory === false) continue;
    // 일반 제품: 직접 차감
    await deductOne(item.product_id, item.quantity, memo || null);
  }

  revalidatePath('/inventory');
  return { success: true, count: items.length };
}

// 재고이동 출발지(from_branch) 소유 검증 — 단건/다건이 공유(로직 드리프트 방지).
// HQ급(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE)은 출발지 자유.
// 지점고정(BRANCH_STAFF/PHARMACY_STAFF)은 본인 지점 출고만 허용.
//   - branch_id가 null(본인 지점 미상)이면 안전측으로 거부.
// 도착지(to_branch)는 검증하지 않는다(타지점 입고 허용 — 기존 UI 정책).
// null이면 통과, { error } 객체면 호출부에서 그대로 return.
function assertFromBranchOwnership(
  session: SessionUser,
  fromBranchId: string,
): { error: string } | null {
  const HQ_ROLES = ['SUPER_ADMIN', 'HQ_OPERATOR', 'EXECUTIVE'];
  if (HQ_ROLES.includes(session.role)) return null;

  // 지점고정 직원: 본인 지점 미상이거나 출발지가 본인 지점이 아니면 거부.
  if (!session.branch_id || session.branch_id !== fromBranchId) {
    return { error: '본인 지점의 재고만 출고할 수 있습니다.' };
  }
  return null;
}

// 이동일자(YYYY-MM-DD) → inventory_movements.created_at 타임스탬프.
//   재고이동 기록의 날짜는 created_at(이력 모달·필터 기준)이라, 사용자가 고른 이동일자를
//   created_at 에 그대로 반영한다. 정오(KST)로 고정 — UTC/KST 어느 쪽에서 봐도 같은 날짜.
//   유효한 날짜가 아니면 undefined → DB 기본값 now() 사용.
function transferDateToTimestamp(dateStr?: string | null): string | undefined {
  const s = (dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  return `${s}T12:00:00+09:00`;
}

export async function transferInventory(formData: FormData) {
  const supabase = await createClient();
  const db = supabase as any;

  const fromBranchId = formData.get('from_branch_id') as string;
  const toBranchId = formData.get('to_branch_id') as string;
  const productId = formData.get('product_id') as string;
  const quantity = parseInt(formData.get('quantity') as string);
  const memo = formData.get('memo') as string;
  // 출발(출고)일 = OUT 기록 날짜, 도착예정일 = IN 기록 날짜. 미입력 시 now().
  const shipAt = transferDateToTimestamp(formData.get('ship_date') as string);
  const arriveAt = transferDateToTimestamp(formData.get('arrival_date') as string) ?? shipAt;

  const session = await requireSession();
  const denied = assertFromBranchOwnership(session, fromBranchId);
  if (denied) return { error: denied.error };

  if (fromBranchId === toBranchId) {
    return { error: '동일 지점 간 이동은 할 수 없습니다.' };
  }

  if (quantity <= 0) {
    return { error: '이동 수량은 1개 이상이어야 합니다.' };
  }

  const fromInventory = await db
    .from('inventories')
    .select('quantity')
    .eq('branch_id', fromBranchId)
    .eq('product_id', productId)
    .single();

  if (!fromInventory.data || toNum(fromInventory.data.quantity) < quantity) {
    return { error: '이동 수량이 출고 지점의 재고보다 많습니다.' };
  }

  const toInventory = await db
    .from('inventories')
    .select('id, quantity')
    .eq('branch_id', toBranchId)
    .eq('product_id', productId)
    .single();

  if (toInventory.data) {
    await db
      .from('inventories')
      .update({ quantity: toNum(toInventory.data.quantity) + quantity })
      .eq('id', toInventory.data.id);
  } else {
    await db.from('inventories').insert({
      branch_id: toBranchId,
      product_id: productId,
      quantity: quantity,
      safety_stock: 0,
    });
  }

  await db
    .from('inventories')
    .update({ quantity: toNum(fromInventory.data.quantity) - quantity })
    .eq('branch_id', fromBranchId)
    .eq('product_id', productId);

  await db.from('inventory_movements').insert({
    branch_id: fromBranchId,
    product_id: productId,
    movement_type: 'OUT',
    quantity: quantity,
    reference_type: 'TRANSFER',
    memo: `지점 이동: ${memo || '출고'}`,
    ...(shipAt ? { created_at: shipAt } : {}),
  });

  await db.from('inventory_movements').insert({
    branch_id: toBranchId,
    product_id: productId,
    movement_type: 'IN',
    quantity: quantity,
    reference_type: 'TRANSFER',
    memo: `지점 이동: ${memo || '입고'}`,
    ...(arriveAt ? { created_at: arriveAt } : {}),
  });

  revalidatePath('/inventory');
  return { success: true };
}

// 지점 간 다건 일괄 이동 — 단건 transferInventory 의 OUT/IN(reference_type='TRANSFER') 을 배치로 래핑.
// 2-pass: 1) 전수검증(동일지점 거부·수량≥1·출고지 재고부족 라인 거부) 통과해야 시작, 2) 라인별 OUT+IN 처리.
// 이동은 음수 미허용 — 소모(recordStockUsage)와 달리 재고 초과 라인은 반드시 거부한다.
// 한계: pass1↔pass2 트랜잭션 없음(기존 단건과 동일) — 동시성 레이스는 이번 스코프 아님.
export async function transferInventoryBatch(input: {
  from_branch_id: string;
  to_branch_id: string;
  memo?: string;
  ship_date?: string;      // 출발(출고)일 — OUT 기록 날짜
  arrival_date?: string;   // 도착예정일 — IN 기록 날짜
  items: { product_id: string; quantity: number }[];
}) {
  const supabase = await createClient();
  const db = supabase as any;

  const fromBranchId = input.from_branch_id;
  const toBranchId = input.to_branch_id;
  const memo = input.memo;
  const items = input.items || [];
  const shipAt = transferDateToTimestamp(input.ship_date);
  const arriveAt = transferDateToTimestamp(input.arrival_date) ?? shipAt;

  // ── pass 1: 검증 (전체 거부, 처리 전) ──
  if (!fromBranchId) return { error: '출발 지점을 선택하세요.' };
  if (!toBranchId) return { error: '도착 지점을 선택하세요.' };
  const session = await requireSession();
  const denied = assertFromBranchOwnership(session, fromBranchId);
  if (denied) return { error: denied.error };
  if (fromBranchId === toBranchId) {
    return { error: '동일 지점 간 이동은 할 수 없습니다.' };
  }
  if (items.length === 0) return { error: '이동 품목을 1개 이상 추가하세요.' };
  for (const item of items) {
    if (!item.product_id) return { error: '품목 정보가 올바르지 않습니다.' };
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return { error: '이동 수량은 1개 이상의 정수여야 합니다.' };
    }
  }

  // 출고지 재고부족 전수검사 — 음수 미허용(이동 정책). 라인별 from_branch_id 재고 조회.
  for (const item of items) {
    const { data: invArr } = await db
      .from('inventories')
      .select('quantity, product:products(name)')
      .eq('branch_id', fromBranchId)
      .eq('product_id', item.product_id);
    const inv = invArr?.[0];
    if (!inv || toNum(inv.quantity) < item.quantity) {
      const label: string = inv?.product?.name ?? item.product_id;
      return { error: `'${label}' 이동 수량이 출고 지점의 재고보다 많습니다.` };
    }
  }

  // ── pass 2: 라인 루프(비트랜잭션 — 기존 코드 일관). 단건 transferInventory 의 OUT/IN 반복 ──
  for (const item of items) {
    const q = item.quantity;

    const { data: fromArr } = await db
      .from('inventories')
      .select('quantity')
      .eq('branch_id', fromBranchId)
      .eq('product_id', item.product_id);
    const fromCurrent = fromArr?.[0];

    const { data: toArr } = await db
      .from('inventories')
      .select('id, quantity')
      .eq('branch_id', toBranchId)
      .eq('product_id', item.product_id);
    const toCurrent = toArr?.[0];

    if (toCurrent) {
      await db
        .from('inventories')
        .update({ quantity: toNum(toCurrent.quantity) + q })
        .eq('id', toCurrent.id);
    } else {
      await db.from('inventories').insert({
        branch_id: toBranchId,
        product_id: item.product_id,
        quantity: q,
        safety_stock: 0,
      });
    }

    await db
      .from('inventories')
      .update({ quantity: toNum(fromCurrent?.quantity) - q })
      .eq('branch_id', fromBranchId)
      .eq('product_id', item.product_id);

    await db.from('inventory_movements').insert({
      branch_id: fromBranchId,
      product_id: item.product_id,
      movement_type: 'OUT',
      quantity: q,
      reference_type: 'TRANSFER',
      memo: `지점 이동: ${memo || '출고'}`,
      ...(shipAt ? { created_at: shipAt } : {}),
    });
    await db.from('inventory_movements').insert({
      branch_id: toBranchId,
      product_id: item.product_id,
      movement_type: 'IN',
      quantity: q,
      reference_type: 'TRANSFER',
      memo: `지점 이동: ${memo || '입고'}`,
      ...(arriveAt ? { created_at: arriveAt } : {}),
    });
  }

  revalidatePath('/inventory');
  return { success: true, count: items.length };
}

// ============ Categories ============

export async function getCategories() {
  const supabase = await createClient();
  const { data } = await supabase.from('categories').select('*').order('sort_order');
  return { data: data || [] };
}

export async function getCategoriesAll() {
  const supabase = await createClient();
  const { data } = await supabase.from('categories').select('*, parent:categories(name)').order('sort_order');
  return { data: data || [] };
}

export async function createCategory(formData: FormData) {
  const supabase = await createClient();
  

  const categoryData = {
    name: formData.get('name') as string,
    parent_id: formData.get('parent_id') as string || null,
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
  };

  // @ts-ignore
  const { error } = await supabase.from('categories').insert(categoryData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateCategory(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const categoryData = {
    name: formData.get('name') as string,
    parent_id: formData.get('parent_id') as string || null,
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
  };

  // @ts-ignore
  const { error } = await supabase.from('categories').update(categoryData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteCategory(id: string) {
  const supabase = await createClient();
  

  const { error } = await supabase.from('categories').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
  revalidatePath('/system-codes');
  return { success: true };
}

export async function getBranches() {
  const supabase = await createClient();
  const { data } = await supabase.from('branches').select('*').order('created_at');
  return { data: data || [] };
}

// ============ Branches (System Codes) ============

export async function getBranchesAll() {
  const supabase = await createClient();
  const { data } = await supabase.from('branches').select('*').order('created_at', { ascending: true });
  return { data: data || [] };
}

// 채널 기본 시드 — schema.sql의 INSERT가 누락된 환경에서 FK 위반 방지용 폴백
const CHANNEL_SEED: Array<{ id: string; name: string; color: string; sort_order: number }> = [
  { id: 'STORE',      name: '한약국', color: '#10b981', sort_order: 1 },
  { id: 'DEPT_STORE', name: '백화점', color: '#8b5cf6', sort_order: 2 },
  { id: 'ONLINE',     name: '자사몰', color: '#3b82f6', sort_order: 3 },
  { id: 'EVENT',      name: '이벤트', color: '#f59e0b', sort_order: 4 },
];

export async function createBranch(formData: FormData) {
  const supabase = await createClient();

  const branchData: any = {
    name: formData.get('name') as string,
    code: 'BR-' + Date.now().toString(36).toUpperCase(),
    channel: formData.get('channel') as string,
    sort_order: parseInt(formData.get('sort_order') as string) || 999,
    address: formData.get('address') as string || null,
    phone: formData.get('phone') as string || null,
    // 마이그 063 — 택배 발송지(보내는분) 분리 컬럼
    sender_name: (formData.get('sender_name') as string) || null,
    sender_phone: (formData.get('sender_phone') as string) || null,
    sender_zipcode: (formData.get('sender_zipcode') as string) || null,
    sender_address: (formData.get('sender_address') as string) || null,
    sender_address_detail: (formData.get('sender_address_detail') as string) || null,
  };

  // 채널 행이 누락된 환경에서 FK 위반이 나는 경우 자동 복구
  const seedRow = CHANNEL_SEED.find(c => c.id === branchData.channel);
  if (seedRow) {
    // @ts-ignore
    await supabase.from('channels').upsert(seedRow, { onConflict: 'id', ignoreDuplicates: true });
  }

  // @ts-ignore
  let { data: newBranch, error } = await supabase.from('branches').insert(branchData).select().single() as any;

  // 마이그 063 미적용 환경 폴백 — sender_* 컬럼 제거 후 재시도
  if (error && /sender_/i.test(String(error.message))) {
    delete branchData.sender_name; delete branchData.sender_phone;
    delete branchData.sender_zipcode; delete branchData.sender_address;
    delete branchData.sender_address_detail;
    // @ts-ignore
    const retry = await supabase.from('branches').insert(branchData).select().single() as any;
    newBranch = retry.data; error = retry.error;
  }

  if (error) {
    // 잔여 FK 위반에 대해 사용자 친화적 메시지 제공
    const msg = String(error.message || '');
    if (msg.includes('branches_channel_fkey')) {
      return {
        error: `채널 "${branchData.channel}"이 channels 테이블에 없습니다. ` +
               `Supabase에 migration 056을 적용해 주세요.`,
      };
    }
    return { error: msg };
  }

  // 지점 생성 시 모든 제품에 재고 레코드 자동 생성
  const { data: products } = await supabase
    .from('products')
    .select('id')
    .eq('is_active', true);

  if (products && products.length > 0) {
    const inventoryRecords = products.map((product: any) => ({
      product_id: product.id,
      branch_id: newBranch.id,
      quantity: 0,
      safety_stock: 0,
    }));

    await supabase.from('inventories').insert(inventoryRecords as any);
  }
  
  revalidatePath('/branches');
  revalidatePath('/inventory');
  return { success: true };
}

export async function updateBranch(id: string, formData: FormData) {
  const supabase = await createClient();

  const branchData: any = {
    name: formData.get('name') as string,
    channel: formData.get('channel') as string,
    sort_order: parseInt(formData.get('sort_order') as string) || 999,
    address: formData.get('address') as string || null,
    phone: formData.get('phone') as string || null,
    is_active: formData.get('is_active') === 'true',
    // 마이그 063 — 발송지 분리 컬럼
    sender_name: (formData.get('sender_name') as string) || null,
    sender_phone: (formData.get('sender_phone') as string) || null,
    sender_zipcode: (formData.get('sender_zipcode') as string) || null,
    sender_address: (formData.get('sender_address') as string) || null,
    sender_address_detail: (formData.get('sender_address_detail') as string) || null,
  };

  // createBranch와 동일하게 채널 시드 폴백
  const seedRow = CHANNEL_SEED.find(c => c.id === branchData.channel);
  if (seedRow) {
    // @ts-ignore
    await supabase.from('channels').upsert(seedRow, { onConflict: 'id', ignoreDuplicates: true });
  }

  // @ts-ignore
  let { error } = await supabase.from('branches').update(branchData).eq('id', id);

  // 마이그 063 미적용 환경 폴백
  if (error && /sender_/i.test(String(error.message))) {
    delete branchData.sender_name; delete branchData.sender_phone;
    delete branchData.sender_zipcode; delete branchData.sender_address;
    delete branchData.sender_address_detail;
    // @ts-ignore
    const retry = await supabase.from('branches').update(branchData).eq('id', id);
    error = retry.error;
  }

  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('branches_channel_fkey')) {
      return {
        error: `채널 "${branchData.channel}"이 channels 테이블에 없습니다. ` +
               `Supabase에 migration 056을 적용해 주세요.`,
      };
    }
    return { error: msg };
  }

  revalidatePath('/branches');
  revalidatePath('/system-codes');
  revalidatePath('/shipping');
  return { success: true };
}

// 지점 참조 검사 테이블 — 삭제 차단 사유 표시용(#69). 사용자에게 의미있는 업무 데이터 위주.
//   inventories(지점 생성 시 제품마다 qty=0 자동 생성되는 스캐폴딩)는 별도 처리 — 0수량은 참조 아님.
//   ON DELETE CASCADE(branch_point_rates·sales_order_drafts)는 자동 정리되므로 제외.
const BRANCH_REF_TABLES: { table: string; column: string; label: string }[] = [
  { table: 'sales_orders', column: 'branch_id', label: '판매전표(매출처)' },
  { table: 'sales_orders', column: 'ship_from_branch_id', label: '판매전표(출고처)' },
  { table: 'inventory_movements', column: 'branch_id', label: '재고이력' },
  { table: 'shipments', column: 'branch_id', label: '배송(출고지점)' },
  { table: 'users', column: 'branch_id', label: '직원 연결' },
  { table: 'purchase_orders', column: 'branch_id', label: '발주' },
  { table: 'production_orders', column: 'branch_id', label: '생산지시' },
  { table: 'return_orders', column: 'branch_id', label: '반품' },
  { table: 'customers', column: 'primary_branch_id', label: '고객 기본지점' },
  { table: 'daily_sales_reports', column: 'branch_id', label: '백화점 판매일보' },
  { table: 'b2b_partners', column: 'branch_id', label: 'B2B 거래처' },
  { table: 'legacy_orders', column: 'branch_id', label: '레거시 주문' },
  { table: 'legacy_purchases', column: 'branch_id', label: '레거시 매입' },
  { table: 'notification_campaigns', column: 'target_branch_id', label: '알림 캠페인' },
];

// 지점이 참조되는 위치/건수 집계(#69). 테이블·컬럼 부재(마이그 미적용 환경)는 무시(건너뜀).
export async function getBranchUsage(id: string) {
  const supabase = await createClient() as any;
  const references: { label: string; count: number }[] = [];

  for (const ref of BRANCH_REF_TABLES) {
    try {
      const { count, error } = await supabase
        .from(ref.table)
        .select('id', { count: 'exact', head: true })
        .eq(ref.column, id);
      // 테이블/컬럼 미존재(42P01/42703) → 해당 환경에 없음, 참조 0으로 간주
      if (error) continue;
      if ((count ?? 0) > 0) references.push({ label: ref.label, count: count as number });
    } catch {
      /* 개별 테이블 조회 실패는 전체 집계를 막지 않음 */
    }
  }

  // 재고: 0수량 스캐폴딩은 참조 아님. 실제 보유(수량≠0)만 참조로 표시.
  try {
    const { count } = await supabase
      .from('inventories')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', id)
      .neq('quantity', 0);
    if ((count ?? 0) > 0) references.push({ label: '재고 보유(수량≠0)', count: count as number });
  } catch { /* noop */ }

  const total = references.reduce((s, r) => s + r.count, 0);
  return { references, total };
}

export async function deleteBranch(id: string) {
  const supabase = await createClient() as any;

  // 본사 지점은 삭제 금지(생산 입고 기준 등 핵심 참조). 본사 해제 후 진행하도록 안내.
  const { data: br } = await supabase.from('branches').select('is_headquarters, name').eq('id', id).maybeSingle();
  if (br?.is_headquarters) {
    return { error: '본사로 지정된 지점은 삭제할 수 없습니다. 먼저 본사 지정을 해제하세요.', references: [] as { label: string; count: number }[] };
  }

  // 참조 검사 — 업무 데이터가 하나라도 있으면 삭제 차단 + 사유/위치 반환(#69).
  const { references, total } = await getBranchUsage(id);
  if (total > 0) {
    return {
      error: '참조 데이터가 있어 삭제할 수 없습니다. 아래 데이터를 정리하거나, 지점을 "비활성"으로 변경해 숨겨주세요.',
      references,
    };
  }

  // 참조 없음 — 지점 생성 시 자동 생성된 0수량 재고행(스캐폴딩) 정리 후 삭제.
  await supabase.from('inventories').delete().eq('branch_id', id);
  const { error } = await supabase.from('branches').delete().eq('id', id);
  if (error) {
    // 미검사 FK 등으로 실패 시 원문 반환(드묾).
    return { error: error.message, references: [] as { label: string; count: number }[] };
  }

  revalidatePath('/branches');
  revalidatePath('/system-codes');
  return { success: true };
}

// 지점 활성/비활성 전환(#69) — 삭제 불가 시 비활성으로 주요 화면(매출처·출고처 선택 등)에서 숨김.
export async function setBranchActive(id: string, isActive: boolean) {
  const supabase = await createClient() as any;
  const { error } = await supabase.from('branches').update({ is_active: isActive }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/branches');
  revalidatePath('/system-codes');
  revalidatePath('/pos');
  revalidatePath('/shipping');
  return { success: true };
}

// ============ Channels ============

export async function getChannels() {
  const supabase = await createClient();
  const { data } = await supabase.from('channels').select('*').order('sort_order');
  return { data: data || [] };
}

export async function createChannel(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get('name') as string;
  // channels.id는 PRIMARY KEY VARCHAR(20). 한글/공백/소문자 → 안전한 코드로 정규화.
  // 한글이 포함된 경우 영문 변환 불가하므로 원문 사용 (DB 측 VARCHAR(20) 제약).
  const id = name.replace(/\s+/g, '_').toUpperCase().slice(0, 20);

  const channelData = {
    id,
    name,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: true,
  };

  // @ts-ignore
  const { error } = await supabase.from('channels').insert(channelData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateChannel(id: string, formData: FormData) {
  const supabase = await createClient();

  const channelData = {
    name: formData.get('name') as string,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: formData.get('is_active') === 'true',
  };

  // @ts-ignore
  const { error } = await supabase.from('channels').update(channelData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteChannel(id: string) {
  const supabase = await createClient();

  // 해당 채널을 사용하는 지점이 있는지 확인
  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('channel', id);
  
  if (branches && branches.length > 0) {
    return { error: '해당 채널을 사용하는 지점이 있어 삭제할 수 없습니다.' };
  }

  const { error } = await supabase.from('channels').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

// ============ Inventory Usage Types (재고 사용유형) ============

export async function getInventoryUsageTypes() {
  const supabase = await createClient();
  // 마이그 079 미적용 환경에서도 빌드/타입이 깨지지 않도록 as any (기존 패턴).
  const { data } = await (supabase as any)
    .from('inventory_usage_types')
    .select('*')
    .order('sort_order');
  return { data: data || [] };
}

export async function createInventoryUsageType(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get('name') as string;
  // code 는 createChannel 정규화 방식 재사용 (영문 대문자/`_`). VARCHAR(30) → slice(0,30).
  // 한글 포함 시 영문 변환 불가하므로 원문 사용.
  const code = name.replace(/\s+/g, '_').toUpperCase().slice(0, 30);

  const usageTypeData = {
    code,
    name,
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_system: false,
    is_active: true,
  };

  const { error } = await (supabase as any)
    .from('inventory_usage_types')
    .insert(usageTypeData);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateInventoryUsageType(id: string, formData: FormData) {
  const supabase = await createClient();

  // code/is_system 은 불변 — name/sort_order/is_active 만 수정.
  const usageTypeData = {
    name: formData.get('name') as string,
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: formData.get('is_active') === 'true',
  };

  const { error } = await (supabase as any)
    .from('inventory_usage_types')
    .update(usageTypeData)
    .eq('id', id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteInventoryUsageType(id: string) {
  const supabase = await createClient();

  // 1) 시스템 기본 유형('기타' 등)은 삭제 금지 — 비활성만 허용.
  const { data: row } = await (supabase as any)
    .from('inventory_usage_types')
    .select('is_system')
    .eq('id', id)
    .single();

  if (row?.is_system) {
    return { error: '시스템 기본 유형은 삭제할 수 없습니다. 비활성만 가능합니다.' };
  }

  // 2) 소모 이력(inventory_movements)에서 참조 중이면 삭제 금지.
  const { data: movements } = await (supabase as any)
    .from('inventory_movements')
    .select('id')
    .eq('usage_type_id', id)
    .limit(1);

  if (movements && movements.length > 0) {
    return { error: '소모 이력이 있어 삭제할 수 없습니다. 비활성 처리하세요.' };
  }

  const { error } = await (supabase as any)
    .from('inventory_usage_types')
    .delete()
    .eq('id', id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/system-codes');
  return { success: true };
}

// ============ Users (Staff Management) ============

export async function getUsers() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('users')
    .select('*, branch:branches(name)')
    .order('created_at', { ascending: false });
  return { data: data || [] };
}

export async function getUsersByBranch(branchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('users')
    .select('*, branch:branches(name)')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false });
  return { data: data || [] };
}

export async function createUser(formData: FormData) {
  const supabase = await createClient();
  
  const loginId = formData.get('login_id') as string;
  const password = formData.get('password') as string;
  const name = formData.get('name') as string;
  const phone = formData.get('phone') as string;
  const role = formData.get('role') as string;
  const branchId = formData.get('branch_id') as string;

  // SHA256으로 비밀번호 해싱
  const hashPassword = (pwd: string) => {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(pwd).digest('hex');
  };

  // Create auth user (임시: 자체 로그인人而使用)
  const authEmail = `${loginId}@kyo.local`;
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: authEmail,
    password,
    options: {
      data: { name }
    }
  });

  if (authError) {
    return { error: authError.message };
  }

  // Create user profile with login_id
  const userId = authData?.user?.id || crypto.randomUUID();
  const { error } = await supabase.from('users').insert({
    id: userId,
    login_id: loginId,
    email: authEmail,
    password_hash: hashPassword(password),
    name,
    phone: phone || null,
    role,
    branch_id: branchId || null,
    is_active: true,
  } as any);

  if (error) {
    // auth 사용자가 만들어졌으면 삭제
    if (authData?.user) {
      await supabase.auth.admin.deleteUser(authData.user.id);
    }
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateUser(id: string, formData: FormData) {
  const supabase = await createClient();

  const userData: Record<string, any> = {
    name: formData.get('name') as string,
    phone: formData.get('phone') as string || null,
    role: formData.get('role') as string,
  };

  const branchId = formData.get('branch_id') as string;
  if (branchId) {
    userData.branch_id = branchId;
  }

  const isActive = formData.get('is_active');
  if (isActive !== undefined) {
    userData.is_active = isActive === 'true';
  }

  // @ts-ignore
  const { error } = await supabase.from('users').update(userData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteUser(id: string) {
  const session = await requireSession();
  if (session.role !== 'SUPER_ADMIN' && session.role !== 'HQ_OPERATOR') {
    return { error: '직원 관리는 본사 권한만 가능합니다.' };
  }

  // 본인 계정 삭제 금지
  if (session.id === id) {
    return { error: '본인 계정은 삭제할 수 없습니다.' };
  }

  const supabase = await createClient();
  const db = supabase as any;

  // 대상 사용자 조회
  const { data: target } = await db
    .from('users')
    .select('id, role, is_active')
    .eq('id', id)
    .single();

  if (!target) {
    return { error: '대상 직원을 찾을 수 없습니다.' };
  }

  // 마지막 활성 최고관리자 삭제/비활성 금지
  if (target.role === 'SUPER_ADMIN') {
    const { count } = await db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'SUPER_ADMIN')
      .eq('is_active', true);
    if ((count ?? 0) <= 1) {
      return { error: '마지막 활성 최고관리자는 삭제/비활성할 수 없습니다.' };
    }
  }

  // 하드 DELETE 시도
  const { error } = await db.from('users').delete().eq('id', id);

  if (!error) {
    // 참조 없으니 세션 정리 후 완전 삭제 완료
    await db.from('session_tokens').delete().eq('user_id', id);
    revalidatePath('/system-codes');
    return { deleted: true };
  }

  // FK 위반 → soft-delete 폴백
  if (error.code === '23503' || (error.message && error.message.includes('violates foreign key'))) {
    await db.from('users').update({ is_active: false }).eq('id', id);
    // 강제 로그아웃
    await db.from('session_tokens').delete().eq('user_id', id);
    revalidatePath('/system-codes');
    return { deactivated: true };
  }

  return { error: error.message };
}

export async function reactivateUser(id: string) {
  const session = await requireSession();
  if (session.role !== 'SUPER_ADMIN' && session.role !== 'HQ_OPERATOR') {
    return { error: '직원 관리는 본사 권한만 가능합니다.' };
  }

  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from('users')
    .update({ is_active: true })
    .eq('id', id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/system-codes');
  return { success: true };
}

// ============ Customer Grades (System Codes) ============

export async function getCustomerGrades() {
  const supabase = await createClient();
  const { data } = await supabase.from('customer_grades').select('*').order('sort_order');
  return { data: data || [] };
}

export async function createCustomerGrade(formData: FormData) {
  const supabase = await createClient();
  

  const thresholdRaw = formData.get('upgrade_threshold') as string;
  const gradeData = {
    code: formData.get('code') as string,
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    point_rate: parseFloat(formData.get('point_rate') as string) || 1.00,
    upgrade_threshold: thresholdRaw && thresholdRaw !== '' ? parseInt(thresholdRaw) : null,
  };

  // @ts-ignore
  const { error } = await supabase.from('customer_grades').insert(gradeData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateCustomerGrade(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const thresholdRaw = formData.get('upgrade_threshold') as string;
  const gradeData = {
    code: formData.get('code') as string,
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: formData.get('is_active') === 'true',
    point_rate: parseFloat(formData.get('point_rate') as string) || 1.00,
    upgrade_threshold: thresholdRaw && thresholdRaw !== '' ? parseInt(thresholdRaw) : null,
  };

  // @ts-ignore
  const { error } = await supabase.from('customer_grades').update(gradeData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteCustomerGrade(id: string) {
  const supabase = await createClient();


  const { error } = await supabase.from('customer_grades').delete().eq('id', id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/system-codes');
  return { success: true };
}

// ============ Branch × Grade Point Rates (마이그 067) ============
// 매트릭스: (branch_id, grade_id) → point_rate
//   · 매트릭스에 활성 row 있으면 그 값,
//     없거나 is_active=false 면 customer_grades.point_rate 로 폴백
//   · 적립율 결정은 서버측에서 재해결 — resolvePointRate() 사용

export async function getBranchPointRates() {
  const supabase = await createClient();
  const db = supabase as any;
  const { data } = await db
    .from('branch_point_rates')
    .select('id, branch_id, grade_id, point_rate, is_active');
  return { data: (data || []) as Array<{
    id: string;
    branch_id: string;
    grade_id: string;
    point_rate: number;
    is_active: boolean;
  }> };
}

// 셀 단위 upsert: 빈 입력(rate=null)은 행 삭제로 처리 → 등급 기본값으로 폴백.
export async function upsertBranchPointRate(
  branchId: string,
  gradeId: string,
  pointRate: number | null,
  isActive: boolean = true,
) {
  const supabase = await createClient();
  const db = supabase as any;

  if (pointRate === null || Number.isNaN(pointRate)) {
    const { error } = await db.from('branch_point_rates').delete()
      .eq('branch_id', branchId).eq('grade_id', gradeId);
    if (error) return { error: error.message };
    revalidatePath('/system-codes');
    return { success: true, cleared: true };
  }

  if (pointRate < 0 || pointRate > 100) {
    return { error: '적립율은 0 ~ 100 사이여야 합니다.' };
  }

  // (branch_id, grade_id) UNIQUE — onConflict 로 upsert
  const { error } = await db.from('branch_point_rates').upsert(
    {
      branch_id: branchId,
      grade_id: gradeId,
      point_rate: pointRate,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'branch_id,grade_id' },
  );
  if (error) return { error: error.message };
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteBranchPointRate(branchId: string, gradeId: string) {
  const supabase = await createClient();
  const db = supabase as any;
  const { error } = await db.from('branch_point_rates').delete()
    .eq('branch_id', branchId).eq('grade_id', gradeId);
  if (error) return { error: error.message };
  revalidatePath('/system-codes');
  return { success: true };
}

// 지점 단위 일괄 원복 — 해당 branch_id 의 모든 오버라이드 행을 삭제하여
// 모든 등급이 customer_grades.point_rate(등급 기본값)로 폴백되도록 한다.
// 프로모션 종료 등 일시 적용 후 일반 적립율로 환원할 때 사용.
export async function resetBranchPointRates(branchId: string) {
  const supabase = await createClient();
  const db = supabase as any;
  const { error, count } = await db.from('branch_point_rates')
    .delete({ count: 'exact' })
    .eq('branch_id', branchId);
  if (error) return { error: error.message };
  revalidatePath('/system-codes');
  return { success: true, cleared: count ?? 0 };
}

// 서버측 적립율 해결 — POS 체크아웃에서 호출.
// 클라이언트가 보낸 rate 는 표시용/하위호환용이며, 적립 계산은 이 함수가 단일 진실원.
//   1) branch_point_rates 에 (branch_id, grade_id) 활성 row 있으면 그 rate
//   2) 없으면 customer_grades.point_rate (등급 기본)
//   3) 그것도 없으면 1.0
export async function resolvePointRate(
  db: any,
  branchId: string | null | undefined,
  gradeCode: string | null | undefined,
): Promise<{ rate: number; source: 'matrix' | 'grade' | 'default' }> {
  if (!gradeCode) return { rate: 1.0, source: 'default' };

  // 등급 코드 → 등급 id, 기본 rate
  const { data: gradeRow } = await db
    .from('customer_grades')
    .select('id, point_rate')
    .eq('code', gradeCode)
    .maybeSingle();

  const gradeRate = gradeRow?.point_rate != null
    ? parseFloat(String(gradeRow.point_rate)) : 1.0;

  if (!branchId || !gradeRow?.id) {
    return { rate: gradeRate, source: gradeRow ? 'grade' : 'default' };
  }

  // 매트릭스 우선
  const { data: matRow } = await db
    .from('branch_point_rates')
    .select('point_rate, is_active')
    .eq('branch_id', branchId)
    .eq('grade_id', gradeRow.id)
    .maybeSingle();

  if (matRow && matRow.is_active && matRow.point_rate != null) {
    return { rate: parseFloat(String(matRow.point_rate)), source: 'matrix' };
  }

  return { rate: gradeRate, source: 'grade' };
}

// ============ Customer Tags ============

export async function getCustomerTags() {
  const supabase = await createClient();
  const { data } = await supabase.from('customer_tags').select('*').order('created_at');
  return { data: data || [] };
}

export async function createCustomerTag(formData: FormData) {
  const supabase = await createClient();
  

  const tagData = {
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
  };

  // @ts-ignore
  const { error } = await supabase.from('customer_tags').insert(tagData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateCustomerTag(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const tagData = {
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
  };

  // @ts-ignore
  const { error } = await supabase.from('customer_tags').update(tagData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteCustomerTag(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('customer_tags').delete().eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/system-codes');
  return { success: true };
}

// ─── 고객 등급 자동 업그레이드 ───────────────────────────────────────
// NORMAL → VIP: 누적 100만원 / VIP → VVIP: 300만원 (업그레이드 전용, 다운 없음)
export async function autoUpgradeCustomerGrades() {
  const supabase = await createClient();
  const db = supabase as any;

  const { data: customers } = await db
    .from('customers').select('id, grade').eq('is_active', true);
  if (!customers?.length) return { upgraded: 0 };

  const { data: orders } = await db
    .from('sales_orders').select('customer_id, total_amount')
    .eq('status', 'COMPLETED').not('customer_id', 'is', null);

  const ltv = new Map<string, number>();
  for (const o of (orders || [])) {
    ltv.set(o.customer_id, (ltv.get(o.customer_id) || 0) + (o.total_amount || 0));
  }

  // 등급 업그레이드 기준을 DB에서 조회
  const { data: gradeRows } = await db
    .from('customer_grades')
    .select('code, upgrade_threshold')
    .eq('is_active', true)
    .not('upgrade_threshold', 'is', null);

  const THRESHOLDS = ((gradeRows || []) as { code: string; upgrade_threshold: number }[])
    .map(g => ({ grade: g.code, min: g.upgrade_threshold }))
    .sort((a, b) => b.min - a.min); // 높은 기준부터

  const GRADE_RANK: Record<string, number> = { NORMAL: 0, VIP: 1, VVIP: 2 };

  let upgraded = 0;
  for (const c of customers) {
    const total = ltv.get(c.id) || 0;
    const target = THRESHOLDS.find(t => total >= t.min);
    if (!target) continue;
    if ((GRADE_RANK[target.grade] || 0) > (GRADE_RANK[c.grade] || 0)) {
      await db.from('customers').update({ grade: target.grade }).eq('id', c.id);
      upgraded++;
    }
  }

  revalidatePath('/customers');
  return { upgraded };
}

// ============ POS Checkout ============

export type ItemDeliveryType = 'PICKUP' | 'PARCEL' | 'QUICK';
export type ReceiptStatus = 'RECEIVED' | 'PICKUP_PLANNED' | 'QUICK_PLANNED' | 'PARCEL_PLANNED';
export type ApprovalStatus = 'COMPLETED' | 'CARD_PENDING' | 'UNSETTLED';

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  discount?: number;
  orderOption?: string;   // 품목별 주문 옵션(보자기/쇼핑백/색상/서비스 등)
  deliveryType?: ItemDeliveryType;     // 품목별 배송 방식 (기본 PICKUP)
  receiptDate?: string | null;          // 품목별 수령(예정) 일자
}

export interface PaymentSplit {
  method: 'cash' | 'card' | 'card_keyin' | 'kakao' | 'credit' | 'cod';
  amount: number;
  approvalNo?: string;
  cardInfo?: string;
  memo?: string;
}

export interface ShippingInfo {
  delivery_type?: 'PARCEL' | 'QUICK'; // 택배 | 퀵배송 (기본 PARCEL)
  recipient_name: string;
  recipient_phone: string;
  recipient_zipcode?: string;
  recipient_address: string;        // 도로명/지번
  recipient_address_detail?: string;
  delivery_message?: string;
  sender_name?: string;
  sender_phone?: string;
  sender_zipcode?: string;
  sender_address?: string;
  sender_address_detail?: string;
}

export interface CheckoutPayload {
  branchId: string;
  branchCode: string;
  branchName: string;
  branchChannel: string;
  customerId: string | null;
  customerGrade: string | null;
  gradePointRate: number;
  cart: CartItem[];
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
  paymentMethod: string;            // 단일 결제 하위호환. splits 있으면 자동 계산.
  usePoints: boolean;
  pointsToUse: number;
  cashReceived?: number;
  userId: string | null;
  approvalNo?: string;
  cardInfo?: string;
  memo?: string;
  paymentSplits?: PaymentSplit[];   // 분할 결제. 비어있으면 단일 결제로 처리.
  shipping?: ShippingInfo | null;   // 택배 정보 (있으면 shipments 레코드 생성)
  shipFromBranchId?: string;        // 출고 지점 (택배 활성 시). 없으면 branchId 사용. 판매 지점과 다르면 재고는 출고 지점에서 차감.
  saleDate?: string;                // 판매 일자 (ordered_at) — 미지정 시 서버 now().
  receiptStatus?: ReceiptStatus;    // 수령 현황. 미지정 시 배송 여부로 자동 추론.
  receiptDate?: string | null;      // 수령(예정) 일자 YYYY-MM-DD. 선택.
  approvalStatus?: ApprovalStatus;  // 승인 상태. 미지정 시 결제수단으로 자동 추론.
  paymentInfo?: string;             // 결제정보 메모(카드/계좌 안내 등).
}

export async function processPosCheckout(payload: CheckoutPayload) {
  const supabase = await createClient();
  const db = supabase as any;

  const {
    branchId, branchCode, branchChannel, customerId, gradePointRate,
    cart, totalAmount, discountAmount, finalAmount, paymentMethod,
    usePoints, pointsToUse, userId, approvalNo, cardInfo,
    paymentSplits, shipping, shipFromBranchId,
  } = payload;

  // 재고 차감/출고 지점: 택배 출고처가 판매 지점과 다르면 출고처에서 차감.
  const stockBranchId = (shipping && shipFromBranchId) ? shipFromBranchId : branchId;

  // 분할 결제 정규화: 비어있으면 단일 결제 하나로 간주
  const splits: PaymentSplit[] = (paymentSplits && paymentSplits.length > 0)
    ? paymentSplits.filter(s => s.amount > 0)
    : [{ method: paymentMethod as any, amount: finalAmount, approvalNo, cardInfo }];

  const paidTotal = splits.reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = Math.max(0, finalAmount - paidTotal);
  // 잔액이 있으면 외상 처리로 간주 (splits 합이 finalAmount 미만)
  const hasCredit = remaining > 0 || splits.some(s => s.method === 'credit');
  const topMethod: string = splits.length === 1
    ? splits[0].method
    : 'mixed';
  const firstCard = splits.find(s => s.method === 'card' || s.method === 'card_keyin');

  // ⓪ 판매 가능 제품 검증 — RAW/SUB는 POS 판매 불가. SERVICE는 허용(무형상품).
  //   동시에 product_type별 track_inventory · is_phantom을 미리 가져와 ④ 재고 차감 분기에 사용.
  //   폴백: 042(product_type) / 059(track_inventory) / 061(is_phantom) 미적용 환경 모두 안전.
  const productIds = Array.from(new Set(cart.map(c => c.productId)));
  const trackByProduct = new Map<string, boolean>();
  const phantomByProduct = new Map<string, boolean>();
  // 과세 여부도 동일 조회에서 흡수 (C: L2571 별도조회 제거). is_taxable는 006(최고령) 컬럼이라
  // 폴백 체인에서 가장 마지막까지 유지. 부재 시 맵 미설정 → 아래 과세 블록에서 기본 true(과세).
  const isTaxableByProduct = new Map<string, boolean>();
  // 실원가(cost) — 매출분개 COGS 산정용. cost는 006 이전부터 존재해 폴백 체인 전 구간 유지.
  const costByProduct = new Map<string, number>();
  if (productIds.length > 0) {
    let ptRes: any = await db.from('products')
      .select('id, product_type, track_inventory, is_phantom, is_taxable, cost').in('id', productIds);
    if (ptRes.error && /is_phantom/i.test(String(ptRes.error.message))) {
      // 061 미적용 — is_phantom 없이 재시도 (is_taxable·cost 유지)
      ptRes = await db.from('products').select('id, product_type, track_inventory, is_taxable, cost').in('id', productIds);
    }
    if (ptRes.error && /track_inventory/i.test(String(ptRes.error.message))) {
      // 059 미적용 — track_inventory 없이 재시도 (is_taxable·cost 유지)
      ptRes = await db.from('products').select('id, product_type, is_taxable, cost').in('id', productIds);
    }
    if (ptRes.error && /is_taxable/i.test(String(ptRes.error.message))) {
      // 006 미적용(이론상 도달 안 함) — is_taxable 없이 재시도 → 전부 과세 폴백 (cost 유지)
      ptRes = await db.from('products').select('id, product_type, cost').in('id', productIds);
    }
    if (!ptRes.error && Array.isArray(ptRes.data)) {
      const blocked = (ptRes.data as any[]).find(
        (p: any) => p.product_type === 'RAW' || p.product_type === 'SUB'
      );
      if (blocked) return { error: '판매 가능한 제품이 아닙니다 (원·부자재).' };
      for (const p of ptRes.data as any[]) {
        // track_inventory 컬럼 부재 시 SERVICE만 false, 그 외 true 기본
        const t = p.track_inventory ?? (p.product_type === 'SERVICE' ? false : true);
        trackByProduct.set(p.id, t);
        phantomByProduct.set(p.id, p.is_phantom === true);
        // is_taxable 컬럼 부재 시 undefined → !== false → true(과세) = 기존 폴백 동일
        isTaxableByProduct.set(p.id, p.is_taxable !== false);
        costByProduct.set(p.id, Number(p.cost) || 0);
      }
    }
  }

  // Phantom BOM 사전 로드 — 판매된 phantom 제품의 구성품을 한 번에 가져옴
  //   product_bom.product_id = phantom SKU id, material_id = 차감 대상, quantity = 단위당 수량
  const phantomIds = productIds.filter(id => phantomByProduct.get(id) === true);
  const bomByPhantom = new Map<string, Array<{ material_id: string; quantity: number }>>();
  if (phantomIds.length > 0) {
    const { data: bomRows } = await db
      .from('product_bom')
      .select('product_id, material_id, quantity')
      .in('product_id', phantomIds);
    for (const row of (bomRows || []) as any[]) {
      const list = bomByPhantom.get(row.product_id) || [];
      list.push({ material_id: row.material_id, quantity: Number(row.quantity || 0) });
      bomByPhantom.set(row.product_id, list);
    }
    // BOM이 비어있는 phantom은 운영 사고 방지 위해 거부
    for (const pid of phantomIds) {
      if ((bomByPhantom.get(pid) || []).length === 0) {
        return { error: '세트 상품(Phantom)에 BOM이 등록되지 않아 판매할 수 없습니다. 제품 화면에서 구성품을 먼저 등록하세요.' };
      }
    }
  }

  // 분해 차감 대상(material) 의 소수점 재고 허용 여부 사전 로드 (#28).
  //   허용 제품은 BOM 분수 수량(예: 0.0333)을 반올림 없이 그대로 차감, 비허용은 기존 Math.ceil.
  //   폴백: 마이그 087 미적용(컬럼 부재) 시 전부 false → 기존 정수 동작 유지.
  const decimalByMaterial = new Map<string, boolean>();
  {
    const materialIds = Array.from(
      new Set(Array.from(bomByPhantom.values()).flat().map(c => c.material_id)),
    );
    if (materialIds.length > 0) {
      let adRes: any = await db
        .from('products').select('id, allow_decimal_stock, cost').in('id', materialIds);
      if (adRes.error && /allow_decimal_stock/i.test(String(adRes.error.message))) {
        // 087 미적용 — allow_decimal_stock 없이 재시도 (cost는 유지)
        adRes = await db.from('products').select('id, cost').in('id', materialIds);
      }
      if (!adRes.error && Array.isArray(adRes.data)) {
        for (const p of adRes.data as any[]) {
          decimalByMaterial.set(p.id, p.allow_decimal_stock === true);
          // 팬텀 분해 자재의 실원가 — COGS 산정에 사용(재고 OUT분과 일치).
          costByProduct.set(p.id, Number(p.cost) || 0);
        }
      }
      // 컬럼 부재(폴백) 시 map 비어있음 → 아래 분기에서 전부 비허용(Math.ceil) 처리.
    }
  }

  // ① 재고 사전 확인 (출고 지점 기준)
  //   ※ 음수 재고 허용 — 부족해도 차단하지 않고 마이너스로 반영, 누적 시 자동 복원.
  //     레코드가 아예 없는 경우만 ④ 단계에서 음수로 자동 생성.

  // ② 판매 전표 생성 (KST 오늘 기준 주문번호 prefix)
  const today = kstTodayString().replace(/-/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const orderNumber = `SA-${branchCode}-${today}-${randomSuffix}`;

  // 적립율 서버측 재해결 (마이그 067) — branch_point_rates 우선, 없으면 등급 기본.
  //   클라이언트가 보낸 gradePointRate 는 표시용. 서버는 (branchId, customer.grade) 로
  //   매트릭스/등급 fallback 을 다시 계산한다.
  let resolvedRate: number = gradePointRate || 1.0;
  if (customerId) {
    const customerGrade = (payload as any).customerGrade as string | null;
    const r = await resolvePointRate(db, branchId, customerGrade);
    resolvedRate = r.rate;
  }
  const pointsEarned = customerId
    ? Math.floor(finalAmount * (resolvedRate || 1.0) / 100)
    : 0;

  // 과세/면세 스냅샷 — 카트 항목별 is_taxable 조회 후 finalAmount를 비례 배분
  //   • 라인 순액 = price × qty − itemDiscount  (주문 할인 전)
  //   • 합계(cartNet) = totalAmount − itemDiscountTotal
  //   • finalAmount(고객 실수령액)을 taxableNet/exemptNet 비율로 배분
  //   • vat = round(taxable_amount × 10 / 110)  — 면세분에는 VAT 미산정
  // 대상 마이그: 058. 컬럼 누락 환경(58 미적용)에서는 optionalKeys로 자동 폴백.
  let taxableAmount = 0;
  let exemptAmount = 0;
  let vatAmount = 0;
  if (cart.length > 0) {
    // C: ⓪에서 채운 isTaxableByProduct 재사용 (별도 products 조회 제거).
    //   맵이 비어있으면(⓪ products 조회 자체가 실패) 과세 블록 스킵 → 전부 0 (기존 !taxErr 스킵과 동일).
    if (isTaxableByProduct.size > 0) {
      const isTaxable = isTaxableByProduct;
      let taxableNet = 0;
      let exemptNet = 0;
      for (const item of cart) {
        const lineNet = item.price * item.quantity - (item.discount || 0);
        if (isTaxable.get(item.productId) === false) exemptNet += lineNet;
        else taxableNet += lineNet;
      }
      const cartNet = taxableNet + exemptNet;
      if (cartNet > 0) {
        // finalAmount를 비율로 분배. 반올림 차이는 면세 쪽에 흡수해 합계 = finalAmount 보장.
        taxableAmount = Math.round((finalAmount * taxableNet) / cartNet);
        exemptAmount = finalAmount - taxableAmount;
        vatAmount = Math.round((taxableAmount * 10) / 110);
      } else {
        // 모든 라인이 0원(이론상 도달 안 함). 안전 폴백.
        taxableAmount = finalAmount;
        exemptAmount = 0;
        vatAmount = Math.round((taxableAmount * 10) / 110);
      }
    }
  }

  // 품목별 배송 방식으로부터 주문 레벨 수령 상태 집계
  //  - 모두 PICKUP → RECEIVED
  //  - 하나라도 PARCEL → PARCEL_PLANNED (우선순위 최상)
  //  - PARCEL 없고 QUICK 있음 → QUICK_PLANNED
  //  - 기타 → PICKUP_PLANNED 또는 RECEIVED
  const itemDeliveryTypes: ItemDeliveryType[] = cart.map(c => c.deliveryType || 'PICKUP');
  const hasParcelItem = itemDeliveryTypes.includes('PARCEL');
  const hasQuickItem = itemDeliveryTypes.includes('QUICK');
  const allPickup = itemDeliveryTypes.every(t => t === 'PICKUP');

  // 수령 현황 자동 추론 (명시값 우선 — 사용자가 수령현황을 명시적으로 선택한 경우)
  const inferredReceiptStatus: ReceiptStatus =
    payload.receiptStatus
    ?? (hasParcelItem ? 'PARCEL_PLANNED'
        : hasQuickItem ? 'QUICK_PLANNED'
        : (shipping
            ? (shipping.delivery_type === 'QUICK' ? 'QUICK_PLANNED' : 'PARCEL_PLANNED')
            : 'RECEIVED'));
  // 승인 상태 자동 추론
  const inferredApprovalStatus: ApprovalStatus =
    payload.approvalStatus
    ?? (paymentMethod === 'card_keyin' ? 'CARD_PENDING'
        : (paymentMethod === 'credit' || hasCredit) ? 'UNSETTLED'
        : 'COMPLETED');

  const salePayload: any = {
    order_number: orderNumber,
    channel: branchChannel || 'STORE',
    branch_id: branchId,
    customer_id: customerId || null,
    ordered_by: userId || null,
    total_amount: totalAmount,
    discount_amount: discountAmount,
    status: 'COMPLETED',
    payment_method: topMethod,
    points_earned: pointsEarned,
    points_used: usePoints ? pointsToUse : 0,
    ordered_at: payload.saleDate || new Date().toISOString(),
    approval_no: approvalNo || firstCard?.approvalNo || null,
    card_info: cardInfo || firstCard?.cardInfo || null,
    memo: payload.memo || null,
    customer_grade_at_order: customerId ? (payload as any).customerGrade || null : null,
    point_rate_applied: customerId ? (resolvedRate || 1.0) : null,
    credit_settled: hasCredit ? false : null,
    // 051 워크플로 필드
    receipt_status: inferredReceiptStatus,
    receipt_date: payload.receiptDate || null,
    approval_status: inferredApprovalStatus,
    payment_info: payload.paymentInfo || null,
    // 058 과세/면세 스냅샷
    taxable_amount: taxableAmount,
    exempt_amount: exemptAmount,
    vat_amount: vatAmount,
  };

  // 컬럼 누락 방어: 단계적으로 optional 필드를 제거하며 재시도
  const optionalKeys: string[] = [
    'receipt_status', 'receipt_date', 'approval_status', 'payment_info',
    'customer_grade_at_order', 'point_rate_applied',
    'taxable_amount', 'exempt_amount', 'vat_amount',
  ];
  let saleOrder: any = null;
  let saleError: any = null;
  {
    const first = await db.from('sales_orders').insert(salePayload).select().single();
    saleOrder = first.data; saleError = first.error;
  }
  // 누락 컬럼이면 optional 제거 후 재시도 (최대 1회)
  if (saleError) {
    const msg = String(saleError.message || '').toLowerCase();
    const code = String((saleError as any).code || '');
    const isMissingCol = code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
    if (isMissingCol) {
      for (const k of optionalKeys) delete salePayload[k];
      const retry = await db.from('sales_orders').insert(salePayload).select().single();
      saleOrder = retry.data; saleError = retry.error;
    }
  }
  if (saleError) return { error: saleError.message };
  const saleOrderId = (saleOrder as any).id;

  // ②-a 분할 결제 기록
  if (splits.length > 0) {
    const paymentRows = splits.map(s => ({
      sales_order_id: saleOrderId,
      payment_method: s.method,
      amount: s.amount,
      approval_no: s.approvalNo || null,
      card_info: s.cardInfo || null,
      memo: s.memo || null,
      created_by: userId || null,
    }));
    const { error: payErr } = await db.from('sales_order_payments').insert(paymentRows);
    if (payErr) console.error('[processPosCheckout] sales_order_payments insert failed:', payErr);
  }

  // ②-b 택배 정보 있으면 shipments 레코드 생성
  if (shipping && shipping.recipient_name && shipping.recipient_phone && shipping.recipient_address) {
    // sender_* 는 NOT NULL 이므로 '' 로라도 채움 (없으면 구매자 정보 대체)
    const senderName = shipping.sender_name || '';
    const senderPhone = shipping.sender_phone || '';
    // items_summary: 실제 배송 대상(PARCEL/QUICK) 품목만 요약 — PICKUP 품목은 제외
    const shipItems = cart.filter(c => (c.deliveryType || 'PICKUP') !== 'PICKUP');
    const summarySource = shipItems.length > 0 ? shipItems : cart; // 레거시: 모두 기본값이면 전체
    // 옵션 포함(#40): cafe24 route 패턴과 일치 — 'name [opt] xqty'. composeDeliveryMessage 중복필터가 이중표기 방지.
    const itemsSummary = summarySource.map(c => {
      const opt = (c.orderOption || '').trim();
      const namePart = opt ? `${c.name} [${opt}]` : c.name;
      return c.quantity > 1 ? `${namePart} x${c.quantity}` : namePart;
    }).join(', ');
    const payloadBase: any = {
      source: 'STORE',
      sales_order_id: saleOrderId,
      branch_id: stockBranchId,
      sender_name: senderName,
      sender_phone: senderPhone,
      recipient_name: shipping.recipient_name,
      recipient_phone: shipping.recipient_phone,
      recipient_zipcode: shipping.recipient_zipcode || null,
      recipient_address: shipping.recipient_address,
      recipient_address_detail: shipping.recipient_address_detail || null,
      delivery_message: shipping.delivery_message || null,
      items_summary: itemsSummary || null,
      status: 'PENDING',
    };
    const payloadFull = {
      ...payloadBase,
      delivery_type: shipping.delivery_type || 'PARCEL',
      sender_zipcode: shipping.sender_zipcode || null,
      sender_address: shipping.sender_address || null,
      sender_address_detail: shipping.sender_address_detail || null,
    };

    let { data: shipData, error: shipErr } = await db.from('shipments').insert(payloadFull).select('id');
    // 마이그레이션 050/046 미적용 컬럼(delivery_type/sender_*) 방어 — 제거 후 재시도
    if (shipErr) {
      const msg = String(shipErr.message || '').toLowerCase();
      const code = String((shipErr as any).code || '');
      const isMissingCol = code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
      if (isMissingCol) {
        console.warn('[processPosCheckout] shipments 신규 컬럼 없음 — 재시도:', msg);
        // delivery_type만 빠진 경우 우선 시도
        const { delivery_type, ...withoutType } = payloadFull;
        const retryA = await db.from('shipments').insert(withoutType).select('id');
        if (retryA.error) {
          // sender_* 도 없는 경우 (046 미적용)
          const retryB = await db.from('shipments').insert(payloadBase).select('id');
          shipErr = retryB.error;
          shipData = retryB.data;
        } else {
          shipErr = null;
          shipData = retryA.data;
        }
      }
    }
    if (shipErr) {
      console.error('[processPosCheckout] shipments insert failed:', shipErr);
      return { error: `택배 정보 저장 실패: ${shipErr.message}` };
    }
    console.log('[processPosCheckout] shipment created:', shipData);
  }

  // ③ 판매 항목 저장 — 배치 INSERT (N개 순차 round-trip → 1회)
  const itemPayloads: any[] = cart.map(item => {
    const dtype: ItemDeliveryType = (item.deliveryType as ItemDeliveryType) || 'PICKUP';
    const itemReceiptStatus: ReceiptStatus =
      dtype === 'PARCEL' ? 'PARCEL_PLANNED'
      : dtype === 'QUICK' ? 'QUICK_PLANNED'
      : 'RECEIVED';
    return {
      sales_order_id: saleOrderId,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.price,
      discount_amount: item.discount || 0,
      total_price: item.price * item.quantity - (item.discount || 0),
      order_option: item.orderOption || null,
      delivery_type: dtype,
      receipt_status: itemReceiptStatus,
      receipt_date: item.receiptDate || null,
    };
  });
  {
    const optionalCols = ['order_option', 'delivery_type', 'receipt_status', 'receipt_date'];
    let r = await db.from('sales_order_items').insert(itemPayloads);
    // 컬럼 누락 대응: optional 필드 제거 후 재시도 (051/052 미적용 환경)
    if (r.error) {
      const msg0 = String(r.error.message || '').toLowerCase();
      const code0 = String((r.error as any).code || '');
      if (code0 === '42703' || (msg0.includes('column') && msg0.includes('does not exist'))) {
        const slim = itemPayloads.map(p => {
          const s: any = { ...p };
          for (const k of optionalCols) delete s[k];
          return s;
        });
        await db.from('sales_order_items').insert(slim);
      }
    }
  }

  // ④ 재고 차감 + 이동 기록 (출고 지점 기준)
  const stockUpdates: Record<string, number> = {};
  // COGS(매출원가) — 실제 재고 OUT된 분(일반 + 팬텀 분해 자재) × products.cost 누적.
  // 재고자산(1130) 감소와 정확히 일치시키기 위해 ④ 차감 큐에서 직접 합산.
  let posCogs = 0;
  let movementMemo: string | null = null;
  if (stockBranchId !== branchId) {
    const { data: bns } = await supabase
      .from('branches').select('id, name').in('id', [branchId, stockBranchId]);
    const nameOf = (id: string) => (bns as any[] | null)?.find(b => b.id === id)?.name || id;
    movementMemo = `판매: ${nameOf(branchId)}, 출고: ${nameOf(stockBranchId)}`;
  }
  // ④ 재고 차감 — 합산 후 배치 (B: 재고 SELECT N키 → 1, movements INSERT N키 → 1)
  //   동일 product_id가 카트에 중복 존재하는 경우 UNIQUE 충돌을 피하기 위해
  //   product_id 단위로 묶어서 수량 합산 후 차감.
  {
    // 일반 제품: product_id별 총 수량 합산
    const normalMap = new Map<string, number>();
    // Phantom 제품: (material_id → totalQty) 합산
    const phantomMap = new Map<string, { qty: number; memo: string }>();

    for (const item of cart) {
      // Phantom 우선 분기 — phantom 제품은 본인 track_inventory=false(자동)이므로
      // track 체크보다 먼저 와야 BOM 분해가 실제로 실행된다.
      if (phantomByProduct.get(item.productId) === true) {
        const components = bomByPhantom.get(item.productId) || [];
        const phantomMemo = [movementMemo, `세트분해: ${item.name} ×${item.quantity}`]
          .filter(Boolean).join(' · ');
        for (const c of components) {
          // 소수점 재고 허용 material 은 분수 그대로(4자리 반올림), 비허용은 기존 Math.ceil 유지.
          const raw = c.quantity * item.quantity;
          const totalQty = decimalByMaterial.get(c.material_id)
            ? Math.round(raw * 10000) / 10000
            : Math.ceil(raw);
          if (totalQty <= 0) continue;
          const prev = phantomMap.get(c.material_id);
          phantomMap.set(c.material_id, { qty: (prev?.qty || 0) + totalQty, memo: phantomMemo });
        }
        continue;
      }
      // 재고 비관리 제품(SERVICE 등): 차감/이력 모두 skip
      if (trackByProduct.get(item.productId) === false) continue;
      // 일반 제품: product_id 단위 합산
      normalMap.set(item.productId, (normalMap.get(item.productId) || 0) + item.quantity);
    }

    // 차감 대상 product_id 집합 (normal + phantom material, 중복 제거)
    const stockIds = Array.from(new Set([...normalMap.keys(), ...phantomMap.keys()]));
    if (stockIds.length > 0) {
      // (1) 단일 SELECT — 출고 지점 + 대상 키 전체
      const { data: invRows } = await supabase
        .from('inventories').select('id, quantity, product_id')
        .eq('branch_id', stockBranchId).in('product_id', stockIds);
      const invByProduct = new Map<string, { id: string; quantity: any }>();
      for (const r of (invRows as any[]) || []) {
        invByProduct.set(r.product_id, { id: r.id, quantity: r.quantity });
      }

      // (2) 각 키별 after 산술(decrementStock와 동일) + stockUpdates 기록
      //     + UPDATE/INSERT 병렬 작업 + movements 배열 구성
      const writeTasks: Promise<any>[] = [];
      const movementRows: any[] = [];
      const queue: Array<{ productId: string; qty: number; refType: 'POS_SALE' | 'PHANTOM_DECOMPOSE'; memo: string | null }> = [];
      for (const [productId, qty] of normalMap) {
        queue.push({ productId, qty, refType: 'POS_SALE', memo: movementMemo });
      }
      for (const [materialId, { qty, memo }] of phantomMap) {
        queue.push({ productId: materialId, qty, refType: 'PHANTOM_DECOMPOSE', memo });
      }
      for (const { productId, qty, refType, memo } of queue) {
        const existing = invByProduct.get(productId);
        const before = toNum(existing?.quantity);
        const after = before - qty;
        stockUpdates[productId] = after;
        // COGS 누적 — 실제 OUT된 product_id(일반 or 분해 자재)의 실원가 × 수량.
        posCogs += qty * (costByProduct.get(productId) || 0);
        if (existing) {
          writeTasks.push(db.from('inventories').update({ quantity: after }).eq('id', existing.id));
        } else {
          // 레코드가 없으면 음수로 신규 생성 — 추후 입고 시 누적 복원
          writeTasks.push(db.from('inventories').insert({
            branch_id: stockBranchId,
            product_id: productId,
            quantity: after,
            safety_stock: 0,
          }));
        }
        movementRows.push({
          branch_id: stockBranchId,
          product_id: productId,
          movement_type: 'OUT',
          quantity: qty,
          reference_id: saleOrderId,
          reference_type: refType,
          memo,
        });
      }
      // (3) UPDATE/INSERT 병렬, movements 배열 1회 INSERT — 함께 대기
      writeTasks.push(db.from('inventory_movements').insert(movementRows));
      await Promise.all(writeTasks);
    }
  }

  // ⑤ 포인트 처리
  if (customerId) {
    const { data: lastHist } = await db.from('point_history').select('balance')
      .eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const currentPoints = lastHist?.balance || 0;

    if (usePoints && pointsToUse > 0) {
      // D1: use+earn 2건을 배열 1회 insert (balance는 JS 계산, DB 의존 없음 — 순서·값 동일)
      const afterUse = currentPoints - pointsToUse;
      await db.from('point_history').insert([
        {
          customer_id: customerId, sales_order_id: saleOrderId,
          type: 'use', points: -pointsToUse, balance: afterUse,
          description: `포인트 사용 (${orderNumber})`,
        },
        {
          customer_id: customerId, sales_order_id: saleOrderId,
          type: 'earn', points: pointsEarned, balance: afterUse + pointsEarned,
          description: `구매 적립 (${orderNumber})`,
        },
      ]);
    } else {
      await db.from('point_history').insert({
        customer_id: customerId, sales_order_id: saleOrderId,
        type: 'earn', points: pointsEarned, balance: currentPoints + pointsEarned,
        description: `구매 적립 (${orderNumber})`,
      });
    }
  }

  // ⑤-b 매출 분개 (source_type='SALE') — best-effort.
  //   매출(4110)/부가세예수금(2151)/수금계정 + 실원가 COGS(매출원가5110 차 / 재고자산1130 대).
  //   현장 결제는 이미 끝난 거래이므로 분개 실패가 판매를 롤백/차단하면 안 됨(경고만).
  try {
    await createSaleJournal({
      orderId: saleOrderId,
      orderNumber,
      orderDate: (payload.saleDate || new Date().toISOString()).slice(0, 10),
      totalAmount: finalAmount,        // 고객 실수령 결제액(net, VAT 포함)
      paymentMethod: topMethod,
      cogs: posCogs,
      taxableAmount,                   // ②에서 산정한 과세분(0이면 면세 → VAT 라인 없음)
      sourceType: 'SALE',
      createdBy: userId || undefined,
    });
  } catch (e) {
    console.error('[processPosCheckout] createSaleJournal failed (best-effort):', e);
  }

  // ⑥ 주문 완료 알림톡 자동 발송 (등록 고객 + 매핑 존재 시)
  //   A: customers/branches 조회 + 발송을 응답 반환과 분리(fire-and-forget). 알림은 원래
  //   fireNotificationTrigger 가 .catch fire-and-forget 라 best-effort 설계 — 신뢰성 등급 동일.
  if (customerId) {
    void (async () => {
      const { data: cust } = await (db as any)
        .from('customers')
        .select('name, phone, grade')
        .eq('id', customerId)
        .maybeSingle();
      const { data: br } = await (db as any)
        .from('branches').select('name').eq('id', branchId).maybeSingle();

      if (cust?.name && cust?.phone) {
        await fireNotificationTrigger({
          eventType: 'ORDER_COMPLETE',
          customer: { id: customerId, name: cust.name, phone: cust.phone },
          context: {
            orderNo: orderNumber,
            amount: totalAmount - discountAmount,
            branchName: br?.name || '',
            customerGrade: cust.grade || 'NORMAL',
          },
        });
      }
    })().catch(() => {});
  }

  return { orderNumber, pointsEarned, stockUpdates };
}

// ============ Simple Sales Order (AI Agent) ============
// 에이전트 단순 현장판매 전용. CheckoutPayload 를 조립해 processPosCheckout 에 위임만 한다.
// 택배/분할/외상/할인은 미지원 — 입력 자체를 받지 않으므로 영구 미발생. POS 화면을 안내할 것.
export async function createSimpleSalesOrder(input: {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  branch_channel?: string;
  customer_id?: string | null;
  customer_grade?: string | null;
  items: { product_id: string; name: string; price: number; quantity: number }[];
  payment_method: 'cash' | 'card' | 'kakao';
  use_points?: boolean;
  user_id?: string | null;
  // 택배 확장 (전부 optional — 미지정 시 기존 방문판매 동작 그대로)
  ship_from_branch_id?: string;
  shipping?: {
    recipient_name: string;
    recipient_phone: string;
    recipient_address: string;
    recipient_zipcode?: string;
    recipient_address_detail?: string;
    delivery_message?: string;
    delivery_type?: 'PARCEL' | 'QUICK';
  } | null;
}): Promise<{ orderNumber?: string; pointsEarned?: number; error?: string }> {
  if (!input.items || input.items.length === 0) {
    return { error: '판매 품목이 없습니다.' };
  }

  const cart: CartItem[] = input.items.map((it) => ({
    productId: it.product_id,
    name: it.name,
    price: it.price,
    quantity: it.quantity,
  }));

  const finalAmount = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);

  // 포인트 사용: 회원이고 use_points 일 때만. 보유 잔액과 결제금액 중 작은 값.
  let pointsToUse = 0;
  const usePoints = !!input.use_points && !!input.customer_id;
  if (usePoints && input.customer_id) {
    const supabase = await createClient();
    const { data: ph } = await (supabase as any)
      .from('point_history')
      .select('balance')
      .eq('customer_id', input.customer_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    const balance = ph?.balance ?? 0;
    pointsToUse = Math.min(balance, finalAmount);
  }

  const payload: CheckoutPayload = {
    branchId: input.branch_id,
    branchCode: input.branch_code,
    branchName: input.branch_name,
    branchChannel: input.branch_channel || '',
    customerId: input.customer_id || null,
    customerGrade: input.customer_grade || null,
    gradePointRate: 1.0, // 서버 resolvePointRate 가 재해결(표시용 기본값)
    cart,
    totalAmount: finalAmount,
    discountAmount: 0,
    finalAmount,
    paymentMethod: input.payment_method,
    usePoints: usePoints && pointsToUse > 0,
    pointsToUse,
    userId: input.user_id || null,
  };

  // 택배: shipping 지정 시에만 (sender_*는 비움 — processPosCheckout이 ''로 넣고
  //   CJ export resolveSenderForRow가 출고지점 폴백 처리. 기존 정책과 충돌 금지).
  if (input.shipping) {
    payload.shipping = {
      ...input.shipping,
      delivery_type: input.shipping.delivery_type || 'PARCEL',
    };
    payload.shipFromBranchId = input.ship_from_branch_id || input.branch_id;
  }

  return processPosCheckout(payload);
}

// ============ Product Files ============

export async function addProductFile(
  productId: string,
  fileUrl: string,
  fileName: string,
  fileType: 'image' | 'document'
) {
  const supabase = await createClient();

  const { error } = await supabase.from('product_files').insert({
    product_id: productId,
    file_url: fileUrl,
    file_name: fileName,
    file_type: fileType,
  } as any);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/products');
  return { success: true };
}

export async function deleteProductFile(fileId: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('product_files').delete().eq('id', fileId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/products');
  return { success: true };
}
