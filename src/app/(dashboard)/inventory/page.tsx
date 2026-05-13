'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import InventoryModal from './InventoryModal';
import TransferModal from './TransferModal';
import MovementHistoryModal from './MovementHistoryModal';
import { updateSafetyStock } from '@/lib/inventory-actions';
import { backfillMissingInventories } from '@/lib/inventory-backfill-actions';

type ProductType = 'FINISHED' | 'RAW' | 'SUB' | 'SERVICE';

interface Inventory {
  id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  safety_stock: number;
  branch?: { id: string; name: string; is_headquarters?: boolean };
  product?: {
    id: string; name: string; code: string; barcode?: string;
    product_type?: ProductType | null; category_id?: string | null;
    track_inventory?: boolean; is_phantom?: boolean;
    unit?: string | null; unit_size?: number | null; unit_label?: string | null;
  };
  _is_synth_phantom?: boolean;   // Phantom 가용량 합성 행 표시용
}

interface Branch {
  id: string;
  name: string;
  is_headquarters?: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
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
  unit?: string | null;
  unitSize?: number | null;
  unitLabel?: string | null;
  isSynthPhantom?: boolean;       // 합성 phantom 행 (가용량)
  byBranch: Record<string, Inventory>;
}

// 카테고리 트리 정보 — id 별로 path 코드/이름/정렬키/조상셋을 한 번에 보관
interface CategoryInfo {
  id: string;
  name: string;
  parent_id: string | null;
  pathCode: string;            // "1-1-1" — 위치 기반 계층 코드
  pathName: string;            // "제품 / 더경옥 제품 / 단지"
  sortKey: string;             // 정렬용 (3자리 zero-pad 누적)
  ancestorIds: Set<string>;    // 자기 자신 포함
  depth: number;
}

function buildCategoryInfo(categories: CategoryRow[]): Map<string, CategoryInfo> {
  // parent_id로 그룹화 + sort_order/name 정렬
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const c of categories) {
    const list = byParent.get(c.parent_id ?? null) || [];
    list.push(c);
    byParent.set(c.parent_id ?? null, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'ko'));
  }
  const out = new Map<string, CategoryInfo>();
  const walk = (parentId: string | null, parentCode: string, parentName: string, parentSortKey: string, parentAncestors: Set<string>, depth: number) => {
    const list = byParent.get(parentId) || [];
    list.forEach((c, i) => {
      const pos = i + 1;
      const pathCode = parentCode ? `${parentCode}-${pos}` : String(pos);
      const pathName = parentName ? `${parentName} / ${c.name}` : c.name;
      const sortKey = parentSortKey + String(pos).padStart(3, '0') + '/';
      const ancestors = new Set(parentAncestors);
      ancestors.add(c.id);
      out.set(c.id, { id: c.id, name: c.name, parent_id: c.parent_id, pathCode, pathName, sortKey, ancestorIds: ancestors, depth });
      walk(c.id, pathCode, pathName, sortKey, ancestors, depth + 1);
    });
  };
  walk(null, '', '', '', new Set(), 0);
  return out;
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
  const [showModal, setShowModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [editInventory, setEditInventory] = useState<Inventory | null>(null);
  const [transferInventory, setTransferInventory] = useState<Inventory | null>(null);
  const [viewMode, setViewMode] = useState<'pivot' | 'flat'>('pivot');
  const [flatBranchFilter, setFlatBranchFilter] = useState('');
  // 재고 변동 이력 모달
  const [historyProduct, setHistoryProduct] = useState<{ id: string; name: string; code: string } | null>(null);
  const [historyInitialBranchId, setHistoryInitialBranchId] = useState<string | undefined>(undefined);

  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

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
    // is_headquarters 포함 시도 → 마이그 047 미적용 DB 폴백
    let res: any = await supabase
      .from('branches')
      .select('id, name, is_headquarters')
      .eq('is_active', true)
      .order('name');
    if (res.error) {
      res = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
    }
    setBranches(res.data || []);
  };

  // 검색·필터 매칭 product_id 만 페치 — 전체 페치 X (사용자 요청: 검색 위주, 첫 로드 즉시)
  const fetchInventory = async () => {
    setLoading(true);
    const supabase = createClient();
    const t0 = performance.now();

    // 1) 매칭 product 추출 — search/typeFilter/categoryFilter 적용
    //    정책:
    //      · 일반 제품: inventories 직접 페치
    //      · Phantom + unit_size 설정: BOM 기반 가용량(=통 단위)을 합성 행으로 추가
    //      · Phantom + unit_size 미설정: 기존 정책대로 제외 (운영자가 단위 환산 명시 안 한 세트)
    const q = debouncedSearch.trim();
    let pq = supabase
      .from('products')
      .select('id, name, code, barcode, product_type, category_id, track_inventory, is_phantom, unit, unit_size, unit_label')
      .eq('is_active', true);
    if (typeFilter) pq = pq.eq('product_type', typeFilter);
    if (categoryFilter && allowedCategoryIds && allowedCategoryIds.size > 0) {
      pq = pq.in('category_id', Array.from(allowedCategoryIds));
    }
    if (q) {
      const safe = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      pq = pq.or(`name.ilike."%${safe}%",code.ilike."%${safe}%",barcode.ilike."%${safe}%"`);
    }
    let { data: matchedProducts, error: pErr } = await (pq as any).range(0, 999);
    // 마이그 미적용 환경 폴백
    if (pErr) {
      let fallback = supabase.from('products')
        .select('id, name, code, barcode, product_type, category_id, is_phantom')
        .eq('is_active', true);
      if (typeFilter) fallback = fallback.eq('product_type', typeFilter);
      if (categoryFilter && allowedCategoryIds && allowedCategoryIds.size > 0) {
        fallback = fallback.in('category_id', Array.from(allowedCategoryIds));
      }
      if (q) {
        const safe = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        fallback = fallback.or(`name.ilike."%${safe}%",code.ilike."%${safe}%",barcode.ilike."%${safe}%"`);
      }
      const r = await (fallback as any).range(0, 999);
      matchedProducts = r.data; pErr = r.error;
    }
    if (pErr) {
      console.error('[inventory] product 매칭 실패', pErr);
      setLoading(false);
      return;
    }

    const allMatched = (matchedProducts || []) as any[];
    // 일반 제품 (phantom 아님)
    const normalProducts = allMatched.filter(p => p.is_phantom !== true);
    // Phantom + unit_size 설정된 것만 (통 단위 가용량 표시 대상)
    const packPhantoms = allMatched.filter(p => p.is_phantom === true && p.unit_size && p.unit_size > 1);

    const normalIds = normalProducts.map(p => p.id);

    if (normalIds.length === 0 && packPhantoms.length === 0) {
      setInventories([]);
      setLoading(false);
      return;
    }

    // 2) 일반 inventories 페치
    const fetchSelect = async (selectCols: string) => {
      let invq = supabase.from('inventories').select(selectCols).in('product_id', normalIds);
      if (flatBranchFilter) invq = (invq as any).eq('branch_id', flatBranchFilter);
      return (invq as any).order('product_id').range(0, 9999);
    };

    const trySelects = [
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id, track_inventory, is_phantom, unit, unit_size, unit_label)',
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id, track_inventory, is_phantom)',
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id, track_inventory)',
      '*, branch:branches(id, name, is_headquarters), product:products(id, name, code, barcode, product_type, category_id)',
      '*, branch:branches(id, name), product:products(id, name, code, barcode)',
    ];

    let normalRows: any[] = [];
    if (normalIds.length > 0) {
      for (const sel of trySelects) {
        const res: any = await fetchSelect(sel);
        if (!res.error) { normalRows = res.data || []; break; }
        console.warn('[inventory] select 단계 폴백:', res.error);
      }
    }

    // 3) Phantom + unit_size 가용량 합성 행 — BOM 기반 계산
    let phantomRows: any[] = [];
    if (packPhantoms.length > 0) {
      try {
        phantomRows = await buildPhantomAvailabilityRows(supabase, packPhantoms, flatBranchFilter);
      } catch (err) {
        console.warn('[inventory] phantom 가용량 계산 스킵:', err);
      }
    }

    const merged = [...normalRows, ...phantomRows];
    console.log(`[inventory] 일반 ${normalRows.length}행 + 세트 가용 ${phantomRows.length}행 — ${(performance.now() - t0).toFixed(0)}ms`);
    setInventories(merged);
    setLoading(false);
  };

  // Phantom(세트상품) 가용량 합성 행 — unit_size 설정된 phantom 만 처리.
  // 가용량 = floor(min(구성품_i 재고 ÷ BOM 수량_i)) — 단위는 그대로 base.
  // 표시는 base 수량 그대로 (UI 에서 unit_size 환산해 "가용 N통" 표시).
  const buildPhantomAvailabilityRows = async (
    sb: any,
    phantoms: any[],
    branchFilter: string,
  ): Promise<any[]> => {
    const phantomIds = phantoms.map(p => p.id);

    // BOM 페치 — 모든 phantom 의 구성품
    const { data: boms } = await sb
      .from('product_bom')
      .select('product_id, material_id, quantity')
      .in('product_id', phantomIds);
    if (!boms || boms.length === 0) return [];

    // 구성품 id 모음
    const materialIds = Array.from(new Set((boms as any[]).map(b => b.material_id)));

    // 활성 지점 모두 페치 (가용량 행을 지점별로 만들기 위해)
    let branchQ = sb.from('branches').select('id, name, is_headquarters').eq('is_active', true);
    if (branchFilter) branchQ = branchQ.eq('id', branchFilter);
    const { data: branchesData } = await branchQ.order('name');
    const activeBranches = (branchesData || []) as any[];
    if (activeBranches.length === 0) return [];

    // 구성품 재고 페치 (가용 지점들)
    let invQ = sb.from('inventories').select('branch_id, product_id, quantity').in('product_id', materialIds);
    if (branchFilter) invQ = invQ.eq('branch_id', branchFilter);
    const { data: invs } = await invQ.range(0, 99999);
    // 빠른 조회 맵: branch_id__product_id → quantity
    const invMap = new Map<string, number>();
    for (const i of (invs || []) as any[]) {
      invMap.set(`${i.branch_id}__${i.product_id}`, Number(i.quantity) || 0);
    }

    // phantom × branch 별 가용량 계산
    const phantomMap = new Map(phantoms.map(p => [p.id, p]));
    const bomByPhantom = new Map<string, { material_id: string; quantity: number }[]>();
    for (const b of boms as any[]) {
      const arr = bomByPhantom.get(b.product_id) || [];
      arr.push({ material_id: b.material_id, quantity: Number(b.quantity) || 0 });
      bomByPhantom.set(b.product_id, arr);
    }

    const rows: any[] = [];
    for (const phantom of phantoms) {
      const bom = bomByPhantom.get(phantom.id) || [];
      if (bom.length === 0) continue;
      for (const branch of activeBranches) {
        // 구성품별 가용 = 구성품 재고 ÷ BOM 수량. 최소값이 phantom 가용.
        // 가용량은 base 단위 (= phantom 의 unit_size 와 같은 단위. 예: 30환 단위)
        let minAvailable = Infinity;
        for (const b of bom) {
          const stock = invMap.get(`${branch.id}__${b.material_id}`) ?? 0;
          if (b.quantity <= 0) continue;
          const a = Math.floor(stock / b.quantity);
          if (a < minAvailable) minAvailable = a;
        }
        if (!Number.isFinite(minAvailable)) minAvailable = 0;
        // 가용량을 phantom 의 base 단위(예: 30환)로 표시하기 위해 unit_size 곱셈
        // 단, UI 가 unit_size 가 있으면 자동으로 "N통" 으로 환산 표시하므로 그대로 사용.
        // 합성 행 quantity = "환 단위 환산값"(가용 통 수 × unit_size)
        const synthQty = minAvailable * (phantom.unit_size || 1);
        rows.push({
          id: `synth-phantom-${phantom.id}-${branch.id}`,
          branch_id: branch.id,
          product_id: phantom.id,
          quantity: synthQty,
          safety_stock: 0,
          branch: { id: branch.id, name: branch.name, is_headquarters: branch.is_headquarters },
          product: {
            id: phantom.id, name: phantom.name, code: phantom.code, barcode: phantom.barcode,
            product_type: phantom.product_type, category_id: phantom.category_id,
            track_inventory: false, is_phantom: true,
            unit: phantom.unit, unit_size: phantom.unit_size, unit_label: phantom.unit_label,
          },
          _is_synth_phantom: true,  // UI 측 분기용 마커
        });
      }
    }
    return rows;
  };

  const handleAdjust = (item: Inventory) => {
    setEditInventory(item);
    setShowModal(true);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditInventory(null);
  };

  const handleSuccess = () => {
    handleClose();
    fetchInventory();
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
  // 정책: track_inventory=false / is_phantom=true 도 화면엔 노출 (배지로 상태 안내).
  //       이전엔 track_inventory=false 행을 통째로 숨겨서 phantom·세트상품이 안 보이는 문제가 있었음.
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
          unit: inv.product.unit ?? null,
          unitSize: inv.product.unit_size ?? null,
          unitLabel: inv.product.unit_label ?? null,
          isSynthPhantom: inv._is_synth_phantom === true,
          byBranch: {},
        });
      }
      map.get(inv.product_id)!.byBranch[inv.branch_id] = inv;
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      // 카테고리 트리 순 → 같은 카테고리 내 이름 순. 미지정 카테고리는 끝
      const aKey = a.categoryId ? (categoryInfo.get(a.categoryId)?.sortKey || 'zzz') : 'zzz';
      const bKey = b.categoryId ? (categoryInfo.get(b.categoryId)?.sortKey || 'zzz') : 'zzz';
      const cmp = aKey.localeCompare(bKey);
      if (cmp !== 0) return cmp;
      return a.productName.localeCompare(b.productName, 'ko');
    });
    return arr;
  })();

  // 본사 지점 id — 원자재·부자재 조정 가능 여부 판정용
  const hqBranchId = branches.find(b => b.is_headquarters)?.id || null;

  // ── 검색 + 카테고리 필터 ──────────────────────────────────────────────
  const searchLower = search.toLowerCase();

  const filteredPivot = productRows.filter(r => {
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
      // 카테고리 트리 순 → 지점명 → 제품명. 미분류는 끝.
      const aCid = a.product?.category_id ?? null;
      const bCid = b.product?.category_id ?? null;
      const aKey = aCid ? (categoryInfo.get(aCid)?.sortKey || 'zzz') : 'zzz';
      const bKey = bCid ? (categoryInfo.get(bCid)?.sortKey || 'zzz') : 'zzz';
      const c1 = aKey.localeCompare(bKey);
      if (c1 !== 0) return c1;
      const c2 = (a.branch?.name || '').localeCompare(b.branch?.name || '', 'ko');
      if (c2 !== 0) return c2;
      return (a.product?.name || '').localeCompare(b.product?.name || '', 'ko');
    });

  // 그룹 빌더 — 연속된 같은 카테고리 행을 묶어 헤더·소계 렌더에 사용
  type FlatGroup = { categoryId: string | null; rows: typeof filteredFlat };
  const flatGroups: FlatGroup[] = [];
  for (const r of filteredFlat) {
    const cid = r.product?.category_id ?? null;
    const last = flatGroups[flatGroups.length - 1];
    if (!last || last.categoryId !== cid) flatGroups.push({ categoryId: cid, rows: [r] });
    else last.rows.push(r);
  }

  type PivotGroup = { categoryId: string | null; rows: typeof filteredPivot };
  const pivotGroups: PivotGroup[] = [];
  for (const r of filteredPivot) {
    const cid = r.categoryId;
    const last = pivotGroups[pivotGroups.length - 1];
    if (!last || last.categoryId !== cid) pivotGroups.push({ categoryId: cid, rows: [r] });
    else last.rows.push(r);
  }

  // 카테고리 헤더 라벨 헬퍼
  const renderCategoryLabel = (cid: string | null) => {
    if (!cid) return <span className="text-slate-400">미분류</span>;
    const info = categoryInfo.get(cid);
    if (!info) return <span className="text-slate-400">미분류</span>;
    return <span><span className="font-mono text-slate-400 mr-1">[{info.pathCode}]</span>{info.pathName}</span>;
  };

  // 재고 부족 수 (지점 사용자는 자기 지점만)
  const lowCount = inventories.filter(i =>
    i.quantity < i.safety_stock &&
    (!isBranchUser || !userBranchId || i.branch_id === userBranchId)
  ).length;

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-lg">재고 현황</h3>
          {lowCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              부족 {lowCount}건
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory/count" className="btn-secondary py-2 px-4 text-sm">재고 실사</Link>
          <button
            onClick={() => { setEditInventory(null); setShowModal(true); }}
            className="btn-primary text-sm"
          >
            + 입출고
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
                {branches.map(b => (
                  <th key={b.id} className="text-center whitespace-nowrap">{b.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPivot.length === 0 ? (
                <tr>
                  <td colSpan={3 + branches.length} className="text-center text-slate-400 py-8">
                    검색 결과가 없습니다
                  </td>
                </tr>
              ) : pivotGroups.flatMap((group, gIdx) => {
                // 그룹별: 헤더 → 행들 → 소계
                const headerRow = (
                  <tr key={`hdr-${group.categoryId || 'none'}-${gIdx}`} className="bg-slate-50">
                    <td colSpan={2 + branches.length} className="px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {renderCategoryLabel(group.categoryId)}
                      <span className="text-slate-400 ml-2">({group.rows.length}품목)</span>
                    </td>
                  </tr>
                );

                // 카테고리 소계 — 지점별 합계
                const branchTotals: Record<string, number> = {};
                for (const r of group.rows) {
                  for (const b of branches) {
                    const inv = r.byBranch[b.id];
                    branchTotals[b.id] = (branchTotals[b.id] || 0) + (inv?.quantity ?? 0);
                  }
                }
                const subtotalRow = (
                  <tr key={`sub-${group.categoryId || 'none'}-${gIdx}`} className="bg-slate-100/70 border-t border-slate-200">
                    <td className="px-3 py-1.5 text-xs text-slate-500 font-medium" colSpan={2}>
                      └ 소계
                    </td>
                    {branches.map(b => (
                      <td key={b.id} className="text-center text-xs font-semibold text-slate-700">
                        {(branchTotals[b.id] || 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                );

                const dataRows = group.rows.map(row => {
                  const hasAnyLow = branches.some(b => {
                    const inv = row.byBranch[b.id];
                    return inv && inv.quantity < inv.safety_stock;
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
                      {row.isSynthPhantom && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700" title="세트상품 가용량 — BOM 구성품 재고 기반으로 계산. 직접 입출고 X.">
                          🧩 세트 가용
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
                    </td>
                    {branches.map(b => {
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
                      const isLow = effective.quantity < effective.safety_stock;
                      const isMissing = !inv;
                      const isSynth = row.isSynthPhantom === true;
                      // 원자재·부자재는 본사에서만 입출고·조정 가능. 본사 지정이 없으면 제한 생략.
                      const materialBlocked = isMaterialType(row.productType) && !!hqBranchId && b.id !== hqBranchId;
                      // 단위 환산 — unit_size 가 있으면 "통" 단위로 변환 표시
                      const us = row.unitSize ?? 0;
                      const showPack = us > 1;
                      const packQty = showPack ? Math.floor(effective.quantity / us) : 0;
                      const remainder = showPack ? effective.quantity - packQty * us : 0;
                      const packLabel = row.unitLabel || '통';
                      return (
                        <td key={b.id} className="text-center p-0">
                          <button
                            onClick={() => { if (!materialBlocked && !isSynth) handleAdjust(effective); }}
                            disabled={materialBlocked || isSynth}
                            title={
                              isSynth
                                ? '세트상품 가용량 — 구성품 재고 변경으로만 조정 가능'
                                : materialBlocked
                                  ? '원자재·부자재는 본사에서만 입출고·조정 가능'
                                  : isMissing ? '재고 없음 · 클릭하여 입고' : `입출고 · 안전재고 ${effective.safety_stock}`
                            }
                            className={`w-full h-full px-3 py-2 font-semibold transition-colors rounded ${
                              isSynth
                                ? 'text-purple-700 bg-purple-50/40 cursor-not-allowed'
                                : materialBlocked
                                  ? 'text-slate-300 cursor-not-allowed'
                                  : `hover:ring-2 hover:ring-blue-300 hover:ring-inset ${
                                      isMissing
                                        ? 'text-slate-300 hover:bg-blue-50 hover:text-slate-600'
                                        : isLow
                                          ? 'text-red-600 bg-red-50 hover:bg-red-100'
                                          : 'text-slate-800 hover:bg-blue-50'
                                    }`
                            }`}
                          >
                            {isSynth
                              ? <span>가용 {packQty}{packLabel}</span>
                              : (
                                <>
                                  {effective.quantity}
                                  {showPack && effective.quantity > 0 && (
                                    <span className="ml-1 text-[10px] font-normal text-slate-400">
                                      ({packQty}{packLabel}{remainder > 0 ? `+${remainder}` : ''})
                                    </span>
                                  )}
                                </>
                              )}
                            {!isSynth && isLow && !isMissing && !materialBlocked && <span className="ml-1 text-xs font-normal">↓{effective.safety_stock}</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  );
                });
                return [headerRow, ...dataRows, subtotalRow] as React.ReactElement[];
              })}
            </tbody>
          </table>
          <p className="text-xs text-slate-400 mt-3">
            숫자 클릭 → 입출고 처리 · 제품명 클릭 → 변동 이력 · 빨간 숫자 = 안전재고 미달 (↓기준값) · 원자재·부자재는 본사만 입출고 가능
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
              const headerRow = (
                <tr key={`fhdr-${group.categoryId || 'none'}-${gIdx}`} className="bg-slate-50">
                  <td colSpan={8} className="px-3 py-1.5 text-xs font-semibold text-slate-600">
                    {renderCategoryLabel(group.categoryId)}
                    <span className="text-slate-400 ml-2">({group.rows.length}건)</span>
                  </td>
                </tr>
              );
              // 카테고리 소계 — 수량 합계
              const totalQty = group.rows.reduce((s, r) => s + (r.quantity || 0), 0);
              const subtotalRow = (
                <tr key={`fsub-${group.categoryId || 'none'}-${gIdx}`} className="bg-slate-100/70 border-t border-slate-200">
                  <td colSpan={4} className="px-3 py-1.5 text-xs text-slate-500 font-medium">└ 소계</td>
                  <td className="text-xs font-semibold text-slate-700">{totalQty.toLocaleString()}</td>
                  <td colSpan={3}></td>
                </tr>
              );
              const dataRows = group.rows.map((item) => {
                const isLow = item.quantity < item.safety_stock;
                const pt = item.product?.product_type ?? null;
                const materialBlocked = isMaterialType(pt) && !!hqBranchId && item.branch_id !== hqBranchId;
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
                  <td className={isLow ? 'text-red-600 font-semibold' : ''}>
                    {item.quantity}
                  </td>
                  <td>
                    <SafetyStockCell
                      inventoryId={item.id}
                      productId={item.product_id}
                      value={item.safety_stock}
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
                      onClick={() => handleAdjust(item)}
                      disabled={materialBlocked}
                      title={materialBlocked ? '원자재·부자재는 본사에서만 입출고·조정 가능' : undefined}
                      className={`mr-2 ${materialBlocked ? 'text-slate-300 cursor-not-allowed' : 'text-blue-600 hover:underline'}`}
                    >
                      입출고
                    </button>
                    <button
                      onClick={() => { setTransferInventory(item); setShowTransferModal(true); }}
                      className="text-green-600 hover:underline mr-2"
                    >
                      이동
                    </button>
                    <button
                      onClick={() => {
                        if (!item.product) return;
                        setHistoryProduct({ id: item.product.id, name: item.product.name, code: item.product.code });
                        setHistoryInitialBranchId(item.branch_id);
                      }}
                      className="text-purple-600 hover:underline"
                    >
                      이력
                    </button>
                  </td>
                </tr>
                );
              });
              return [headerRow, ...dataRows, subtotalRow] as React.ReactElement[];
            })}
          </tbody>
        </table>
        </div>
      )}

      {showModal && (
        <InventoryModal
          inventory={editInventory}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      )}

      {showTransferModal && transferInventory && (
        <TransferModal
          inventory={transferInventory}
          branches={branches}
          onClose={() => { setShowTransferModal(false); setTransferInventory(null); }}
          onSuccess={() => { setShowTransferModal(false); setTransferInventory(null); fetchInventory(); }}
        />
      )}

      {historyProduct && (
        <MovementHistoryModal
          product={historyProduct}
          // BRANCH 사용자는 자기 지점만 보이도록 제한
          branches={isBranchUser && userBranchId ? branches.filter(b => b.id === userBranchId) : branches}
          initialBranchId={isBranchUser && userBranchId ? userBranchId : historyInitialBranchId}
          onClose={() => { setHistoryProduct(null); setHistoryInitialBranchId(undefined); }}
        />
      )}
    </div>
  );
}

// ── 안전재고 인라인 편집 셀 ────────────────────────────────────────────────

function SafetyStockCell({ inventoryId, productId, value, onSaved }: {
  inventoryId: string;
  productId: string;
  value: number;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const handleSave = async (bulk: boolean) => {
    const num = parseInt(input);
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
        {value}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
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
