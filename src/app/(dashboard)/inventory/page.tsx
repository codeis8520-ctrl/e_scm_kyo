'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MovementHistoryModal from './MovementHistoryModal';
import PackUnpackModal from './PackUnpackModal';
import StockMovementPanel from './StockMovementPanel';   // #79 재고변동전표 통합(창고이동·자가사용·강제조정)
import StockTransferList from './StockTransferList';     // #86 재고변동전표 통합 조회
import { getInventoryUsageTypes } from '@/lib/actions';
import { updateSafetyStock } from '@/lib/inventory-actions';
import { backfillMissingInventories } from '@/lib/inventory-backfill-actions';
import { buildCategoryInfo, type CategoryRow } from '@/lib/category-tree';
import { toNum, fmtStock } from '@/lib/validators';

type ProductType = 'FINISHED' | 'RAW' | 'SUB' | 'SERVICE';

interface Inventory {
  id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  safety_stock: number;
  branch?: { id: string; name: string; is_headquarters?: boolean };
  product?: { id: string; name: string; code: string; barcode?: string; product_type?: ProductType | null; category_id?: string | null; track_inventory?: boolean; is_phantom?: boolean; pack_child_id?: string | null; pack_child_qty?: number | null; price?: number | null; allow_decimal_stock?: boolean };
}

interface Branch {
  id: string;
  name: string;
  is_headquarters?: boolean;
}

// 제품별 피벗 행: 제품 정보 + 지점별 재고 맵
interface ProductRow {
  productId: string;
  productName: string;
  productCode: string;
  productType?: ProductType | null;
  barcode?: string;
  categoryId: string | null;
  trackInventory: boolean;
  isPhantom: boolean;
  packChildId: string | null;
  packChildQty: number | null;
  price: number;
  allowDecimal: boolean;
  byBranch: Record<string, Inventory>;
}

// 원자재·부자재는 본사에서만 입출고·조정 가능 (OEM 위탁 생산 모델)
function isMaterialType(t?: ProductType | null): boolean {
  return t === 'RAW' || t === 'SUB';
}
const TYPE_BADGE: Record<ProductType, { label: string; cls: string }> = {
  FINISHED: { label: '완제품', cls: 'bg-blue-100 text-blue-700' },
  RAW:      { label: '원자재', cls: 'bg-emerald-100 text-emerald-700' },
  SUB:      { label: '부자재', cls: 'bg-amber-100 text-amber-700' },
  SERVICE:  { label: '무형상품', cls: 'bg-purple-100 text-purple-700' },
};
const TYPE_FILTER_OPTIONS: Array<{ value: '' | ProductType; label: string }> = [
  { value: '',         label: '전체' },
  { value: 'FINISHED', label: '완제품' },
  { value: 'RAW',      label: '원자재' },
  { value: 'SUB',      label: '부자재' },
  { value: 'SERVICE',  label: '무형상품' },
];

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

export default function InventoryPage() {
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>(''); // 선택 카테고리 id (자기+자손 포함)
  const [typeFilter, setTypeFilter] = useState<'' | ProductType>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  // #79 재고변동전표 — 그리드 클릭으로 변동유형/품목을 preset 해 '재고변동전표' 서브뷰를 연다.
  const [movementPreset, setMovementPreset] = useState<{ type: 'TRANSFER' | 'USAGE' | 'ADJUST'; productId?: string; branchId?: string } | null>(null);
  const [usageTypes, setUsageTypes] = useState<{ id: string; code: string; name: string }[]>([]);
  const [viewMode, setViewMode] = useState<'pivot' | 'flat'>('pivot');
  const [sortMode, setSortMode] = useState<'category' | 'name' | 'stockDesc' | 'stockAsc'>('category');
  const [subView, setSubView] = useState<'stock' | 'transfer' | 'transferList'>('stock');
  const [flatBranchFilter, setFlatBranchFilter] = useState('');
  // 재고 변동 이력 모달
  const [historyProduct, setHistoryProduct] = useState<{ id: string; name: string; code: string } | null>(null);
  const [historyInitialBranchId, setHistoryInitialBranchId] = useState<string | undefined>(undefined);
  // 박스 분해/재포장 모달
  const [packTarget, setPackTarget] = useState<{
    id: string; name: string; code: string; packChildId: string; packChildQty: number; isPhantom: boolean;
  } | null>(null);
  const [packInitialBranchId, setPackInitialBranchId] = useState<string | undefined>(undefined);
  // Phantom + pack_child 가 설정된 제품 — 본인 inventories 행이 없어서 일반 fetch 에는 안 잡힘.
  // Pack/Unpack 버튼 도달용으로 별도 메타 보관.
  type PhantomPackProduct = {
    id: string; name: string; code: string; barcode: string | null;
    productType: ProductType | null; categoryId: string | null;
    packChildId: string; packChildQty: number;
  };
  const [phantomPackProducts, setPhantomPackProducts] = useState<PhantomPackProduct[]>([]);

  // #107 딥링크 — 재고 이력의 '재고변동전표' 행 클릭 시 ?view=transferList 로 전표조회 탭 오픈.
  //   (useSearchParams는 Suspense 경계를 요구 → 마운트 시 location.search 직접 파싱으로 회피)
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'transferList' || v === 'transfer' || v === 'stock') setSubView(v);
  }, []);

  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';
  const isHQUser = userRole === 'SUPER_ADMIN' || userRole === 'HQ_OPERATOR';
  // #107 마스터·본부대표·HQ — 재고변동전표 취소(반대전표)·정정 권한.
  const isMaster = userRole === 'SUPER_ADMIN' || userRole === 'EXECUTIVE' || userRole === 'HQ_OPERATOR';

  // 첫 진입 — 페이지 메타(지점·카테고리)만 로드. inventories 는 검색 조건이 있을 때만.
  useEffect(() => {
    (async () => {
      // 누락 재고 행 자가 치유 (조용히, idempotent)
      try {
        const r = await backfillMissingInventories();
        if (r.inserted > 0) {
          console.log(`[inventory] 누락 재고 행 ${r.inserted}개 자동 복구`);
        }
      } catch (e) {
        console.warn('[inventory] backfill 스킵:', e);
      }
      fetchBranches();
      fetchCategories();
      // 사용유형(소모 차감용) — 마이그 079 미적용/빈배열이면 빈 목록. active 만 필터.
      try {
        const r = await getInventoryUsageTypes();
        const active = (r.data || []).filter((u: any) => u.is_active !== false);
        setUsageTypes(active.map((u: any) => ({ id: u.id, code: u.code, name: u.name })));
      } catch (e) {
        console.warn('[inventory] usageTypes 로드 스킵:', e);
      }
    })();
    if (isBranchUser && userBranchId) {
      setFlatBranchFilter(userBranchId);
      setViewMode('flat');
    }
    setLoading(false);
  }, []);

  // 검색 조건이 바뀔 때만 fetchInventory 실행 (debounced)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const hasFilter = !!(
      debouncedSearch.trim() || categoryFilter || typeFilter || (isBranchUser && userBranchId)
    );
    if (!hasFilter) {
      setInventories([]);
      setPhantomPackProducts([]);
      return;
    }
    fetchInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, categoryFilter, typeFilter, flatBranchFilter]);

  const fetchCategories = async () => {
    const supabase = createClient();
    const res = await supabase
      .from('categories')
      .select('id, name, parent_id, sort_order')
      .order('sort_order');
    setCategories((res.data as CategoryRow[]) || []);
  };

  const fetchBranches = async () => {
    const supabase = createClient();
    // #96 재고현황·이동·출고처 = 창고(is_warehouse=true)만. 온라인 채널(자사몰 등) 제외.
    //   is_headquarters/is_warehouse 미적용 DB는 단계적 폴백.
    let res: any = await supabase
      .from('branches')
      .select('id, name, is_headquarters')
      .eq('is_active', true)
      .eq('is_warehouse', true)
      .order('name');
    if (res.error && /is_warehouse/i.test(String(res.error.message))) {
      res = await supabase.from('branches').select('id, name, is_headquarters').eq('is_active', true).order('name');
    }
    if (res.error) {
      res = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
    }
    // 재고현황 그리드 지점 열 순서 — 운영 우선순위 고정. 미지정 지점은 뒤에(이름순).
    const BRANCH_ORDER = ['본사', '청담점', '한남점', '강남신세계', '대구신세계', '명동신세계', '대전신세계', '경옥가(제품)', '경옥가(생산)'];
    const orderIdx = (n: string) => { const i = BRANCH_ORDER.indexOf(n); return i === -1 ? BRANCH_ORDER.length : i; };
    const sortedBranches = (res.data || []).slice().sort((a: any, b: any) => {
      const d = orderIdx(a.name) - orderIdx(b.name);
      return d !== 0 ? d : String(a.name).localeCompare(String(b.name), 'ko');
    });
    setBranches(sortedBranches);
  };

  // 검색·필터 매칭 product_id 만 페치 — 전체 페치 X (사용자 요청: 검색 위주, 첫 로드 즉시)
  const fetchInventory = async () => {
    setLoading(true);
    const supabase = createClient();
    const t0 = performance.now();

    // 1) 매칭 product_id 추출 — search/typeFilter/categoryFilter 적용
    //    정책: Phantom(세트상품)은 본인 재고 관리 대상 아님 → 일반 검색에서 제외.
    //    단, pack_child_id 가 설정된 Phantom 은 Pack/Unpack 버튼 도달용으로 별도 노출.
    const q = debouncedSearch.trim();
    let pq = supabase.from('products')
      .select('id, name, code, barcode, product_type, category_id, is_phantom, pack_child_id, pack_child_qty')
      .eq('is_active', true);
    if (typeFilter) pq = pq.eq('product_type', typeFilter);
    if (categoryFilter && allowedCategoryIds && allowedCategoryIds.size > 0) {
      pq = pq.in('category_id', Array.from(allowedCategoryIds));
    }
    if (q) {
      const safe = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      pq = pq.or(`name.ilike."%${safe}%",code.ilike."%${safe}%",barcode.ilike."%${safe}%"`);
    }
    const { data: matchedProducts, error: pErr } = await (pq as any).range(0, 999);
    if (pErr) {
      console.error('[inventory] product 매칭 실패', pErr);
      setLoading(false);
      return;
    }

    const allMatched = (matchedProducts || []) as any[];
    // Phantom + pack_child: 본인 재고 없음 → 별도 행 합성 대상.
    const phantomPacks: PhantomPackProduct[] = allMatched
      .filter(p => p.is_phantom === true && p.pack_child_id && p.pack_child_qty)
      .map(p => ({
        id: p.id,
        name: p.name,
        code: p.code,
        barcode: p.barcode ?? null,
        productType: (p.product_type ?? null) as ProductType | null,
        categoryId: p.category_id ?? null,
        packChildId: p.pack_child_id,
        packChildQty: p.pack_child_qty,
      }));
    setPhantomPackProducts(phantomPacks);

    const productIds = allMatched
      .filter(p => p.is_phantom !== true)
      .map(p => p.id);
    if (productIds.length === 0 && phantomPacks.length === 0) {
      setInventories([]);
      setLoading(false);
      return;
    }
    if (productIds.length === 0) {
      // Phantom-pack 만 매칭됨 — inventories 페치 스킵.
      setInventories([]);
      setLoading(false);
      return;
    }

    // 2) 매칭 product_id 에 해당하는 inventories 만 페치 (지점 필터도 같이)
    const fetchSelect = async (selectCols: string) => {
      let invq = supabase.from('inventories').select(selectCols).in('product_id', productIds);
      if (flatBranchFilter) invq = (invq as any).eq('branch_id', flatBranchFilter);
      return (invq as any).order('product_id').range(0, 9999);
    };

    const trySelects = [
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id, track_inventory, is_phantom, pack_child_id, pack_child_qty, price, allow_decimal_stock)',
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id, track_inventory, is_phantom, pack_child_id, pack_child_qty, price)',
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id, track_inventory, is_phantom)',
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id, track_inventory)',
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id)',
      '*, branch:branches(id, name), product:products(id, name, code, barcode)',
    ];

    let data: any[] = [];
    for (const sel of trySelects) {
      const res: any = await fetchSelect(sel);
      if (!res.error) { data = res.data || []; break; }
      console.warn('[inventory] select 단계 폴백:', res.error);
    }
    console.log(`[inventory] 제품 ${productIds.length} 매칭 → ${data.length}행 — ${(performance.now() - t0).toFixed(0)}ms`);
    setInventories(data);
    setLoading(false);
  };

  // 강제 조정(ADJUST) — 상단 '⚠ 강제 조정' 버튼 전용. 셀 클릭에서는 호출하지 않음.
  // #79 재고변동전표 — 그리드 클릭을 통합 패널(재고변동전표 서브뷰)로 라우팅.
  const openMovement = (type: 'TRANSFER' | 'USAGE' | 'ADJUST', item?: Inventory) => {
    setMovementPreset({
      type,
      productId: item?.product_id,
      branchId: item?.branch_id ?? (isBranchUser && userBranchId ? userBranchId : undefined),
    });
    setSubView('transfer');
  };
  const handleAdjust = (item: Inventory) => openMovement('ADJUST', item);
  const handleUsageClick = (item: Inventory) => openMovement('USAGE', item);
  // #107 재고현황 숫자 클릭 → 해당 지점·품목의 재고 변동 이력(원본 전표 연결)
  const openHistory = (product: { id: string; name: string; code: string }, branchId?: string) => {
    setHistoryProduct(product);
    setHistoryInitialBranchId(branchId);
  };

  // ── 카테고리 트리 정보 (path 코드/정렬키/조상) ────────────────────────
  const categoryInfo = (() => buildCategoryInfo(categories))();

  // 카테고리 필터 옵션 — 트리 순서로 들여쓰기 표시
  const categoryOptions = (() => {
    const arr = Array.from(categoryInfo.values());
    arr.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return arr;
  })();

  // 선택된 카테고리의 자손 + 자기 자신 id 셋 — 필터 매칭용
  const allowedCategoryIds = (() => {
    if (!categoryFilter) return null;
    const result = new Set<string>([categoryFilter]);
    for (const info of categoryInfo.values()) {
      if (info.ancestorIds.has(categoryFilter)) result.add(info.id);
    }
    return result;
  })();

  // ── 피벗 데이터 계산 — 카테고리 트리 순으로 정렬 ──────────────────────
  // 정책(2026-06-16): "재고 관리 필요"(track_inventory) 미체크 품목은 재고현황 목록에서 제외.
  //   phantom/세트(포장용 Pack/Unpack 행 포함)도 track_inventory=false면 숨김 — filteredPivot/filteredFlat에서 필터.
  //   배지·합성은 그대로 두되 표시 필터에서 걸러냄. (재고차감 등 서버 phantom 로직엔 영향 없음.)
  const productRows: ProductRow[] = (() => {
    const map = new Map<string, ProductRow>();
    for (const inv of inventories) {
      if (!inv.product) continue;
      if (!map.has(inv.product_id)) {
        map.set(inv.product_id, {
          productId: inv.product_id,
          productName: inv.product.name,
          productCode: inv.product.code,
          productType: (inv.product.product_type ?? null) as ProductType | null,
          barcode: inv.product.barcode,
          categoryId: inv.product.category_id ?? null,
          trackInventory: inv.product.track_inventory !== false,
          isPhantom: inv.product.is_phantom === true,
          packChildId: inv.product.pack_child_id ?? null,
          packChildQty: inv.product.pack_child_qty ?? null,
          price: inv.product.price ?? 0,
          allowDecimal: inv.product.allow_decimal_stock === true,
          byBranch: {},
        });
      }
      map.get(inv.product_id)!.byBranch[inv.branch_id] = inv;
    }
    // Phantom + pack_child 행 합성 — 본인 재고 없음. Pack/Unpack 버튼 도달용.
    for (const p of phantomPackProducts) {
      if (map.has(p.id)) continue;
      map.set(p.id, {
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        productType: p.productType,
        barcode: p.barcode ?? undefined,
        categoryId: p.categoryId,
        trackInventory: false,
        isPhantom: true,
        packChildId: p.packChildId,
        packChildQty: p.packChildQty,
        price: 0,
        allowDecimal: false,
        byBranch: {},
      });
    }
    const arr = Array.from(map.values());
    const pivotQty = (r: ProductRow) => Object.values(r.byBranch).reduce((s, i) => s + toNum(i.quantity), 0);
    arr.sort((a, b) => {
      if (sortMode === 'name') {
        return a.productName.localeCompare(b.productName, 'ko');
      }
      if (sortMode === 'stockDesc' || sortMode === 'stockAsc') {
        const diff = pivotQty(a) - pivotQty(b);
        const q = sortMode === 'stockDesc' ? -diff : diff;
        if (q !== 0) return q;
        return a.productName.localeCompare(b.productName, 'ko');
      }
      // category: 카테고리 트리 순 → 가격 내림차순(고가순) → 이름 순. 미지정 카테고리는 끝
      const aKey = a.categoryId ? (categoryInfo.get(a.categoryId)?.sortKey || 'zzz') : 'zzz';
      const bKey = b.categoryId ? (categoryInfo.get(b.categoryId)?.sortKey || 'zzz') : 'zzz';
      const cmp = aKey.localeCompare(bKey);
      if (cmp !== 0) return cmp;
      const priceCmp = (b.price || 0) - (a.price || 0);
      if (priceCmp !== 0) return priceCmp;
      return a.productName.localeCompare(b.productName, 'ko');
    });
    return arr;
  })();

  // 본사 지점 id — 원자재·부자재 조정 가능 여부 판정용
  const hqBranchId = branches.find(b => b.is_headquarters)?.id || null;

  // ── 검색 + 카테고리 필터 ──────────────────────────────────────────────
  const searchLower = search.toLowerCase();

  const filteredPivot = productRows.filter(r => {
    if (!r.trackInventory) return false;  // 재고관리 미체크(추적해제) 품목 제외
    if (allowedCategoryIds && !(r.categoryId && allowedCategoryIds.has(r.categoryId))) return false;
    if (typeFilter && (r.productType || 'FINISHED') !== typeFilter) return false;
    if (!searchLower) return true;
    return (
      r.productName.toLowerCase().includes(searchLower) ||
      r.productCode.toLowerCase().includes(searchLower) ||
      (r.barcode || '').toLowerCase().includes(searchLower)
    );
  });

  const filteredFlat = inventories
    .filter(item => {
      if (item.product?.track_inventory === false) return false;  // 재고관리 미체크 제외
      const matchBranch = !flatBranchFilter || item.branch_id === flatBranchFilter;
      const cid = item.product?.category_id ?? null;
      const matchCategory = !allowedCategoryIds || (cid != null && allowedCategoryIds.has(cid));
      const pt = item.product?.product_type ?? 'FINISHED';
      const matchType = !typeFilter || pt === typeFilter;
      const matchSearch = !searchLower ||
        item.product?.name?.toLowerCase().includes(searchLower) ||
        item.product?.code?.toLowerCase().includes(searchLower) ||
        (item.product?.barcode || '').toLowerCase().includes(searchLower);
      return matchBranch && matchCategory && matchType && matchSearch;
    })
    .sort((a, b) => {
      if (sortMode === 'name') {
        const n = (a.product?.name || '').localeCompare(b.product?.name || '', 'ko');
        if (n !== 0) return n;
        return (a.branch?.name || '').localeCompare(b.branch?.name || '', 'ko');
      }
      if (sortMode === 'stockDesc' || sortMode === 'stockAsc') {
        const diff = toNum(a.quantity) - toNum(b.quantity);
        const q = sortMode === 'stockDesc' ? -diff : diff;
        if (q !== 0) return q;
        return (a.product?.name || '').localeCompare(b.product?.name || '', 'ko');
      }
      // category: 카테고리 트리 순 → 가격 내림차순(고가순) → 지점명 → 제품명. 미분류는 끝.
      const aCid = a.product?.category_id ?? null;
      const bCid = b.product?.category_id ?? null;
      const aKey = aCid ? (categoryInfo.get(aCid)?.sortKey || 'zzz') : 'zzz';
      const bKey = bCid ? (categoryInfo.get(bCid)?.sortKey || 'zzz') : 'zzz';
      const c1 = aKey.localeCompare(bKey);
      if (c1 !== 0) return c1;
      const priceCmp = (b.product?.price || 0) - (a.product?.price || 0);
      if (priceCmp !== 0) return priceCmp;
      const c2 = (a.branch?.name || '').localeCompare(b.branch?.name || '', 'ko');
      if (c2 !== 0) return c2;
      return (a.product?.name || '').localeCompare(b.product?.name || '', 'ko');
    });

  // 그룹 빌더 — 카테고리순일 때만 연속 카테고리 행을 묶어 헤더·소계 렌더에 사용.
  //   비-카테고리 정렬은 단일 그룹 1개(헤더·소계 미렌더 → 평면 리스트).
  type FlatGroup = { categoryId: string | null; rows: typeof filteredFlat };
  const flatGroups: FlatGroup[] = [];
  if (sortMode === 'category') {
    for (const r of filteredFlat) {
      const cid = r.product?.category_id ?? null;
      const last = flatGroups[flatGroups.length - 1];
      if (!last || last.categoryId !== cid) flatGroups.push({ categoryId: cid, rows: [r] });
      else last.rows.push(r);
    }
  } else if (filteredFlat.length > 0) {
    flatGroups.push({ categoryId: null, rows: filteredFlat });
  }

  type PivotGroup = { categoryId: string | null; rows: typeof filteredPivot };
  const pivotGroups: PivotGroup[] = [];
  if (sortMode === 'category') {
    for (const r of filteredPivot) {
      const cid = r.categoryId;
      const last = pivotGroups[pivotGroups.length - 1];
      if (!last || last.categoryId !== cid) pivotGroups.push({ categoryId: cid, rows: [r] });
      else last.rows.push(r);
    }
  } else if (filteredPivot.length > 0) {
    pivotGroups.push({ categoryId: null, rows: filteredPivot });
  }

  // 카테고리 헤더 라벨 헬퍼
  const renderCategoryLabel = (cid: string | null) => {
    if (!cid) return <span className="text-slate-400">미분류</span>;
    const info = categoryInfo.get(cid);
    if (!info) return <span className="text-slate-400">미분류</span>;
    return <span><span className="font-mono text-slate-400 mr-1">[{info.pathCode}]</span>{info.pathName}</span>;
  };

  // 지점 사용자(BRANCH_STAFF/PHARMACY_STAFF)는 본인 지점만 조회 — 피벗 매트릭스 컬럼도 자기 지점만 노출.
  //   (데이터 페치는 flatBranchFilter=userBranchId 로 이미 자기 지점만 수신. 여기서 타 지점 컬럼 이름까지 숨김.)
  const visibleBranches = (isBranchUser && userBranchId)
    ? branches.filter(b => b.id === userBranchId)
    : branches;

  // 재고 부족 수 (지점 사용자는 자기 지점만)
  const lowCount = inventories.filter(i =>
    i.product?.track_inventory !== false &&
    toNum(i.quantity) < toNum(i.safety_stock) &&
    (!isBranchUser || !userBranchId || i.branch_id === userBranchId)
  ).length;

  return (
    <div className="card">
      {/* 서브뷰 토글 — 재고현황 / 재고변동전표 입력·조회 (지점고정 사용자도 노출, 출발지 자기지점 잠금) */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit mb-4">
        {([['stock', '재고현황'], ['transfer', '재고변동전표 입력'], ['transferList', '재고변동전표 조회']] as ['stock' | 'transfer' | 'transferList', string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSubView(k)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              subView === k ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subView === 'transfer' && (
        <StockMovementPanel
          branches={branches}
          usageTypes={usageTypes}
          isHQUser={isMaster}   /* #107 14차: 강제조정 권한 = 마스터·본부대표(EXECUTIVE)·HQ */
          defaultBranchId={isBranchUser && userBranchId ? userBranchId : ''}
          branchLocked={isBranchUser && !!userBranchId}
          preset={movementPreset}
          onSuccess={fetchInventory}
        />
      )}

      {subView === 'transferList' && (
        <StockTransferList branches={branches} canReverse={isMaster} usageTypes={usageTypes} />
      )}

      {subView === 'stock' && (<>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <h3 className="sr-only">재고 현황</h3>
          {lowCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              부족 {lowCount}건
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory/count" className="btn-secondary py-2 px-4 text-sm">재고 실사</Link>
          {/* #79: 자가사용·강제조정 별도 버튼 제거 → 재고변동전표 통합 전표에서 변동유형 선택 */}
          <button
            onClick={() => { setMovementPreset(null); setSubView('transfer'); }}
            className="btn-primary text-sm"
            title="창고이동·자가사용·강제조정을 하나의 전표에서 입력"
          >
            + 재고변동전표
          </button>
        </div>
      </div>

      {/* 검색 + 뷰 전환 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap items-start sm:items-center">
        <input
          type="text"
          placeholder="제품명 / 코드 / 바코드 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full sm:w-64"
        />

        {/* 품목 계층 필터 (자기 자신 + 모든 하위 카테고리 포함) */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="input w-full sm:w-64 text-sm"
          title="선택한 카테고리와 모든 하위 카테고리 항목을 표시"
        >
          <option value="">전체 카테고리</option>
          {categoryOptions.map(c => (
            <option key={c.id} value={c.id}>
              {`${'  '.repeat(c.depth)}[${c.pathCode}] ${c.name}`}
            </option>
          ))}
        </select>

        {/* 정렬 필터 — 카테고리순(기본)/이름순/재고순 */}
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
          className="input w-full sm:w-44 text-sm"
          title="목록 정렬 기준"
        >
          <option value="category">카테고리순 → 고가순</option>
          <option value="name">이름순 (가나다)</option>
          <option value="stockDesc">재고 많은순</option>
          <option value="stockAsc">재고 적은순</option>
        </select>

        {/* 제품 유형 필터 — 완제품/원자재/부자재/무형상품 */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {TYPE_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTypeFilter(opt.value)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                typeFilter === opt.value
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 뷰 모드 토글 — 지점 고정 사용자는 지점별만 */}
        {!isBranchUser && (
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            <button
              onClick={() => setViewMode('pivot')}
              className={`px-4 py-2 font-medium transition-colors ${
                viewMode === 'pivot'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              제품별 (전체)
            </button>
            <button
              onClick={() => setViewMode('flat')}
              className={`px-4 py-2 font-medium transition-colors ${
                viewMode === 'flat'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              지점별
            </button>
          </div>
        )}

        {/* 지점별 뷰일 때만 지점 선택 */}
        {viewMode === 'flat' && (
          <select
            value={flatBranchFilter}
            onChange={(e) => setFlatBranchFilter(e.target.value)}
            disabled={isBranchUser}
            className={`input w-full sm:w-44 ${isBranchUser ? 'bg-slate-100 cursor-not-allowed' : ''}`}
          >
            <option value="">전체 지점</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-12">로딩 중...</div>
      ) : inventories.length === 0 && !debouncedSearch.trim() && !categoryFilter && !typeFilter && !(isBranchUser && userBranchId) ? (
        <div className="text-center py-16 px-6 bg-slate-50 rounded-lg border border-dashed border-slate-300">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-slate-600 font-medium mb-1">검색어 또는 필터를 입력해주세요</p>
          <p className="text-xs text-slate-500">
            제품명·코드·바코드로 검색하거나 카테고리/유형을 선택하면 매칭되는 재고만 표시됩니다.
          </p>
          <p className="text-[11px] text-slate-400 mt-3">전체 재고를 한 번에 불러오지 않아 빠르게 동작합니다.</p>
        </div>
      ) : viewMode === 'pivot' ? (
        /* ── 제품별 피벗 뷰 ── */
        <div className="overflow-x-auto">
          <table className="table text-sm min-w-[500px]">
            <thead>
              <tr>
                <th className="w-24">코드</th>
                <th>제품명</th>
                {visibleBranches.map(b => (
                  <th key={b.id} className="text-center whitespace-nowrap">{b.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPivot.length === 0 ? (
                <tr>
                  <td colSpan={3 + visibleBranches.length} className="text-center text-slate-400 py-8">
                    검색 결과가 없습니다
                  </td>
                </tr>
              ) : pivotGroups.flatMap((group, gIdx) => {
                // 카테고리순일 때만 헤더·소계 렌더. 비-카테고리는 평면 행만.
                const showCategoryChrome = sortMode === 'category';
                // 그룹별: 헤더 → 행들 → 소계
                const headerRow = (
                  <tr key={`hdr-${group.categoryId || 'none'}-${gIdx}`} className="bg-slate-50">
                    <td colSpan={2 + visibleBranches.length} className="px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {renderCategoryLabel(group.categoryId)}
                      <span className="text-slate-400 ml-2">({group.rows.length}품목)</span>
                    </td>
                  </tr>
                );

                // 카테고리 소계 — 지점별 합계. 그룹 내 소수점 허용 제품이 있으면 소수 표시.
                const groupHasDecimal = group.rows.some(r => r.allowDecimal);
                const branchTotals: Record<string, number> = {};
                for (const r of group.rows) {
                  for (const b of visibleBranches) {
                    const inv = r.byBranch[b.id];
                    branchTotals[b.id] = (branchTotals[b.id] || 0) + toNum(inv?.quantity);
                  }
                }
                const subtotalRow = (
                  <tr key={`sub-${group.categoryId || 'none'}-${gIdx}`} className="bg-slate-100/70 border-t border-slate-200">
                    <td className="px-3 py-1.5 text-xs text-slate-500 font-medium" colSpan={2}>
                      └ 소계
                    </td>
                    {visibleBranches.map(b => (
                      <td key={b.id} className="text-center text-xs font-semibold text-slate-700">
                        {fmtStock(branchTotals[b.id], groupHasDecimal)}
                      </td>
                    ))}
                  </tr>
                );

                const dataRows = group.rows.map(row => {
                  const hasAnyLow = branches.some(b => {
                    const inv = row.byBranch[b.id];
                    return inv && toNum(inv.quantity) < toNum(inv.safety_stock);
                  });
                  return (
                    <tr key={row.productId} className={hasAnyLow ? 'bg-red-50/30' : ''}>
                    <td className="font-mono text-xs text-slate-500">{row.productCode}</td>
                    <td>
                      <button
                        onClick={() => {
                          setHistoryProduct({ id: row.productId, name: row.productName, code: row.productCode });
                          setHistoryInitialBranchId(undefined);
                        }}
                        title="클릭하여 재고 변동 이력 보기"
                        className="font-medium text-left hover:text-blue-600 hover:underline"
                      >
                        {row.productName}
                      </button>
                      {row.productType === 'RAW' || row.productType === 'SUB' ? (
                        <span className={`ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_BADGE[row.productType].cls}`}>
                          {TYPE_BADGE[row.productType].label}
                        </span>
                      ) : null}
                      {row.isPhantom && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700" title="세트상품(Phantom) — 본인 재고 관리 대상 아님. 구성품 재고를 참조.">
                          세트
                        </span>
                      )}
                      {!row.trackInventory && !row.isPhantom && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700" title="재고 추적이 해제된 제품. 제품 편집에서 활성화 가능.">
                          추적 해제
                        </span>
                      )}
                      {row.barcode && (
                        <span className="ml-2 text-xs text-slate-400 font-mono">{row.barcode}</span>
                      )}
                      {row.packChildId && row.packChildQty && (
                        <button
                          type="button"
                          onClick={() => {
                            setPackTarget({
                              id: row.productId,
                              name: row.productName,
                              code: row.productCode,
                              packChildId: row.packChildId!,
                              packChildQty: row.packChildQty!,
                              isPhantom: row.isPhantom,
                            });
                            setPackInitialBranchId(flatBranchFilter || (isBranchUser ? userBranchId : undefined) || undefined);
                          }}
                          title={row.isPhantom
                            ? `세트 해체/조립 — 1세트 = 소포장 ×${row.packChildQty} (세트 본인 재고 없음, 자식 SKU 만 증감)`
                            : `박스 분해/재포장 — 1박스 = 소포장 ×${row.packChildQty}`}
                          className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200"
                        >
                          📦 분해/재포장
                        </button>
                      )}
                    </td>
                    {visibleBranches.map(b => {
                      const inv = row.byBranch[b.id];
                      // 레코드가 없는 지점은 가상 재고 객체로 처리 (재고 0, 클릭 가능)
                      const effective: Inventory = inv ?? {
                        id: '',
                        branch_id: b.id,
                        product_id: row.productId,
                        quantity: 0,
                        safety_stock: 0,
                        branch: b,
                        product: { id: row.productId, name: row.productName, code: row.productCode, barcode: row.barcode, product_type: row.productType },
                      };
                      const isLow = toNum(effective.quantity) < toNum(effective.safety_stock);
                      const isMissing = !inv;
                      // #107 셀(숫자) 클릭 = 재고 변동 이력(해당 지점·품목). 자가사용·강제조정은
                      //   '재고변동전표 입력' 탭 / 지점별 뷰 행 버튼으로 일원화.
                      // 지점직원은 자기 지점만 조회. (원자재·부자재도 읽기전용 이력은 조회 허용)
                      const otherBranch = isBranchUser && b.id !== userBranchId;
                      const clickable = !otherBranch;
                      return (
                        <td key={b.id} className="text-center p-0">
                          <button
                            onClick={() => { if (clickable) openHistory({ id: row.productId, name: row.productName, code: row.productCode }, b.id); }}
                            disabled={!clickable}
                            title={otherBranch ? '다른 지점 재고는 조회 불가' : '클릭 → 이 지점·품목의 재고 변동 이력(원본 전표 연결)'}
                            className={`w-full h-full px-3 py-2 font-semibold transition-colors rounded ${
                              !clickable
                                ? `cursor-not-allowed ${isMissing ? 'text-slate-300' : isLow ? 'text-red-400' : 'text-slate-400'}`
                                : `hover:ring-2 hover:ring-blue-300 hover:ring-inset ${
                                    isLow
                                      ? 'text-red-600 bg-red-50 hover:bg-red-100'
                                      : 'text-slate-800 hover:bg-blue-50'
                                  }`
                            }`}
                          >
                            {fmtStock(effective.quantity, row.allowDecimal)}
                            {isLow && !isMissing && clickable && <span className="ml-1 text-xs font-normal">↓{fmtStock(effective.safety_stock, row.allowDecimal)}</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  );
                });
                return (showCategoryChrome
                  ? [headerRow, ...dataRows, subtotalRow]
                  : dataRows) as React.ReactElement[];
              })}
            </tbody>
          </table>
          <p className="text-xs text-slate-400 mt-3">
            숫자 클릭 → 재고 변동 이력(원본 전표 연결) · 제품명 클릭 → 변동 이력 · 자가 사용·강제 조정·이동은 상단 '+ 재고변동전표' 또는 지점별 뷰에서 · 빨간 숫자 = 안전재고 미달 (↓기준값)
          </p>
        </div>
      ) : (
        /* ── 지점별 플랫 뷰 ── */
        <div className="overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead>
            <tr>
              <th>지점</th>
              <th>제품코드</th>
              <th>제품명</th>
              <th>바코드</th>
              <th>현재재고</th>
              <th>안전재고</th>
              <th>상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredFlat.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">
                  재고 데이터가 없습니다
                </td>
              </tr>
            ) : flatGroups.flatMap((group, gIdx) => {
              // 카테고리순일 때만 헤더·소계 렌더. 비-카테고리는 평면 행만.
              const showCategoryChrome = sortMode === 'category';
              const headerRow = (
                <tr key={`fhdr-${group.categoryId || 'none'}-${gIdx}`} className="bg-slate-50">
                  <td colSpan={8} className="px-3 py-1.5 text-xs font-semibold text-slate-600">
                    {renderCategoryLabel(group.categoryId)}
                    <span className="text-slate-400 ml-2">({group.rows.length}건)</span>
                  </td>
                </tr>
              );
              // 카테고리 소계 — 수량 합계. 그룹 내 소수점 허용 제품이 있으면 소수 표시.
              const groupHasDecimal = group.rows.some(r => r.product?.allow_decimal_stock === true);
              const totalQty = group.rows.reduce((s, r) => s + toNum(r.quantity), 0);
              const subtotalRow = (
                <tr key={`fsub-${group.categoryId || 'none'}-${gIdx}`} className="bg-slate-100/70 border-t border-slate-200">
                  <td colSpan={4} className="px-3 py-1.5 text-xs text-slate-500 font-medium">└ 소계</td>
                  <td className="text-xs font-semibold text-slate-700">{fmtStock(totalQty, groupHasDecimal)}</td>
                  <td colSpan={3}></td>
                </tr>
              );
              const dataRows = group.rows.map((item) => {
                const allowDecimal = item.product?.allow_decimal_stock === true;
                const isLow = toNum(item.quantity) < toNum(item.safety_stock);
                const pt = item.product?.product_type ?? null;
                const materialBlocked = isMaterialType(pt) && !!hqBranchId && item.branch_id !== hqBranchId;
                // 자가 사용: 지점직원은 자기 지점만, 원자재·부자재는 본사만, 현재고 0 비활성.
                const usageBlocked =
                  materialBlocked
                  || (isBranchUser && item.branch_id !== userBranchId)
                  || toNum(item.quantity) <= 0;
                return (
                <tr key={item.id}>
                  <td>{item.branch?.name}</td>
                  <td className="font-mono text-xs">{item.product?.code}</td>
                  <td>
                    {item.product?.name}
                    {pt === 'RAW' || pt === 'SUB' ? (
                      <span className={`ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_BADGE[pt].cls}`}>
                        {TYPE_BADGE[pt].label}
                      </span>
                    ) : null}
                  </td>
                  <td className="font-mono text-xs text-slate-500">{item.product?.barcode || '-'}</td>
                  <td>
                    {/* #107 현재재고 숫자 클릭 → 해당 지점·품목 재고 변동 이력(원본 전표 연결) */}
                    <button
                      onClick={() => {
                        if (!item.product) return;
                        openHistory({ id: item.product.id, name: item.product.name, code: item.product.code }, item.branch_id);
                      }}
                      title="클릭 → 재고 변동 이력(원본 전표 연결)"
                      className={`hover:underline hover:text-blue-600 transition-colors ${isLow ? 'text-red-600 font-semibold' : 'text-slate-800'}`}
                    >
                      {fmtStock(item.quantity, allowDecimal)}
                    </button>
                  </td>
                  <td>
                    <SafetyStockCell
                      inventoryId={item.id}
                      productId={item.product_id}
                      value={toNum(item.safety_stock)}
                      allowDecimal={allowDecimal}
                      onSaved={fetchInventory}
                    />
                  </td>
                  <td>
                    {isLow ? (
                      <span className="badge badge-error">부족</span>
                    ) : (
                      <span className="badge badge-success">정상</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => { if (!usageBlocked) handleUsageClick(item); }}
                      disabled={usageBlocked}
                      title={
                        materialBlocked
                          ? '원자재·부자재는 본사에서만 처리 가능'
                          : (isBranchUser && item.branch_id !== userBranchId)
                            ? '다른 지점 재고는 처리 불가'
                            : toNum(item.quantity) <= 0
                              ? '현재고 없음 · 자가 사용 불가'
                              : '자가 사용(소모 차감)'
                      }
                      className={`mr-2 ${usageBlocked ? 'text-slate-300 cursor-not-allowed' : 'text-blue-600 hover:underline'}`}
                    >
                      자가 사용
                    </button>
                    {isHQUser && (
                      <button
                        onClick={() => { if (!materialBlocked) handleAdjust(item); }}
                        disabled={materialBlocked}
                        title={materialBlocked ? '원자재·부자재는 본사에서만 조정 가능' : '강제 조정(실사·오류 보정 전용)'}
                        className={`mr-2 ${materialBlocked ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:underline'}`}
                      >
                        ⚠ 강제 조정
                      </button>
                    )}
                    <button
                      onClick={() => openMovement('TRANSFER', item)}
                      className="text-green-600 hover:underline"
                    >
                      이동
                    </button>
                  </td>
                </tr>
                );
              });
              return (showCategoryChrome
                ? [headerRow, ...dataRows, subtotalRow]
                : dataRows) as React.ReactElement[];
            })}
          </tbody>
        </table>
        </div>
      )}
      </>)}

      {/* #79: 자가사용·강제조정·단건이동 모달 제거 → '재고변동전표' 통합 패널로 일원화 */}

      {historyProduct && (
        <MovementHistoryModal
          product={historyProduct}
          // BRANCH 사용자는 자기 지점만 보이도록 제한
          branches={isBranchUser && userBranchId ? branches.filter(b => b.id === userBranchId) : branches}
          initialBranchId={isBranchUser && userBranchId ? userBranchId : historyInitialBranchId}
          onClose={() => { setHistoryProduct(null); setHistoryInitialBranchId(undefined); }}
        />
      )}

      {packTarget && (
        <PackUnpackModal
          parentProduct={packTarget}
          branches={isBranchUser && userBranchId ? branches.filter(b => b.id === userBranchId) : branches}
          initialBranchId={isBranchUser && userBranchId ? userBranchId : packInitialBranchId}
          onClose={() => { setPackTarget(null); setPackInitialBranchId(undefined); }}
          onSuccess={() => { setPackTarget(null); setPackInitialBranchId(undefined); fetchInventory(); }}
        />
      )}
    </div>
  );
}

// ── 안전재고 인라인 편집 셀 ────────────────────────────────────────────────

function SafetyStockCell({ inventoryId, productId, value, allowDecimal, onSaved }: {
  inventoryId: string;
  productId: string;
  value: number;
  allowDecimal?: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const handleSave = async (bulk: boolean) => {
    const num = allowDecimal
      ? Math.round((parseFloat(input) || 0) * 10000) / 10000
      : parseInt(input);
    if (isNaN(num) || num < 0) return;
    if (num === value && !bulk) { setEditing(false); return; }
    setSaving(true);
    let res;
    if (bulk) {
      const { bulkUpdateSafetyStock } = await import('@/lib/inventory-actions');
      res = await bulkUpdateSafetyStock(productId, num);
    } else {
      res = await updateSafetyStock(inventoryId, num);
    }
    setSaving(false);
    if (res.error) { alert(res.error); return; }
    setEditing(false);
    setShowBulk(false);
    onSaved();
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setInput(String(value)); setEditing(true); }}
        className="text-slate-600 hover:text-blue-600 hover:underline cursor-pointer"
        title="클릭하여 안전재고 수정"
      >
        {fmtStock(value, allowDecimal)}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={allowDecimal ? 'any' : 1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(false); if (e.key === 'Escape') setEditing(false); }}
          className="input text-sm py-0.5 w-16 text-center"
          autoFocus
        />
        <button
          onClick={() => handleSave(false)}
          disabled={saving}
          className="px-1.5 py-0.5 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '..' : '저장'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-1.5 py-0.5 rounded text-xs text-slate-500 hover:bg-slate-100"
        >
          취소
        </button>
      </div>
      {!showBulk ? (
        <button
          onClick={() => setShowBulk(true)}
          className="text-xs text-purple-600 hover:underline text-left"
        >
          전 지점 일괄 적용
        </button>
      ) : (
        <button
          onClick={() => handleSave(true)}
          disabled={saving}
          className="px-1.5 py-0.5 rounded text-xs bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {saving ? '적용 중..' : `전 지점 ${input}개로 일괄 적용`}
        </button>
      )}
    </div>
  );
}
