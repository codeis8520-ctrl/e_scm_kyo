'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { bulkDeleteProducts } from '@/lib/actions';
import ProductModal from './ProductModal';
import ProductImportModal from './ProductImportModal';

type ProductType = 'FINISHED' | 'RAW' | 'SUB' | 'SERVICE';

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

interface CategoryInfo {
  id: string;
  name: string;
  parent_id: string | null;
  pathCode: string;
  pathName: string;
  sortKey: string;
  ancestorIds: Set<string>;
  depth: number;
}

function buildCategoryInfo(categories: CategoryRow[]): Map<string, CategoryInfo> {
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

interface Product {
  id: string;
  name: string;
  code: string;
  category_id: string | null;
  product_type: ProductType;
  cost_source?: 'MANUAL' | 'BOM';
  unit: string;
  price: number;
  cost: number | null;
  barcode: string | null;
  is_active: boolean;
  is_taxable: boolean;
  track_inventory: boolean;
  is_phantom?: boolean;
  image_url: string | null;
  category?: { id: string; name: string };
}

const TYPE_BADGE: Record<ProductType, { label: string; cls: string }> = {
  FINISHED: { label: '완제품', cls: 'bg-blue-100 text-blue-700' },
  RAW:      { label: '원자재', cls: 'bg-emerald-100 text-emerald-700' },
  SUB:      { label: '부자재', cls: 'bg-amber-100 text-amber-700' },
  SERVICE:  { label: '무형상품', cls: 'bg-purple-100 text-purple-700' },
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');
  const [typeFilter, setTypeFilter] = useState<'' | ProductType>('');
  const [phantomFilter, setPhantomFilter] = useState<'' | 'exclude' | 'only'>('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 일괄 선택 (체크박스)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('products')
      .select('*, category:categories(*)')
      .order('name');

    if (activeFilter !== '') query = (query as any).eq('is_active', activeFilter === 'true');
    if (typeFilter !== '') query = (query as any).eq('product_type', typeFilter);

    const { data } = await query;
    setProducts(data || []);
    setLoading(false);
  }, [activeFilter, typeFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    const supabase = createClient();
    supabase.from('categories').select('id, name, parent_id, sort_order').order('sort_order')
      .then(res => setCategories((res.data as CategoryRow[]) || []));
  }, []);

  const categoryInfo = useMemo(() => buildCategoryInfo(categories), [categories]);
  const categoryOptions = useMemo(() => {
    return Array.from(categoryInfo.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [categoryInfo]);

  const allowedCategoryIds = useMemo(() => {
    if (!categoryFilter) return null;
    const result = new Set<string>([categoryFilter]);
    for (const info of categoryInfo.values()) {
      if (info.ancestorIds.has(categoryFilter)) result.add(info.id);
    }
    return result;
  }, [categoryFilter, categoryInfo]);

  // 클라이언트 사이드 실시간 검색 + 카테고리 필터 + 트리 순서 정렬
  const filtered = useMemo(() => {
    const arr = products.filter(p => {
      if (allowedCategoryIds && !(p.category_id && allowedCategoryIds.has(p.category_id))) return false;
      // 세트상품(Phantom) 필터
      if (phantomFilter === 'exclude' && p.is_phantom === true) return false;
      if (phantomFilter === 'only' && p.is_phantom !== true) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q)
      );
    });
    arr.sort((a, b) => {
      const aKey = a.category_id ? (categoryInfo.get(a.category_id)?.sortKey || 'zzz') : 'zzz';
      const bKey = b.category_id ? (categoryInfo.get(b.category_id)?.sortKey || 'zzz') : 'zzz';
      const cmp = aKey.localeCompare(bKey);
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name, 'ko');
    });
    return arr;
  }, [products, search, phantomFilter, allowedCategoryIds, categoryInfo]);

  const marginPct = (p: Product) => {
    if (!p.cost || !p.price) return null;
    return Math.round((1 - p.cost / p.price) * 100);
  };

  // 필터 변경 시 선택 상태 정리 — 보이지 않는 제품은 선택 해제
  useEffect(() => {
    setSelectedIds(prev => {
      const visible = new Set(filtered.map(p => p.id));
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const allFilteredIds = useMemo(() => filtered.map(p => p.id), [filtered]);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id));
  const someSelected = !allSelected && allFilteredIds.some(id => selectedIds.has(id));

  const toggleAll = () => {
    setSelectedIds(prev => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      for (const id of allFilteredIds) next.add(id);
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`선택한 제품 ${ids.length}개를 삭제하시겠습니까?\n관련된 BOM·발주·매출이 있는 제품은 자동으로 제외됩니다.`)) return;
    setBulkDeleting(true);
    try {
      const res = await bulkDeleteProducts(ids);
      if ((res as any).error) {
        alert(`실패: ${(res as any).error}`);
        return;
      }
      const failed = res.failed || [];
      let msg = `✓ ${res.deleted}개 삭제 완료`;
      if (failed.length > 0) {
        const nameMap = new Map(products.map(p => [p.id, p.name]));
        const lines = failed.slice(0, 20).map(f => `• ${nameMap.get(f.id) ?? f.id}`);
        msg += `\n\n삭제 실패 ${failed.length}건 (다른 데이터에서 참조 중):\n${lines.join('\n')}`;
        if (failed.length > 20) msg += `\n  … 외 ${failed.length - 20}건`;
      }
      alert(msg);
      setSelectedIds(new Set());
      await fetchProducts();
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div>
          <h3 className="font-semibold text-lg">제품 목록</h3>
          <p className="text-sm text-slate-400 mt-0.5">{filtered.length}개</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="btn-secondary py-2 px-4 text-sm"
            title="엑셀로 제품 일괄 등록"
          >
            📥 엑셀 일괄 등록
          </button>
          <button onClick={() => { setEditProduct(null); setShowModal(true); }} className="btn-primary">
            + 제품 추가
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center mb-4">
        <input
          type="text"
          placeholder="제품명 / 코드 / 바코드 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-full sm:w-64"
        />
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {([['', '전체'], ['true', '활성'], ['false', '비활성']] as [string, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setActiveFilter(v as '' | 'true' | 'false')}
              className={`px-3 py-1.5 font-medium transition-colors ${
                activeFilter === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {([['', '모든 유형'], ['FINISHED', '완제품'], ['RAW', '원자재'], ['SUB', '부자재'], ['SERVICE', '무형상품']] as [string, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTypeFilter(v as '' | ProductType)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                typeFilter === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 세트상품(Phantom) 필터 */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm" title="세트상품(Phantom BOM) 필터">
          {([['', '전체'], ['exclude', '세트 제외'], ['only', '세트만']] as [string, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setPhantomFilter(v as '' | 'exclude' | 'only')}
              className={`px-3 py-1.5 font-medium transition-colors ${
                phantomFilter === v ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 품목 계층 필터 — 자기와 모든 하위 포함 */}
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="input text-sm w-full sm:w-64"
          title="선택한 카테고리 + 모든 하위 카테고리만 표시"
        >
          <option value="">전체 카테고리</option>
          {categoryOptions.map(c => (
            <option key={c.id} value={c.id}>
              {'  '.repeat(c.depth) + `[${c.pathCode}] ${c.name}`}
            </option>
          ))}
        </select>
      </div>

      {/* 선택 액션바 — 1개 이상 선택된 경우만 노출 */}
      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <span className="text-sm text-blue-800">
            <b>{selectedIds.size}</b>개 제품 선택됨
            {selectedIds.size > 0 && filtered.length > 0 && (
              <span className="text-blue-500 ml-2">
                (현재 화면 {filtered.length}개 중)
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-white"
            >
              선택 해제
            </button>
            <button
              onClick={() => {
                if (selectedIds.size !== 1) return;
                const id = Array.from(selectedIds)[0];
                const src = products.find(p => p.id === id);
                if (!src) return;
                // 복사 — id/code/barcode 제거하고 이름 뒤 "(복사)" 접미
                // image_url 은 유지(공유 OK), name 만 충돌 회피용 접미
                const clone: any = {
                  ...src,
                  id: undefined,
                  code: '',
                  barcode: null,
                  name: `${src.name} (복사)`,
                };
                setEditProduct(clone);
                setShowModal(true);
              }}
              disabled={selectedIds.size !== 1}
              title={selectedIds.size === 1 ? '선택한 제품의 모든 정보를 새 제품으로 복사' : '복사는 한 건만 선택해주세요'}
              className="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              📋 제품 복사 {selectedIds.size === 1 ? '' : `(1건만 가능)`}
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {bulkDeleting ? '삭제 중...' : `🗑 선택 ${selectedIds.size}개 삭제`}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="table min-w-[800px]">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  title={allSelected ? '전체 해제' : '현재 화면 전체 선택'}
                />
              </th>
              <th></th>
              <th>제품코드</th>
              <th>제품명</th>
              <th>유형</th>
              <th>바코드</th>
              <th>카테고리</th>
              <th>단위</th>
              <th className="text-right">판매가</th>
              <th className="text-right">원가</th>
              <th className="text-right">마진율</th>
              <th>부가세</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={14} className="text-center text-slate-400 py-8">로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={14} className="text-center text-slate-400 py-8">
                {search ? `"${search}" 검색 결과 없음` : '등록된 제품이 없습니다'}
              </td></tr>
            ) : (() => {
              // 카테고리 트리 구조 시각화 — 처음 등장하는 모든 조상 헤더를 자동 노출
              const out: React.ReactElement[] = [];
              const shown = new Set<string>();
              // 카테고리별 제품 카운트(현재 필터 기준) — 부모는 자손 카운트 합
              const directCount = new Map<string, number>(); // category_id → 직접 자식 제품 수
              for (const p of filtered) {
                if (p.category_id) directCount.set(p.category_id, (directCount.get(p.category_id) || 0) + 1);
              }
              // 부모로 누적 — 자손 합계
              const subtreeCount = new Map<string, number>(directCount);
              for (const [cid, n] of directCount) {
                const info = categoryInfo.get(cid);
                if (!info) continue;
                for (const aid of info.ancestorIds) {
                  if (aid !== cid) subtreeCount.set(aid, (subtreeCount.get(aid) || 0) + n);
                }
              }

              const emitCategoryHeader = (cid: string) => {
                const info = categoryInfo.get(cid);
                if (!info) return;
                const total = subtreeCount.get(cid) || 0;
                out.push(
                  <tr key={`hdr-${cid}`} className="bg-slate-50">
                    <td colSpan={14} className="px-3 py-1.5 text-xs font-semibold text-slate-700"
                        style={{ paddingLeft: `${12 + info.depth * 18}px` }}>
                      <span className="font-mono text-slate-400 mr-1.5">[{info.pathCode}]</span>
                      {info.name}
                      <span className="text-slate-400 font-normal ml-2">({total}개)</span>
                    </td>
                  </tr>
                );
              };

              for (const product of filtered) {
                const cid = product.category_id;
                if (cid) {
                  const info = categoryInfo.get(cid);
                  if (info) {
                    // 자기 + 모든 조상을 트리 위에서 아래로 정렬해 emit
                    const chain: string[] = [];
                    let cur: typeof info | undefined = info;
                    while (cur) {
                      chain.unshift(cur.id);
                      cur = cur.parent_id ? categoryInfo.get(cur.parent_id) : undefined;
                    }
                    for (const aid of chain) {
                      if (!shown.has(aid)) {
                        shown.add(aid);
                        emitCategoryHeader(aid);
                      }
                    }
                  }
                } else {
                  if (!shown.has('__unassigned__')) {
                    shown.add('__unassigned__');
                    out.push(
                      <tr key="hdr-unassigned" className="bg-slate-50">
                        <td colSpan={14} className="px-3 py-1.5 text-xs font-semibold text-slate-400">
                          미분류
                        </td>
                      </tr>
                    );
                  }
                }

                const m = marginPct(product);
                const indent = cid ? (categoryInfo.get(cid)?.depth ?? 0) + 1 : 1;
                out.push(
                  <tr key={product.id} className={`${!product.is_active ? 'opacity-50' : ''} ${selectedIds.has(product.id) ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={selectedIds.has(product.id)}
                      onChange={() => toggleOne(product.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={{ paddingLeft: `${12 + indent * 18}px` }}>
                    {product.image_url
                      ? <img
                          src={product.image_url}
                          alt=""
                          className="w-8 h-8 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setPreviewUrl(product.image_url)}
                        />
                      : <div className="w-8 h-8 bg-slate-100 rounded" />}
                  </td>
                  <td className="font-mono text-xs text-slate-500">{product.code}</td>
                  <td>
                    <button
                      onClick={() => handleEdit(product)}
                      className="font-medium text-left text-blue-700 hover:underline hover:text-blue-800"
                    >
                      {product.name}
                    </button>
                  </td>
                  <td>
                    {(() => {
                      const meta = TYPE_BADGE[product.product_type as ProductType] || TYPE_BADGE.FINISHED;
                      return (
                        <div className="flex items-center gap-1">
                          <span className={`badge ${meta.cls}`}>{meta.label}</span>
                          {product.is_phantom && (
                            <span className="badge bg-purple-100 text-purple-700" title="Phantom BOM — 판매 시 본인 재고는 차감 안 하고 BOM 구성품 분해 차감">
                              🧩 세트
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="font-mono text-xs text-slate-400">{product.barcode || '-'}</td>
                  <td className="text-sm text-slate-500">{product.category?.name || '-'}</td>
                  <td className="text-sm text-slate-500">{product.unit}</td>
                  <td className="text-right font-medium">
                    {product.product_type === 'FINISHED'
                      ? `${product.price.toLocaleString()}원`
                      : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="text-right text-slate-500">
                    {product.cost != null ? (
                      <div className="inline-flex items-center gap-1">
                        <span>{product.cost.toLocaleString()}원</span>
                        {product.product_type === 'FINISHED' && product.cost_source === 'BOM' && (
                          <span className="text-[10px] px-1 rounded bg-blue-100 text-blue-700" title="BOM 자동 산정">자동</span>
                        )}
                      </div>
                    ) : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="text-right">
                    {m !== null ? (
                      <span className={`text-sm font-medium ${m >= 30 ? 'text-green-600' : m >= 10 ? 'text-amber-600' : 'text-red-500'}`}>
                        {m}%
                      </span>
                    ) : <span className="text-slate-300">-</span>}
                  </td>
                  <td>
                    <span className={product.is_taxable !== false
                      ? 'badge bg-blue-100 text-blue-700'
                      : 'badge bg-slate-100 text-slate-600'}>
                      {product.is_taxable !== false ? '과세' : '면세'}
                    </span>
                  </td>
                  <td>
                    <span className={product.is_active ? 'badge badge-success' : 'badge badge-error'}>
                      {product.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => handleEdit(product)} className="text-blue-600 hover:underline text-sm">
                      수정
                    </button>
                  </td>
                </tr>
                );
              }
              return out;
            })()}
          </tbody>
        </table>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="제품 이미지"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-slate-300"
            onClick={() => setPreviewUrl(null)}
          >
            ×
          </button>
        </div>
      )}

      {showModal && (
        <ProductModal
          product={editProduct}
          onClose={() => { setShowModal(false); setEditProduct(null); }}
          onSuccess={() => { setShowModal(false); setEditProduct(null); fetchProducts(); }}
        />
      )}

      {showImportModal && (
        <ProductImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => fetchProducts()}
        />
      )}
    </div>
  );

  function handleEdit(product: Product) {
    setEditProduct(product);
    setShowModal(true);
  }
}
