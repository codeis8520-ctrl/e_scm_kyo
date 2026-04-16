'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getBomList, saveBom,
  getProductionOrders, createProductionOrder,
  startProductionOrder, completeProductionOrder, cancelProductionOrder,
  getProductionPreview,
} from '@/lib/production-actions';
import { createClient } from '@/lib/supabase/client';

type ProductType = 'FINISHED' | 'RAW' | 'SUB';
const TYPE_BADGE: Record<ProductType, { label: string; cls: string }> = {
  FINISHED: { label: '완제품', cls: 'bg-blue-100 text-blue-700' },
  RAW:      { label: '원자재', cls: 'bg-emerald-100 text-emerald-700' },
  SUB:      { label: '부자재', cls: 'bg-amber-100 text-amber-700' },
};

interface Material {
  id: string;
  name: string;
  code: string;
  unit?: string;
  cost?: number | null;
  product_type: ProductType;
}

interface BomLine {
  id?: string;        // 기존 행이면 존재
  material_id: string;
  quantity: number;
  loss_rate: number;
  notes: string;
  sort_order: number;
  material?: Material;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const map = document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>);
  return map[name] || null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: '대기',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
};

export default function ProductionPage() {
  const [branches, setBranches]   = useState<any[]>([]);
  const [products, setProducts]   = useState<any[]>([]);
  const [bomList, setBomList]     = useState<any[]>([]);
  const [orders, setOrders]       = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [filterStatus, setFilterStatus]     = useState<string>('');
  const [userRole]  = useState<string | null>(() => getCookie('user_role'));
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  const [tab, setTab] = useState<'orders' | 'bom'>('orders');
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [selectedFinishedId, setSelectedFinishedId] = useState<string>('');

  // ── 초기 데이터 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    supabase.from('branches').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      const rows = (data || []) as { id: string; name: string }[];
      setBranches(rows);
      const cookieBranch = getCookie('user_branch_id');
      if (isBranchUser && cookieBranch) {
        setSelectedBranch(cookieBranch);
      } else if (rows.length > 0) {
        setSelectedBranch(rows[0].id);
      }
    });
    supabase.from('products').select('id, name, code, unit, cost, product_type').eq('is_active', true).order('name').then(({ data }) => {
      setProducts(data || []);
    });
  }, [isBranchUser]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [bomRes, orderRes] = await Promise.all([
      getBomList(),
      getProductionOrders({
        branchId: selectedBranch || undefined,
        status: filterStatus || undefined,
      }),
    ]);
    setBomList(bomRes.data || []);
    setOrders(orderRes.data || []);
    setLoading(false);
  }, [selectedBranch, filterStatus]);

  useEffect(() => {
    if (selectedBranch) loadData();
  }, [loadData, selectedBranch]);

  // ── 상태 전환 액션 ───────────────────────────────────────────────────────────
  const handleStart = async (id: string) => {
    const r = await startProductionOrder(id);
    if (r.error) alert(r.error); else loadData();
  };

  const handleComplete = async (id: string) => {
    if (!confirm('생산 완료 처리하시겠습니까? 원재료 재고가 차감됩니다.')) return;
    const r = await completeProductionOrder(id);
    if (r.error) alert(r.error); else loadData();
  };

  const handleCancel = async (id: string) => {
    if (!confirm('생산을 취소하시겠습니까?')) return;
    const r = await cancelProductionOrder(id);
    if (r.error) alert(r.error); else loadData();
  };

  const bomByProduct = (productId: string) => bomList.filter((b: any) => b.product_id === productId);

  // ── 집계 ─────────────────────────────────────────────────────────────────────
  const stats = {
    pending:    orders.filter(o => o.status === 'PENDING').length,
    inProgress: orders.filter(o => o.status === 'IN_PROGRESS').length,
    completed:  orders.filter(o => o.status === 'COMPLETED').length,
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">생산 관리</h1>
          <p className="text-sm text-slate-500">BOM 기반 생산 지시 및 재고 처리</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!isBranchUser && (
            <select
              value={selectedBranch}
              onChange={e => setSelectedBranch(e.target.value)}
              className="input text-sm py-1.5"
            >
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button onClick={() => setTab('bom')} className="btn-secondary text-sm">BOM 조립</button>
          <button onClick={() => setShowNewOrderModal(true)} className="btn-primary text-sm">+ 생산 지시</button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['orders', 'bom'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'orders' ? '생산 지시 목록' : 'BOM 목록'}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <>
          {/* 통계 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="stat-card">
              <p className="text-sm text-slate-500">대기</p>
              <p className="text-2xl font-bold text-slate-700">{stats.pending}</p>
              <p className="text-xs text-slate-400">건</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-slate-500">진행중</p>
              <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
              <p className="text-xs text-slate-400">건</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-slate-500">완료 (이력)</p>
              <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
              <p className="text-xs text-slate-400">건</p>
            </div>
          </div>

          {/* 필터 */}
          <div className="flex gap-2 flex-wrap">
            {['', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s === '' ? '전체' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {/* 목록 */}
          <div className="card">
            <div className="overflow-x-auto">
            <table className="table min-w-[650px]">
              <thead>
                <tr>
                  <th>지시번호</th>
                  <th>제품</th>
                  <th>지점</th>
                  <th>수량</th>
                  <th>상태</th>
                  <th>생성일</th>
                  <th>완료일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8">로딩 중...</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">생산 지시 내역이 없습니다</td></tr>
                ) : orders.map((order: any) => (
                  <tr key={order.id}>
                    <td className="font-mono text-sm">{order.order_number}</td>
                    <td>{order.product?.name}</td>
                    <td className="text-sm text-slate-500">{order.branch?.name || '-'}</td>
                    <td>{order.quantity.toLocaleString()}</td>
                    <td>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[order.status] || ''}`}>
                        {STATUS_LABEL[order.status] || order.status}
                      </span>
                    </td>
                    <td className="text-sm text-slate-500">{new Date(order.created_at).toLocaleDateString('ko-KR')}</td>
                    <td className="text-sm text-slate-500">
                      {order.completed_at ? new Date(order.completed_at).toLocaleDateString('ko-KR') : '-'}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {order.status === 'PENDING' && (
                          <>
                            <button onClick={() => handleStart(order.id)} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100">착수</button>
                            <button onClick={() => handleCancel(order.id)} className="text-xs px-2 py-1 bg-slate-50 text-slate-600 rounded hover:bg-slate-100">취소</button>
                          </>
                        )}
                        {order.status === 'IN_PROGRESS' && (
                          <>
                            <button onClick={() => handleComplete(order.id)} className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100">완료</button>
                            <button onClick={() => handleCancel(order.id)} className="text-xs px-2 py-1 bg-slate-50 text-slate-600 rounded hover:bg-slate-100">취소</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {tab === 'bom' && (
        <BomComposerLayout
          products={products}
          bomList={bomList}
          selectedFinishedId={selectedFinishedId}
          onSelectFinished={setSelectedFinishedId}
          onSaved={loadData}
        />
      )}

      {showNewOrderModal && selectedBranch && (
        <NewOrderModal
          products={products.filter(p => p.product_type === 'FINISHED' && bomByProduct(p.id).length > 0)}
          branchId={selectedBranch}
          branchName={branches.find(b => b.id === selectedBranch)?.name || ''}
          onClose={() => setShowNewOrderModal(false)}
          onSuccess={() => { setShowNewOrderModal(false); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── 생산 지시 모달 ────────────────────────────────────────────────────────────

function NewOrderModal({ products, branchId, branchName, onClose, onSuccess }: {
  products: any[];
  branchId: string;
  branchName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity]   = useState(1);
  const [memo, setMemo]           = useState('');
  const [preview, setPreview]     = useState<any[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!productId || quantity < 1) { setPreview([]); return; }
    setLoadingPreview(true);
    getProductionPreview(productId, branchId, quantity).then(r => {
      setPreview(r.data);
      setLoadingPreview(false);
    });
  }, [productId, quantity, branchId]);

  const canSubmit = preview.length > 0 && preview.every(p => p.shortage === 0);
  const totalCost = preview.reduce((s, p) => s + p.cost * p.required, 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    const fd = new FormData();
    fd.set('product_id', productId);
    fd.set('branch_id', branchId);
    fd.set('quantity', String(quantity));
    fd.set('memo', memo);
    const r = await createProductionOrder(fd);
    setSubmitting(false);
    if (r.error) { alert(r.error); return; }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl shadow-xl">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800">생산 지시 등록</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="bg-slate-50 px-3 py-2 rounded text-sm text-slate-600">
            지점: <strong>{branchName}</strong>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">완제품 *</label>
            <select value={productId} onChange={e => setProductId(e.target.value)} className="input">
              <option value="">BOM이 등록된 제품 선택</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">생산 수량 *</label>
            <input
              type="number" min="1" value={quantity}
              onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              onFocus={e => e.target.select()}
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">메모</label>
            <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="생산 메모..." className="input" />
          </div>

          {/* 재료 소요량 미리보기 */}
          {loadingPreview && <p className="text-sm text-slate-400">소요량 계산 중...</p>}
          {preview.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">원재료 소요량</p>
              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium">재료</th>
                      <th className="text-right px-3 py-2 text-xs text-slate-500 font-medium">필요</th>
                      <th className="text-right px-3 py-2 text-xs text-slate-500 font-medium">현재고</th>
                      <th className="text-right px-3 py-2 text-xs text-slate-500 font-medium">부족</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p, i) => (
                      <tr key={i} className={p.shortage > 0 ? 'bg-red-50' : ''}>
                        <td className="px-3 py-1.5">{p.material_name}</td>
                        <td className="px-3 py-1.5 text-right">{p.required} {p.unit}</td>
                        <td className="px-3 py-1.5 text-right">{p.available} {p.unit}</td>
                        <td className={`px-3 py-1.5 text-right font-medium ${p.shortage > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {p.shortage > 0 ? `-${p.shortage}` : '✓'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalCost > 0 && (
                <p className="text-xs text-slate-500 mt-1.5 text-right">
                  예상 원가: {totalCost.toLocaleString()}원
                </p>
              )}
              {!canSubmit && (
                <p className="text-xs text-red-600 mt-1.5">재고가 부족한 원재료가 있습니다.</p>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-4 sm:px-6 py-4 border-t">
          <button
            onClick={handleSubmit}
            disabled={!productId || quantity < 1 || !canSubmit || submitting}
            className="flex-1 btn-primary disabled:opacity-50"
          >
            {submitting ? '처리 중...' : '생산 지시 등록'}
          </button>
          <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
        </div>
      </div>
    </div>
  );
}

// ─── BOM 조립 레이아웃 (좌: 완제품, 우: Composer) ────────────────────────────

function BomComposerLayout({
  products, bomList, selectedFinishedId, onSelectFinished, onSaved,
}: {
  products: any[];
  bomList: any[];
  selectedFinishedId: string;
  onSelectFinished: (id: string) => void;
  onSaved: () => void;
}) {
  const [productSearch, setProductSearch] = useState('');

  const finishedProducts: Material[] = useMemo(
    () => products.filter(p => p.product_type === 'FINISHED' || p.product_type == null),
    [products],
  );
  const materialCandidates: Material[] = useMemo(
    () => products.filter(p => p.product_type === 'RAW' || p.product_type === 'SUB'),
    [products],
  );

  const bomCountByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of bomList) map[b.product_id] = (map[b.product_id] || 0) + 1;
    return map;
  }, [bomList]);

  const filteredFinished = productSearch
    ? finishedProducts.filter(p =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        (p.code || '').toLowerCase().includes(productSearch.toLowerCase()))
    : finishedProducts;

  const selectedProduct = finishedProducts.find(p => p.id === selectedFinishedId) || null;
  const selectedBomLines: BomLine[] = useMemo(() => {
    return bomList
      .filter((b: any) => b.product_id === selectedFinishedId)
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((b: any, i: number) => ({
        id: b.id,
        material_id: b.material_id,
        quantity: Number(b.quantity),
        loss_rate: Number(b.loss_rate || 0),
        notes: b.notes || '',
        sort_order: b.sort_order ?? i,
        material: b.material,
      }));
  }, [bomList, selectedFinishedId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 좌: 완제품 목록 */}
      <div className="card lg:col-span-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-700">완제품</h3>
          <span className="text-xs text-slate-400">{filteredFinished.length}개</span>
        </div>
        <input
          type="text"
          value={productSearch}
          onChange={e => setProductSearch(e.target.value)}
          placeholder="완제품명 검색..."
          className="input text-sm mb-3"
        />
        <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100 rounded border border-slate-100">
          {filteredFinished.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-8">완제품이 없습니다</div>
          ) : filteredFinished.map(p => {
            const count = bomCountByProduct[p.id] || 0;
            const selected = p.id === selectedFinishedId;
            return (
              <button
                key={p.id}
                onClick={() => onSelectFinished(p.id)}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  selected ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium text-sm truncate ${selected ? 'text-blue-700' : 'text-slate-700'}`}>{p.name}</span>
                  {count > 0 ? (
                    <span className="text-xs text-blue-600 bg-blue-100 rounded-full px-2">{count}</span>
                  ) : (
                    <span className="text-xs text-slate-300">미구성</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{p.code}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 우: 조립 Composer */}
      <div className="lg:col-span-2">
        {!selectedProduct ? (
          <div className="card text-center text-slate-400 py-16">
            <p className="text-sm">좌측에서 완제품을 선택하면 BOM을 조립할 수 있습니다.</p>
            <p className="text-xs mt-2">원자재·부자재를 추가하고 수량·손실률을 입력하세요.</p>
          </div>
        ) : (
          <BomComposer
            key={selectedProduct.id}
            product={selectedProduct}
            initialLines={selectedBomLines}
            candidates={materialCandidates}
            onSaved={onSaved}
          />
        )}
      </div>
    </div>
  );
}

function BomComposer({
  product, initialLines, candidates, onSaved,
}: {
  product: Material;
  initialLines: BomLine[];
  candidates: Material[];
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<BomLine[]>(initialLines);
  const [matSearch, setMatSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLines(initialLines);
    setDirty(false);
  }, [initialLines]);

  const usedIds = new Set(lines.map(l => l.material_id));
  const filteredCandidates = (matSearch
    ? candidates.filter(c =>
        c.name.toLowerCase().includes(matSearch.toLowerCase()) ||
        (c.code || '').toLowerCase().includes(matSearch.toLowerCase()))
    : candidates
  ).filter(c => !usedIds.has(c.id)).slice(0, 20);

  const addLine = (mat: Material) => {
    setLines(prev => {
      const next = [...prev, {
        material_id: mat.id,
        quantity: 1,
        loss_rate: 0,
        notes: '',
        sort_order: prev.length,
        material: mat,
      }];
      return next;
    });
    setMatSearch('');
    setDirty(true);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, sort_order: i })));
    setDirty(true);
  };

  const updateLine = (idx: number, patch: Partial<BomLine>) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
    setDirty(true);
  };

  const moveLine = (idx: number, dir: -1 | 1) => {
    setLines(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((l, i) => ({ ...l, sort_order: i }));
    });
    setDirty(true);
  };

  const totalCost = lines.reduce((sum, l) => {
    const cost = Number(l.material?.cost || 0);
    const qty = l.quantity * (1 + l.loss_rate / 100);
    return sum + cost * qty;
  }, 0);

  const hasInvalid = lines.some(l => !l.material_id || l.quantity <= 0);

  const handleSave = async () => {
    if (hasInvalid) { alert('수량은 0보다 커야 합니다.'); return; }
    setSaving(true);
    const r = await saveBom(product.id, lines.map((l, i) => ({
      id: l.id,
      material_id: l.material_id,
      quantity: l.quantity,
      loss_rate: l.loss_rate,
      notes: l.notes || null,
      sort_order: i,
    })));
    setSaving(false);
    if (r.error) { alert(r.error); return; }
    setDirty(false);
    onSaved();
  };

  const handleReset = () => {
    if (dirty && !confirm('변경사항이 저장되지 않았습니다. 되돌릴까요?')) return;
    setLines(initialLines);
    setDirty(false);
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
        <div>
          <p className="text-xs text-slate-400 font-mono">{product.code}</p>
          <h3 className="font-bold text-slate-800 text-lg">{product.name}</h3>
          <p className="text-xs text-slate-500 mt-1">자재 {lines.length}종 · 예상 원가 <span className="font-medium text-slate-700">{Math.round(totalCost).toLocaleString()}원</span> / 완제품 1단위</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            disabled={!dirty || saving}
            className="px-3 py-1.5 text-sm rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            되돌리기
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving || hasInvalid}
            className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {saving ? '저장 중...' : dirty ? '저장' : '저장됨'}
          </button>
        </div>
      </div>

      {/* 자재 추가 검색 */}
      <div className="mb-4">
        <div className="relative">
          <input
            type="text"
            value={matSearch}
            onChange={e => setMatSearch(e.target.value)}
            placeholder="원자재·부자재 검색 후 클릭해 추가..."
            className="input text-sm"
          />
        </div>
        {matSearch && (
          <div className="mt-1 border border-slate-200 rounded-md max-h-48 overflow-y-auto bg-white">
            {filteredCandidates.length === 0 ? (
              <div className="text-center text-slate-400 text-xs py-3">결과 없음</div>
            ) : filteredCandidates.map(c => {
              const meta = TYPE_BADGE[c.product_type] || TYPE_BADGE.RAW;
              return (
                <button
                  key={c.id}
                  onClick={() => addLine(c)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`badge text-[10px] ${meta.cls}`}>{meta.label}</span>
                      <span className="text-sm font-medium text-slate-700 truncate">{c.name}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono">{c.code} · 단가 {Number(c.cost || 0).toLocaleString()}원</p>
                  </div>
                  <span className="text-blue-600 text-sm font-medium">+ 추가</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* BOM 행 목록 */}
      {lines.length === 0 ? (
        <div className="text-center py-10 text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
          <p className="text-sm">위 검색창에서 자재를 추가하세요.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="text-left font-medium py-2 w-10">#</th>
                <th className="text-left font-medium py-2">자재</th>
                <th className="text-right font-medium py-2 w-28">수량 *</th>
                <th className="text-right font-medium py-2 w-24">손실률(%)</th>
                <th className="text-left font-medium py-2 min-w-[160px]">메모</th>
                <th className="text-right font-medium py-2 w-24">실소요</th>
                <th className="w-28"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const mat = line.material;
                const typeMeta = mat ? (TYPE_BADGE[mat.product_type] || TYPE_BADGE.RAW) : null;
                const actual = line.quantity * (1 + line.loss_rate / 100);
                return (
                  <tr key={(line.id || 'new') + '-' + idx} className="border-b border-slate-100">
                    <td className="py-2">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveLine(idx, -1)} disabled={idx === 0} className="text-slate-300 hover:text-slate-600 text-xs leading-none disabled:opacity-30">▲</button>
                        <button onClick={() => moveLine(idx, 1)} disabled={idx === lines.length - 1} className="text-slate-300 hover:text-slate-600 text-xs leading-none disabled:opacity-30">▼</button>
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {typeMeta && <span className={`badge text-[10px] ${typeMeta.cls}`}>{typeMeta.label}</span>}
                        <div className="min-w-0">
                          <p className="font-medium text-slate-700 truncate">{mat?.name || '?'}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{mat?.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={line.quantity}
                          onChange={e => updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })}
                          onFocus={e => e.target.select()}
                          className="input text-right py-1 w-20"
                        />
                        <span className="text-xs text-slate-400 w-8">{mat?.unit || '개'}</span>
                      </div>
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={line.loss_rate}
                        onChange={e => updateLine(idx, { loss_rate: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                        onFocus={e => e.target.select()}
                        className="input text-right py-1 w-20"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        value={line.notes}
                        onChange={e => updateLine(idx, { notes: e.target.value })}
                        placeholder="비고 (선택)"
                        className="input py-1 text-sm"
                      />
                    </td>
                    <td className="py-2 text-right text-xs text-slate-600">
                      <span className={line.loss_rate > 0 ? 'text-amber-600 font-medium' : ''}>
                        {actual.toFixed(3).replace(/\.?0+$/, '')}
                      </span>
                      <span className="text-slate-400 ml-0.5">{mat?.unit || ''}</span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => removeLine(idx)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        제거
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dirty && (
        <p className="mt-3 text-xs text-amber-600">저장되지 않은 변경사항이 있습니다.</p>
      )}
    </div>
  );
}
