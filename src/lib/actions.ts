'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fireNotificationTrigger } from '@/lib/notification-triggers';
import { computeBomCost } from '@/lib/production-actions';
import { kstTodayString } from '@/lib/date';

// ============ Products ============

export async function getProducts(search?: string) {
  const supabase = await createClient();
  let query = supabase.from('products').select('*, category:categories(*)').order('created_at', { ascending: false });
  
  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
  }
  
  const { data } = await query;
  return { data: data || [] };
}

export async function createProduct(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get('name') as string;
  const nameCode = name
    .replace(/[^a-zA-Z0-9가-힣]/g, '')
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, 'X');
  const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const code = `KYO-${nameCode}-${randomCode}`;

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
  };

  // 마이그 061/059 미적용 폴백 — 컬럼이 없으면 단계적으로 제거 후 재시도
  let { data: newProduct, error } = await (supabase as any)
    .from('products').insert(productData).select().single();
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
  };

  // 마이그 061/059 미적용 폴백 — 단계적으로 컬럼 제거 후 재시도
  let res = await (supabase as any).from('products').update(productData).eq('id', id);
  let error = res.error;
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
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
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
    query = query.or(`product.name.ilike.%${search}%,product.code.ilike.%${search}%`);
  }
  
  const { data } = await query;
  return { data: data || [] };
}

export async function adjustInventory(formData: FormData) {
  const supabase = await createClient();
  const db = supabase as any;

  const branchId = formData.get('branch_id') as string;
  const productId = formData.get('product_id') as string;
  const movementType = formData.get('movement_type') as string;
  const quantity = parseInt(formData.get('quantity') as string);
  const safetyStock = parseInt(formData.get('safety_stock') as string) || 0;
  const memo = formData.get('memo') as string;

  // ── 원자재·부자재는 본사(is_headquarters=true)에서만 입출고·조정 허용 ──
  //   OEM 위탁 생산 모델에서 RAW/SUB는 본사 관리 원칙(CLAUDE.md 생산관리 섹션).
  //   폴백: 마이그 042(product_type) 또는 047(is_headquarters) 미적용 시 제한 생략.
  try {
    const prodRes = await db.from('products').select('product_type').eq('id', productId).maybeSingle();
    const pt: string | null = prodRes?.data?.product_type ?? null;
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
      newQuantity = (current.quantity || 0) + quantity;
    } else if (movementType === 'OUT') {
      newQuantity = (current.quantity || 0) - quantity;
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

export async function transferInventory(formData: FormData) {
  const supabase = await createClient();
  const db = supabase as any;

  const fromBranchId = formData.get('from_branch_id') as string;
  const toBranchId = formData.get('to_branch_id') as string;
  const productId = formData.get('product_id') as string;
  const quantity = parseInt(formData.get('quantity') as string);
  const memo = formData.get('memo') as string;

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

  if (!fromInventory.data || fromInventory.data.quantity < quantity) {
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
      .update({ quantity: toInventory.data.quantity + quantity })
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
    .update({ quantity: fromInventory.data.quantity - quantity })
    .eq('branch_id', fromBranchId)
    .eq('product_id', productId);

  await db.from('inventory_movements').insert({
    branch_id: fromBranchId,
    product_id: productId,
    movement_type: 'OUT',
    quantity: quantity,
    reference_type: 'TRANSFER',
    memo: `지점 이동: ${memo || '출고'}`,
  });

  await db.from('inventory_movements').insert({
    branch_id: toBranchId,
    product_id: productId,
    movement_type: 'IN',
    quantity: quantity,
    reference_type: 'TRANSFER',
    memo: `지점 이동: ${memo || '입고'}`,
  });

  revalidatePath('/inventory');
  return { success: true };
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

export async function deleteBranch(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('branches').delete().eq('id', id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/branches');
  revalidatePath('/system-codes');
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
  const supabase = await createClient();

  // Delete auth user first
  const { error: authError } = await supabase.auth.admin.deleteUser(id);
  
  if (authError) {
    return { error: authError.message };
  }
  
  // User profile will be deleted via cascade or manually
  await supabase.from('users').delete().eq('id', id);
  
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
  if (productIds.length > 0) {
    let ptRes: any = await db.from('products')
      .select('id, product_type, track_inventory, is_phantom').in('id', productIds);
    if (ptRes.error && /is_phantom/i.test(String(ptRes.error.message))) {
      // 061 미적용 — is_phantom 없이 재시도
      ptRes = await db.from('products').select('id, product_type, track_inventory').in('id', productIds);
    }
    if (ptRes.error && /track_inventory/i.test(String(ptRes.error.message))) {
      // 059 미적용 — track_inventory 없이 재시도
      ptRes = await db.from('products').select('id, product_type').in('id', productIds);
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

  // ① 재고 사전 확인 (출고 지점 기준)
  //   ※ 음수 재고 허용 — 부족해도 차단하지 않고 마이너스로 반영, 누적 시 자동 복원.
  //     레코드가 아예 없는 경우만 ④ 단계에서 음수로 자동 생성.

  // ② 판매 전표 생성 (KST 오늘 기준 주문번호 prefix)
  const today = kstTodayString().replace(/-/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const orderNumber = `SA-${branchCode}-${today}-${randomSuffix}`;

  const pointsEarned = customerId
    ? Math.floor(finalAmount * (gradePointRate || 1.0) / 100)
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
    const productIds = Array.from(new Set(cart.map(c => c.productId)));
    const { data: taxRows, error: taxErr } = await db
      .from('products').select('id, is_taxable').in('id', productIds);
    if (!taxErr) {
      const isTaxable = new Map<string, boolean>();
      for (const r of (taxRows as any[]) || []) {
        // is_taxable 컬럼이 없으면(006 미적용) undefined → 기본 true(과세)
        isTaxable.set(r.id, r.is_taxable !== false);
      }
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
    point_rate_applied: customerId ? (gradePointRate || 1.0) : null,
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
    const itemsSummary = summarySource.map(c => c.quantity > 1 ? `${c.name} x${c.quantity}` : c.name).join(', ');
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
  let movementMemo: string | null = null;
  if (stockBranchId !== branchId) {
    const { data: bns } = await supabase
      .from('branches').select('id, name').in('id', [branchId, stockBranchId]);
    const nameOf = (id: string) => (bns as any[] | null)?.find(b => b.id === id)?.name || id;
    movementMemo = `판매: ${nameOf(branchId)}, 출고: ${nameOf(stockBranchId)}`;
  }
  // 재고 차감 1건을 처리하는 헬퍼 — phantom 분해 차감과 일반 차감 모두 사용
  const decrementStock = async (
    productId: string,
    qty: number,
    refType: 'POS_SALE' | 'PHANTOM_DECOMPOSE',
    memo: string | null,
  ) => {
    const { data: inv } = await supabase
      .from('inventories').select('id, quantity')
      .eq('branch_id', stockBranchId).eq('product_id', productId).maybeSingle();
    const inv_ = inv as any;
    const before = inv_?.quantity ?? 0;
    const after = before - qty;
    if (inv_) {
      await db.from('inventories').update({ quantity: after }).eq('id', inv_.id);
    } else {
      // 레코드가 없으면 음수로 신규 생성 — 추후 입고 시 누적 복원
      await db.from('inventories').insert({
        branch_id: stockBranchId,
        product_id: productId,
        quantity: after,
        safety_stock: 0,
      });
    }
    await db.from('inventory_movements').insert({
      branch_id: stockBranchId,
      product_id: productId,
      movement_type: 'OUT',
      quantity: qty,
      reference_id: saleOrderId,
      reference_type: refType,
      memo,
    });
    return after;
  };

  // ④ 재고 차감 — 품목별 병렬 처리 (N×3 순차 round-trip → 병렬)
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
          const totalQty = Math.ceil(c.quantity * item.quantity);
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

    const tasks: Promise<void>[] = [];
    for (const [productId, qty] of normalMap) {
      tasks.push(
        decrementStock(productId, qty, 'POS_SALE', movementMemo)
          .then(after => { stockUpdates[productId] = after; })
      );
    }
    for (const [materialId, { qty, memo }] of phantomMap) {
      tasks.push(
        decrementStock(materialId, qty, 'PHANTOM_DECOMPOSE', memo)
          .then(after => { stockUpdates[materialId] = after; })
      );
    }
    await Promise.all(tasks);
  }

  // ⑤ 포인트 처리
  if (customerId) {
    const { data: lastHist } = await db.from('point_history').select('balance')
      .eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const currentPoints = lastHist?.balance || 0;

    if (usePoints && pointsToUse > 0) {
      const afterUse = currentPoints - pointsToUse;
      await db.from('point_history').insert({
        customer_id: customerId, sales_order_id: saleOrderId,
        type: 'use', points: -pointsToUse, balance: afterUse,
        description: `포인트 사용 (${orderNumber})`,
      });
      await db.from('point_history').insert({
        customer_id: customerId, sales_order_id: saleOrderId,
        type: 'earn', points: pointsEarned, balance: afterUse + pointsEarned,
        description: `구매 적립 (${orderNumber})`,
      });
    } else {
      await db.from('point_history').insert({
        customer_id: customerId, sales_order_id: saleOrderId,
        type: 'earn', points: pointsEarned, balance: currentPoints + pointsEarned,
        description: `구매 적립 (${orderNumber})`,
      });
    }
  }

  // ⑥ 주문 완료 알림톡 자동 발송 (등록 고객 + 매핑 존재 시)
  if (customerId) {
    const { data: cust } = await (db as any)
      .from('customers')
      .select('name, phone, grade')
      .eq('id', customerId)
      .maybeSingle();
    const { data: br } = await (db as any)
      .from('branches').select('name').eq('id', branchId).maybeSingle();

    if (cust?.name && cust?.phone) {
      fireNotificationTrigger({
        eventType: 'ORDER_COMPLETE',
        customer: { id: customerId, name: cust.name, phone: cust.phone },
        context: {
          orderNo: orderNumber,
          amount: totalAmount - discountAmount,
          branchName: br?.name || '',
          customerGrade: cust.grade || 'NORMAL',
        },
      }).catch(() => {});
    }
  }

  return { orderNumber, pointsEarned, stockUpdates };
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
