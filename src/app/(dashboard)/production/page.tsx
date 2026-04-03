'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getBomList, createBom, deleteBom,
  getProductionOrders, createProductionOrder,
  startProductionOrder, completeProductionOrder, cancelProductionOrder,
  getProductionPreview,
} from '@/lib/production-actions';
import { createClient } from '@/lib/supabase/client';

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
  const [showBomModal, setShowBomModal]           = useState(false);

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
    supabase.from('products').select('id, name, code').eq('is_active', true).order('name').then(({ data }) => {
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">생산 관리</h1>
          <p className="text-sm text-slate-500">BOM 기반 생산 지시 및 재고 처리</p>
        </div>
        <div className="flex items-center gap-3">
          {!isBranchUser && (
            <select
              value={selectedBranch}
              onChange={e => setSelectedBranch(e.target.value)}
              className="input text-sm py-1.5"
            >
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button onClick={() => setShowBomModal(true)} className="btn-secondary text-sm">BOM 관리</button>
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
          <div className="grid grid-cols-3 gap-4">
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
          <div className="card overflow-x-auto">
            <table className="table">
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
                      {order.produced_at ? new Date(order.produced_at).toLocaleDateString('ko-KR') : '-'}
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
        </>
      )}

      {tab === 'bom' && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>완제품</th>
                <th>원재료</th>
                <th>단위</th>
                <th>소요량</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-8">로딩 중...</td></tr>
              ) : bomList.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-slate-400">등록된 BOM이 없습니다</td></tr>
              ) : bomList.map((bom: any) => (
                <tr key={bom.id}>
                  <td>{bom.product?.name} <span className="text-xs text-slate-400">({bom.product?.code})</span></td>
                  <td>{bom.material?.name} <span className="text-xs text-slate-400">({bom.material?.code})</span></td>
                  <td className="text-sm text-slate-500">{bom.material?.unit || '-'}</td>
                  <td>{bom.quantity}</td>
                  <td>
                    <button
                      onClick={async () => {
                        if (!confirm('BOM 항목을 삭제하시겠습니까?')) return;
                        const r = await deleteBom(bom.id);
                        if (r.error) alert(r.error); else loadData();
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNewOrderModal && selectedBranch && (
        <NewOrderModal
          products={products.filter(p => bomByProduct(p.id).length > 0)}
          branchId={selectedBranch}
          branchName={branches.find(b => b.id === selectedBranch)?.name || ''}
          onClose={() => setShowNewOrderModal(false)}
          onSuccess={() => { setShowNewOrderModal(false); loadData(); }}
        />
      )}

      {showBomModal && (
        <BomModal
          products={products}
          bomList={bomList}
          onClose={() => setShowBomModal(false)}
          onSuccess={() => { setShowBomModal(false); loadData(); }}
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-xl">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800">생산 지시 등록</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
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
        <div className="flex gap-2 px-6 py-4 border-t">
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

// ─── BOM 등록 모달 ─────────────────────────────────────────────────────────────

function BomModal({ products, bomList, onClose, onSuccess }: {
  products: any[];
  bomList: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);

  const existingBom = bomList.filter((b: any) => b.product_id === productId);
  const availableMaterials = products.filter(
    p => p.id !== productId && !existingBom.some((b: any) => b.material_id === p.id)
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    const r = await createBom(productId, materialId, quantity);
    setSubmitting(false);
    if (r.error) { alert(r.error); return; }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800">BOM 등록</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">완제품 *</label>
            <select value={productId} onChange={e => { setProductId(e.target.value); setMaterialId(''); }} className="input">
              <option value="">선택하세요</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">원재료 *</label>
            <select value={materialId} onChange={e => setMaterialId(e.target.value)} className="input" disabled={!productId}>
              <option value="">선택하세요</option>
              {availableMaterials.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
            {productId && availableMaterials.length === 0 && (
              <p className="text-xs text-slate-400 mt-1">추가 가능한 원재료가 없습니다.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">소요량 *</label>
            <input
              type="number" min="0.001" step="0.001" value={quantity}
              onChange={e => setQuantity(parseFloat(e.target.value) || 1)}
              className="input"
            />
          </div>
        </div>
        <div className="flex gap-2 px-6 py-4 border-t">
          <button
            onClick={handleSubmit}
            disabled={!productId || !materialId || quantity <= 0 || submitting}
            className="flex-1 btn-primary disabled:opacity-50"
          >
            {submitting ? '등록 중...' : '등록'}
          </button>
          <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
        </div>
      </div>
    </div>
  );
}
