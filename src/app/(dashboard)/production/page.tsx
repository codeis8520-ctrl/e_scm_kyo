'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getBomList, saveBom, getBomByProduct,
  getProductionOrders, createProductionOrder,
  startProductionOrder, completeProductionOrder, cancelProductionOrder,
  getProductionPreview,
} from '@/lib/production-actions';
import {
  listFactories, createFactory, updateFactory,
  deactivateFactory, activateFactory, deleteFactory,
  type OemFactoryInput,
} from '@/lib/oem-actions';
import { createClient } from '@/lib/supabase/client';

type ProductType = 'FINISHED' | 'RAW' | 'SUB';
const TYPE_BADGE: Record<ProductType, { label: string; cls: string }> = {
  FINISHED: { label: '완제품', cls: 'bg-blue-100 text-blue-700' },
  RAW:      { label: '원자재', cls: 'bg-emerald-100 text-emerald-700' },
  SUB:      { label: '부자재', cls: 'bg-amber-100 text-amber-700' },
};

// products.unit 값이 비어있거나 "1" 같은 숫자 문자열이면 '개'로 치환.
// (예전 레거시 데이터에 숫자 단위가 섞여 있어 "2{unit}"을 "21"로 오인하는 문제 방지)
function safeUnit(raw: any, fallback: string = '개'): string {
  const s = String(raw ?? '').trim();
  return s && !/^\d+$/.test(s) ? s : fallback;
}

interface Category { id: string; name: string; }

interface Material {
  id: string;
  name: string;
  code: string;
  unit?: string;
  cost?: number | null;
  product_type: ProductType;
  category_id?: string | null;
  category?: { id: string; name: string } | null;
  image_url?: string | null;
}

// ── 한글 초성 검색 ────────────────────────────────────────────────────────────
//   "홍삼" → "ㅎㅅ"  /  "ㅎㅅ" 입력 시 "홍삼/흑삼" 매칭
const HANGUL_INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function getInitial(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const idx = Math.floor((code - 0xac00) / 588);
    return HANGUL_INITIALS[idx] || ch;
  }
  return ch;
}
function extractInitials(s: string): string {
  let out = '';
  for (const ch of s) out += getInitial(ch);
  return out;
}
function isAllInitials(s: string): boolean {
  if (!s) return false;
  for (const ch of s) {
    if (!HANGUL_INITIALS.includes(ch)) return false;
  }
  return true;
}
// 초성 OR 부분문자열 매칭 (대소문자 무시)
function materialMatch(mat: Material, queryRaw: string): boolean {
  const q = queryRaw.trim();
  if (!q) return true;
  const name = mat.name || '';
  const code = (mat.code || '').toLowerCase();
  const ql = q.toLowerCase();
  if (name.toLowerCase().includes(ql) || code.includes(ql)) return true;
  // 초성 검색
  if (isAllInitials(q)) {
    const initials = extractInitials(name);
    if (initials.includes(q)) return true;
  }
  return false;
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
  const [categories, setCategories] = useState<Category[]>([]);
  const [bomList, setBomList]     = useState<any[]>([]);
  const [orders, setOrders]       = useState<any[]>([]);
  const [factories, setFactories] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [filterStatus, setFilterStatus]     = useState<string>('');
  const [userRole]  = useState<string | null>(() => getCookie('user_role'));
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';
  const canIssueOrder = userRole === 'SUPER_ADMIN' || userRole === 'HQ_OPERATOR';

  const [tab, setTab] = useState<'orders' | 'bom' | 'factories'>('orders');
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [selectedFinishedId, setSelectedFinishedId] = useState<string>('');
  const hqBranch = branches.find((b: any) => b.is_headquarters) || null;

  // 페이지네이션
  const PAGE_SIZE = 30;
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState({ pending: 0, inProgress: 0, completed: 0 });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // 상태 전환 중인 row id — 버튼 중복 클릭 방지
  const [processingId, setProcessingId] = useState<string | null>(null);

  // ── 초기 데이터 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // is_headquarters 포함 조회, 없는 DB(마이그 047 미적용) 폴백
      let res: any = await supabase
        .from('branches')
        .select('id, name, is_headquarters')
        .eq('is_active', true)
        .order('name');
      if (res.error) {
        res = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
      }
      const rows = (res.data || []) as any[];
      setBranches(rows);
      const cookieBranch = getCookie('user_branch_id');
      if (isBranchUser && cookieBranch) {
        setSelectedBranch(cookieBranch);
      } else {
        // HQ/SUPER_ADMIN/EXECUTIVE: 기본값 = 전체 지점
        // (본사 필터 고정 시 타 지점 입고 생산 지시가 목록에서 누락되는 문제 방지)
        setSelectedBranch('');
      }
    })();
    (async () => {
      // 마이그레이션 042가 미적용이면 product_type 컬럼이 없어 실패 → 폴백
      let res: any = await supabase
        .from('products')
        .select('id, name, code, unit, cost, image_url, product_type, category_id, category:categories(id, name)')
        .eq('is_active', true)
        .order('name');
      if (res.error) {
        console.warn('[production] products query fallback (migration 042?):', res.error.message);
        res = await supabase
          .from('products')
          .select('id, name, code, unit, cost, image_url, category_id, category:categories(id, name)')
          .eq('is_active', true)
          .order('name');
      }
      setProducts((res.data as any) || []);
    })();
    supabase.from('categories').select('id, name').order('name').then(({ data }) => {
      setCategories((data as any) || []);
    });
  }, [isBranchUser]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [bomRes, orderRes, factRes] = await Promise.all([
      getBomList(),
      getProductionOrders({
        branchId: selectedBranch || undefined,
        status: filterStatus || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
      listFactories({ includeInactive: true }),
    ]);
    if ((bomRes as any).error) console.error('[ProductionPage] getBomList error:', (bomRes as any).error);
    setBomList(bomRes.data || []);
    setOrders(orderRes.data || []);
    setTotalCount((orderRes as any).count ?? 0);
    setStats((orderRes as any).stats ?? { pending: 0, inProgress: 0, completed: 0 });
    setFactories(factRes.data || []);
    setLoading(false);
  }, [selectedBranch, filterStatus, page]);

  useEffect(() => {
    // branches 로드가 끝난 뒤부터 호출 (selectedBranch=''는 '전체' 의미이므로 guard 제외)
    if (branches.length > 0) loadData();
  }, [loadData, branches.length]);

  // 필터 변경 시 1페이지로 리셋
  useEffect(() => { setPage(1); }, [selectedBranch, filterStatus]);

  // ── 상태 전환 액션 ───────────────────────────────────────────────────────────
  //   processingId로 in-flight 관리 — 같은 row의 버튼 중복 클릭을 UI에서 차단.
  const runWithGuard = async (id: string, fn: () => Promise<any>) => {
    if (processingId) return; // 이미 다른 작업 진행 중
    setProcessingId(id);
    try {
      const r = await fn();
      if (r?.error) alert(r.error);
      else await loadData();
    } finally {
      setProcessingId(null);
    }
  };

  const handleStart = (id: string) => runWithGuard(id, () => startProductionOrder(id));
  const handleComplete = (id: string) => {
    if (!confirm('생산 완료 처리하시겠습니까? 완제품이 입고 지점 재고로 반영됩니다.')) return;
    runWithGuard(id, () => completeProductionOrder(id));
  };
  const handleCancel = (id: string) => {
    if (!confirm('생산을 취소하시겠습니까?')) return;
    runWithGuard(id, () => cancelProductionOrder(id));
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
              title="입고 지점 필터"
            >
              <option value="">전체 지점</option>
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.is_headquarters ? ' (본사)' : ''}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => setTab('bom')} className="btn-secondary text-sm">BOM 조립</button>
          {canIssueOrder && (
            <button onClick={() => setShowNewOrderModal(true)} className="btn-primary text-sm">+ 생산 지시</button>
          )}
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['orders', 'bom', 'factories'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'orders' ? '생산 지시 목록' : t === 'bom' ? 'BOM 목록' : 'OEM 공장'}
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
            <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
              <span>총 <b className="text-slate-700">{totalCount.toLocaleString()}</b>건</span>
              {totalCount > 0 && (
                <span>페이지 {page} / {totalPages}</span>
              )}
            </div>
            <div className="overflow-x-auto">
            <table className="table min-w-[780px]">
              <thead>
                <tr>
                  <th>지시번호</th>
                  <th>제품</th>
                  <th>OEM 공장</th>
                  <th>입고 지점</th>
                  <th>수량</th>
                  <th>상태</th>
                  <th>생성일</th>
                  <th>완료일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center py-8">로딩 중...</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">생산 지시 내역이 없습니다</td></tr>
                ) : orders.map((order: any) => (
                  <tr key={order.id}>
                    <td className="font-mono text-sm">{order.order_number}</td>
                    <td>{order.product?.name}</td>
                    <td className="text-sm text-slate-600">{order.factory?.name || <span className="text-slate-300">-</span>}</td>
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
                      {(() => {
                        const isRowBusy = processingId === order.id;
                        const otherBusy = !!processingId && !isRowBusy;
                        const disabledCls = 'opacity-50 cursor-not-allowed';
                        return (
                          <div className="flex gap-1">
                            {order.status === 'PENDING' && (
                              <>
                                <button
                                  onClick={() => handleStart(order.id)}
                                  disabled={isRowBusy || otherBusy}
                                  className={`text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 ${(isRowBusy || otherBusy) ? disabledCls : ''}`}
                                >
                                  {isRowBusy ? '처리중…' : '착수'}
                                </button>
                                <button
                                  onClick={() => handleCancel(order.id)}
                                  disabled={isRowBusy || otherBusy}
                                  className={`text-xs px-2 py-1 bg-slate-50 text-slate-600 rounded hover:bg-slate-100 ${(isRowBusy || otherBusy) ? disabledCls : ''}`}
                                >
                                  취소
                                </button>
                              </>
                            )}
                            {order.status === 'IN_PROGRESS' && (
                              <>
                                <button
                                  onClick={() => handleComplete(order.id)}
                                  disabled={isRowBusy || otherBusy}
                                  className={`text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100 ${(isRowBusy || otherBusy) ? disabledCls : ''}`}
                                >
                                  {isRowBusy ? '처리중…' : '완료'}
                                </button>
                                <button
                                  onClick={() => handleCancel(order.id)}
                                  disabled={isRowBusy || otherBusy}
                                  className={`text-xs px-2 py-1 bg-slate-50 text-slate-600 rounded hover:bg-slate-100 ${(isRowBusy || otherBusy) ? disabledCls : ''}`}
                                >
                                  취소
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-slate-100 text-sm">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  이전
                </button>
                <span className="text-slate-500 text-xs tabular-nums">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  다음
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'bom' && (
        <BomComposerLayout
          products={products}
          categories={categories}
          bomList={bomList}
          selectedFinishedId={selectedFinishedId}
          onSelectFinished={setSelectedFinishedId}
          onSaved={loadData}
        />
      )}

      {tab === 'factories' && (
        <FactoriesPanel
          factories={factories}
          canEdit={canIssueOrder}
          onChanged={loadData}
        />
      )}

      {showNewOrderModal && canIssueOrder && (
        <NewOrderModal
          products={products.filter(p => p.product_type === 'FINISHED' || p.product_type == null)}
          branches={branches}
          defaultBranchId={hqBranch?.id || selectedBranch || branches[0]?.id || ''}
          factories={factories.filter((f: any) => f.is_active)}
          onClose={() => setShowNewOrderModal(false)}
          onSuccess={() => { setShowNewOrderModal(false); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── OEM 공장 관리 패널 ────────────────────────────────────────────────────────

function FactoriesPanel({ factories, canEdit, onChanged }: {
  factories: any[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = factories.filter((f: any) => showInactive ? true : f.is_active);

  const handleToggle = async (f: any) => {
    if (!canEdit || busyId) return;
    setBusyId(f.id);
    try {
      const r = f.is_active ? await deactivateFactory(f.id) : await activateFactory(f.id);
      if (r.error) alert(r.error); else await onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (f: any) => {
    if (!canEdit || busyId) return;
    if (!confirm(`"${f.name}" 공장을 완전 삭제할까요? (연결된 생산 지시가 있으면 실패합니다)`)) return;
    setBusyId(f.id);
    try {
      const r = await deleteFactory(f.id);
      if (r.error) { alert(r.error); return; }
      await onChanged();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-700">OEM 위탁 공장</h3>
          <p className="text-xs text-slate-500">생산 지시 시 선택하는 위탁 공장 마스터입니다.</p>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            비활성 포함
          </label>
          {canEdit && (
            <button onClick={() => { setEditing(null); setShowEditor(true); }} className="btn-primary text-sm">+ 공장 등록</button>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table min-w-[720px]">
          <thead>
            <tr>
              <th>코드</th>
              <th>공장명</th>
              <th>담당자</th>
              <th>연락처</th>
              <th>사업자번호</th>
              <th>상태</th>
              {canEdit && <th className="text-right">작업</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={canEdit ? 7 : 6} className="text-center text-slate-400 py-8">등록된 공장이 없습니다</td></tr>
            ) : visible.map((f: any) => (
              <tr key={f.id} className={f.is_active ? '' : 'opacity-60'}>
                <td className="font-mono text-xs text-slate-500">{f.code || '-'}</td>
                <td className="font-medium">{f.name}</td>
                <td className="text-sm text-slate-600">{f.contact_name || f.representative || '-'}</td>
                <td className="text-sm text-slate-600">{f.phone || '-'}</td>
                <td className="text-sm text-slate-500">{f.business_number || '-'}</td>
                <td>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${f.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {f.is_active ? '활성' : '비활성'}
                  </span>
                </td>
                {canEdit && (
                  <td className="text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => { setEditing(f); setShowEditor(true); }}
                        disabled={!!busyId}
                        className="text-xs px-2 py-1 rounded bg-slate-50 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => handleToggle(f)}
                        disabled={!!busyId}
                        className="text-xs px-2 py-1 rounded bg-slate-50 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busyId === f.id ? '처리중…' : (f.is_active ? '비활성' : '활성')}
                      </button>
                      <button
                        onClick={() => handleDelete(f)}
                        disabled={!!busyId}
                        className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showEditor && (
        <FactoryEditor
          initial={editing}
          onClose={() => setShowEditor(false)}
          onSaved={() => { setShowEditor(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function FactoryEditor({ initial, onClose, onSaved }: {
  initial: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<OemFactoryInput>({
    code: initial?.code || '',
    name: initial?.name || '',
    business_number: initial?.business_number || '',
    representative: initial?.representative || '',
    contact_name: initial?.contact_name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    address: initial?.address || '',
    memo: initial?.memo || '',
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setField = (k: keyof OemFactoryInput, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    setErr(null);
    if (!form.name?.trim()) { setErr('공장명은 필수입니다.'); return; }
    setSaving(true);
    const r = initial?.id
      ? await updateFactory(initial.id, form)
      : await createFactory(form);
    setSaving(false);
    if (r.error) { setErr(r.error); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl shadow-xl">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800">{initial?.id ? 'OEM 공장 수정' : 'OEM 공장 등록'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        <div className="p-4 sm:p-6 space-y-3">
          {err && <div className="p-2 rounded bg-red-50 text-red-700 text-sm">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-600">코드</label>
              <input className="input" value={form.code || ''} onChange={e => setField('code', e.target.value)} placeholder="선택" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-600">공장명 *</label>
              <input className="input" value={form.name} onChange={e => setField('name', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-600">대표자</label>
              <input className="input" value={form.representative || ''} onChange={e => setField('representative', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-600">사업자번호</label>
              <input className="input" value={form.business_number || ''} onChange={e => setField('business_number', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-600">담당자</label>
              <input className="input" value={form.contact_name || ''} onChange={e => setField('contact_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-600">전화</label>
              <input className="input" value={form.phone || ''} onChange={e => setField('phone', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-600">이메일</label>
            <input className="input" type="email" value={form.email || ''} onChange={e => setField('email', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-600">주소</label>
            <input className="input" value={form.address || ''} onChange={e => setField('address', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-600">메모</label>
            <textarea className="input" rows={2} value={form.memo || ''} onChange={e => setField('memo', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.is_active ?? true} onChange={e => setField('is_active', e.target.checked)} />
            활성
          </label>
        </div>
        <div className="flex gap-2 px-4 sm:px-6 py-4 border-t">
          <button onClick={handleSubmit} disabled={saving} className="flex-1 btn-primary disabled:opacity-50">
            {saving ? '저장 중...' : '저장'}
          </button>
          <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
        </div>
      </div>
    </div>
  );
}

// ─── 생산 지시 모달 ────────────────────────────────────────────────────────────

function NewOrderModal({ products, branches, defaultBranchId, factories, onClose, onSuccess }: {
  products: any[];
  branches: any[];
  defaultBranchId: string;
  factories: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [branchId, setBranchId]   = useState(defaultBranchId);
  const [factoryId, setFactoryId] = useState('');
  const [quantity, setQuantity]   = useState(1);
  const [memo, setMemo]           = useState('');
  const [preview, setPreview]     = useState<any[]>([]);
  const [hqInfo, setHqInfo]       = useState<{ id: string; name: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!productId || quantity < 1) { setPreview([]); setHqInfo(null); return; }
    setLoadingPreview(true);
    getProductionPreview(productId, branchId, quantity).then(r => {
      setPreview(r.data);
      setHqInfo((r as any).hq ?? null);
      setLoadingPreview(false);
    });
  }, [productId, quantity, branchId]);

  const totalCost = preview.reduce((s, p) => s + p.cost * Math.ceil(p.required), 0);
  const hasShortage = preview.some((p: any) => (p.hq_shortage ?? 0) > 0);
  const canSubmit = !!productId && !!branchId && quantity >= 1;

  const handleSubmit = async () => {
    setSubmitting(true);
    const fd = new FormData();
    fd.set('product_id', productId);
    fd.set('branch_id', branchId);
    if (factoryId) fd.set('oem_factory_id', factoryId);
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
          <h2 className="font-bold text-slate-800">생산 지시 등록 (OEM 위탁)</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">완제품 *</label>
            <select value={productId} onChange={e => setProductId(e.target.value)} className="input">
              <option value="">완제품 선택</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">OEM 공장</label>
              <select value={factoryId} onChange={e => setFactoryId(e.target.value)} className="input">
                <option value="">(지정 안 함)</option>
                {factories.map((f: any) => (
                  <option key={f.id} value={f.id}>{f.name}{f.code ? ` (${f.code})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">입고 지점 *</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input">
                {branches.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.is_headquarters ? ' (본사)' : ''}
                  </option>
                ))}
              </select>
            </div>
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
            <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="발주서 번호·납기 등" className="input" />
          </div>

          {/* BOM 기반 부자재 소요량·본사 재고·예상 원가 */}
          {loadingPreview && <p className="text-sm text-slate-400">계산 중...</p>}
          {preview.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">
                  부자재 소요 <span className="text-xs font-normal text-slate-400">
                    (생산 완료 시 {hqInfo ? `본사(${hqInfo.name})` : '본사'}에서 차감)
                  </span>
                </p>
                {!hqInfo && (
                  <span className="text-[11px] text-amber-600">⚠ 본사 미지정</span>
                )}
              </div>
              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium">재료</th>
                      <th className="text-right px-3 py-2 text-xs text-slate-500 font-medium">소요량</th>
                      <th className="text-right px-3 py-2 text-xs text-slate-500 font-medium">본사 재고</th>
                      <th className="text-right px-3 py-2 text-xs text-slate-500 font-medium">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p, i) => {
                      const actual = Math.ceil(p.required);
                      const hasLoss = p.loss_rate > 0;
                      const unit = safeUnit(p.unit);
                      const hqStock = p.hq_stock;
                      const shortage = p.hq_shortage ?? 0;
                      const isShort = shortage > 0;
                      return (
                        <tr key={i} className={isShort ? 'bg-red-50/60' : ''}>
                          <td className="px-3 py-1.5">{p.material_name}</td>
                          <td className="px-3 py-1.5 text-right">
                            <span className="font-medium">{actual.toLocaleString()}</span> {unit}
                            {hasLoss && (
                              <span className="block text-[10px] text-slate-400">
                                {p.base_required}{unit} × loss {p.loss_rate}% → 올림
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-1.5 text-right ${isShort ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                            {hqStock === null ? '—' : <>{hqStock.toLocaleString()} {unit}</>}
                            {isShort && (
                              <span className="block text-[10px] text-red-500">
                                부족 {shortage.toLocaleString()} {unit}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right text-slate-600">{Math.round((p.cost || 0) * actual).toLocaleString()}원</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {hasShortage && (
                <p className="text-xs text-red-600 mt-1.5">
                  ⚠ 본사 부자재 재고가 부족합니다. 지시는 등록 가능하지만, 생산 완료 처리 전 본사 재고를 먼저 보충하세요.
                </p>
              )}
              {totalCost > 0 && (
                <p className="text-xs text-slate-500 mt-1.5 text-right">
                  예상 원가 합계: <span className="font-medium text-slate-700">{Math.round(totalCost).toLocaleString()}원</span>
                </p>
              )}
            </div>
          )}

          {preview.length === 0 && productId && !loadingPreview && (
            <p className="text-xs text-slate-400">BOM 미구성 — 원가 참고치 없이 등록됩니다.</p>
          )}
        </div>
        <div className="flex gap-2 px-4 sm:px-6 py-4 border-t">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
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
  products, categories, bomList, selectedFinishedId, onSelectFinished, onSaved,
}: {
  products: any[];
  categories: Category[];
  bomList: any[];
  selectedFinishedId: string;
  onSelectFinished: (id: string) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [productSearch, setProductSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Composer가 dirty/saving을 부모로 올려야 product 전환 가드를 걸 수 있음
  const handleDirtyChange = useCallback((d: boolean) => setDirty(d), []);
  const handleSavingChange = useCallback((s: boolean) => setSaving(s), []);

  const tryChangeProduct = (id: string) => {
    if (saving) return; // 저장 중에는 전환 차단
    if (id === selectedFinishedId) return;
    if (dirty) {
      if (!confirm('저장되지 않은 변경사항이 있습니다. 버리고 이동할까요?')) return;
    }
    onSelectFinished(id);
  };

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
            const dirtyMark = selected && dirty;
            return (
              <button
                key={p.id}
                onClick={() => tryChangeProduct(p.id)}
                disabled={saving}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  selected ? 'bg-blue-50' : 'hover:bg-slate-50'
                } ${saving ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium text-sm truncate ${selected ? 'text-blue-700' : 'text-slate-700'}`}>{p.name}</span>
                  <div className="flex items-center gap-1">
                    {dirtyMark && <span className="text-amber-500 text-xs" title="저장되지 않음">●</span>}
                    {count > 0 ? (
                      <span className="text-xs text-blue-600 bg-blue-100 rounded-full px-2">{count}</span>
                    ) : (
                      <span className="text-xs text-slate-300">미구성</span>
                    )}
                  </div>
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
            categories={categories}
            onSaved={onSaved}
            onDirtyChange={handleDirtyChange}
            onSavingChange={handleSavingChange}
            finishedProducts={finishedProducts}
            bomCountByProduct={bomCountByProduct}
          />
        )}
      </div>
    </div>
  );
}

function BomComposer({
  product, initialLines, candidates, categories, onSaved, onDirtyChange, onSavingChange,
  finishedProducts = [], bomCountByProduct = {},
}: {
  product: Material;
  initialLines: BomLine[];
  candidates: Material[];
  categories: Category[];
  onSaved: () => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  finishedProducts?: Material[];
  bomCountByProduct?: Record<string, number>;
}) {
  const [lines, setLines] = useState<BomLine[]>(initialLines);
  const [matSearch, setMatSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | 'RAW' | 'SUB'>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [showBrowser, setShowBrowser] = useState(true);
  const [saving, setSavingState] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [materialPreviewId, setMaterialPreviewId] = useState<string | null>(null);

  const setDirty = (d: boolean) => { setDirtyState(d); onDirtyChange?.(d); };
  const setSaving = (s: boolean) => { setSavingState(s); onSavingChange?.(s); };

  // product.id 변경 시(리마운트되지만 한 번 더 안전장치) 상태 완전 리셋
  useEffect(() => {
    setLines(initialLines);
    setDirtyState(false);
    onDirtyChange?.(false);
    setMatSearch('');
    setTypeFilter('');
    setCategoryFilter('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  // 부모에서 bomList 갱신 → initialLines reference 바뀜 → 실제 값 동기화
  useEffect(() => {
    setLines(initialLines);
    setDirtyState(false);
    onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLines]);

  // 사용 가능한 카테고리 (현재 후보 자재에 실제로 존재하는 것만 노출)
  const relevantCategoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of candidates) if (c.category_id) ids.add(c.category_id);
    return ids;
  }, [candidates]);
  const relevantCategories = categories.filter(c => relevantCategoryIds.has(c.id));

  // 타입별 카운트 (필터 chip 숫자 표기용)
  const typeCounts = useMemo(() => {
    let raw = 0, sub = 0;
    for (const c of candidates) {
      if (c.product_type === 'RAW') raw++;
      else if (c.product_type === 'SUB') sub++;
    }
    return { raw, sub, all: raw + sub };
  }, [candidates]);

  const usedIds = new Set(lines.map(l => l.material_id));
  const filteredCandidates = useMemo(() => {
    return candidates.filter(c => {
      if (usedIds.has(c.id)) return false;
      if (typeFilter && c.product_type !== typeFilter) return false;
      if (categoryFilter && c.category_id !== categoryFilter) return false;
      if (!materialMatch(c, matSearch)) return false;
      return true;
    });
  }, [candidates, usedIds, typeFilter, categoryFilter, matSearch]);
  const shownCandidates = filteredCandidates.slice(0, 60);

  const addLine = (mat: Material) => {
    setLines(prev => [...prev, {
      material_id: mat.id,
      quantity: 1,
      loss_rate: 0,
      notes: '',
      sort_order: prev.length,
      material: mat,
    }]);
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
    setSaveError(null);
    if (hasInvalid) { setSaveError('수량은 0보다 커야 합니다.'); return; }
    setSaving(true);
    try {
      const payload = lines.map((l, i) => ({
        id: l.id,
        material_id: l.material_id,
        quantity: l.quantity,
        loss_rate: l.loss_rate,
        notes: l.notes || null,
        sort_order: i,
      }));
      const r = await saveBom(product.id, payload);
      if (r.error) {
        console.error('[BomComposer] saveBom error:', r.error);
        setSaveError(r.error);
        return;
      }
      setDirty(false);
      await Promise.resolve(onSaved());
    } catch (err: any) {
      console.error('[BomComposer] save threw:', err);
      setSaveError(err?.message || '알 수 없는 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (dirty && !confirm('변경사항이 저장되지 않았습니다. 되돌릴까요?')) return;
    setLines(initialLines);
    setDirty(false);
  };

  // 다른 완제품 BOM을 가져와 현재 composer에 로드 (id 제거 → 저장 시 INSERT)
  const handleCopyFrom = async (sourceProductId: string, sourceProductName: string) => {
    if (lines.length > 0 && !confirm(`현재 구성된 자재 ${lines.length}종이 "${sourceProductName}"의 BOM으로 교체됩니다. 계속할까요?`)) return;
    const res = await getBomByProduct(sourceProductId);
    if ((res as any).error) { setSaveError((res as any).error); setShowCopyModal(false); return; }
    const src = (res.data as any[]) || [];
    const newLines: BomLine[] = src.map((row: any, i: number) => ({
      // id 제거 — 저장 시 현재 completed product로 새 INSERT
      material_id: row.material_id,
      quantity: Number(row.quantity || 0),
      loss_rate: Number(row.loss_rate || 0),
      notes: row.notes || '',
      sort_order: i,
      material: row.material,
    }));
    setLines(newLines);
    setDirty(true);
    setShowCopyModal(false);
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
            onClick={() => setShowCopyModal(true)}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            title="다른 완제품의 BOM을 복사해서 편집"
          >
            BOM 복사
          </button>
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

      {/* 저장 에러 배너 */}
      {saveError && (
        <div className="mb-3 p-3 rounded-md border border-red-200 bg-red-50 text-sm text-red-700 flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">저장 실패</p>
            <p className="text-xs mt-0.5 whitespace-pre-wrap break-words">{saveError}</p>
            {(saveError.includes('column') || saveError.includes('does not exist') || saveError.includes('loss_rate') || saveError.includes('notes') || saveError.includes('sort_order')) && (
              <p className="text-xs mt-1.5 text-red-600">
                ⚠ Supabase에 마이그레이션 <code className="bg-red-100 px-1 rounded">042_bom_product_type.sql</code> 적용이 필요합니다.
              </p>
            )}
          </div>
          <button onClick={() => setSaveError(null)} className="text-red-500 hover:text-red-700 text-lg leading-none">✕</button>
        </div>
      )}

      {/* 자재 브라우저 (검색 + 타입/카테고리 필터 + 상시 리스트) */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={matSearch}
              onChange={e => setMatSearch(e.target.value)}
              placeholder="이름·코드 또는 초성 검색 (예: ㅎㅅ → 홍삼)"
              className="input text-sm"
            />
            {matSearch && (
              <button
                onClick={() => setMatSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            )}
          </div>
          <button
            onClick={() => setShowBrowser(s => !s)}
            className="text-xs text-slate-500 hover:text-slate-700 whitespace-nowrap"
          >
            {showBrowser ? '접기' : '펼치기'}
          </button>
        </div>

        {/* 타입 chip */}
        <div className="flex flex-wrap gap-1 mb-1.5">
          {([
            ['', '전체', typeCounts.all],
            ['RAW', '원자재', typeCounts.raw],
            ['SUB', '부자재', typeCounts.sub],
          ] as [string, string, number][]).map(([v, label, count]) => {
            const active = typeFilter === v;
            const color = v === 'RAW' ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : v === 'SUB' ? 'border-amber-500 bg-amber-50 text-amber-700'
              : 'border-slate-700 bg-slate-700 text-white';
            return (
              <button
                key={v || 'all'}
                onClick={() => setTypeFilter(v as '' | 'RAW' | 'SUB')}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  active ? color : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {label} <span className="opacity-70 ml-1">({count})</span>
              </button>
            );
          })}
        </div>

        {/* 카테고리 chip */}
        {relevantCategories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setCategoryFilter('')}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                !categoryFilter ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              모든 카테고리
            </button>
            {relevantCategories.map(cat => {
              const active = categoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(active ? '' : cat.id)}
                  className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                    active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        )}

        {/* 결과 브라우저 */}
        {showBrowser && (
          <div className="mt-2 bg-white rounded-md border border-slate-200 max-h-64 overflow-y-auto">
            {filteredCandidates.length === 0 ? (
              <div className="text-center text-slate-400 text-xs py-6">
                {candidates.length === 0 ? '등록된 원·부자재가 없습니다.' : '조건에 맞는 자재가 없습니다.'}
              </div>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {shownCandidates.map(c => {
                    const meta = TYPE_BADGE[c.product_type] || TYPE_BADGE.RAW;
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => addLine(c)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {c.image_url ? (
                              <img
                                src={c.image_url}
                                alt=""
                                onClick={e => { e.stopPropagation(); setMaterialPreviewId(c.id); }}
                                className="w-10 h-10 rounded object-cover border border-slate-200 shrink-0 hover:opacity-80"
                                title="클릭하여 이미지 미리보기"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-slate-100 shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`badge text-[10px] ${meta.cls}`}>{meta.label}</span>
                                <span className="text-sm font-medium text-slate-700 truncate">{c.name}</span>
                                {c.category?.name && (
                                  <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 whitespace-nowrap">
                                    {c.category.name}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                                {c.code} · {safeUnit(c.unit)} · 단가 {Number(c.cost || 0).toLocaleString()}원
                              </p>
                            </div>
                          </div>
                          <span className="text-blue-600 text-xs font-medium whitespace-nowrap">+ 추가</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {filteredCandidates.length > shownCandidates.length && (
                  <div className="text-center text-[11px] text-slate-400 py-2 border-t border-slate-100">
                    {filteredCandidates.length - shownCandidates.length}개 더 있음 — 검색어나 필터로 좁혀 주세요.
                  </div>
                )}
              </>
            )}
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
                        {mat?.image_url ? (
                          <img
                            src={mat.image_url}
                            alt=""
                            onClick={() => mat?.id && setMaterialPreviewId(mat.id)}
                            className="w-9 h-9 rounded object-cover border border-slate-200 shrink-0 cursor-pointer hover:opacity-80"
                            title="클릭하여 이미지 미리보기"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded bg-slate-100 shrink-0" />
                        )}
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
                        <span className="text-xs text-slate-400 w-8">{safeUnit(mat?.unit)}</span>
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
                      <span className="text-slate-400 ml-0.5">{safeUnit(mat?.unit, '')}</span>
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

      {showCopyModal && (
        <CopyBomModal
          excludeId={product.id}
          finishedProducts={finishedProducts}
          bomCountByProduct={bomCountByProduct}
          onClose={() => setShowCopyModal(false)}
          onPick={handleCopyFrom}
        />
      )}

      {materialPreviewId && (
        <MaterialImagePreview
          productId={materialPreviewId}
          onClose={() => setMaterialPreviewId(null)}
        />
      )}
    </div>
  );
}

// ─── 자재 이미지 미리보기 (대표 + 추가 이미지) ─────────────────────────────
function MaterialImagePreview({ productId, onClose }: { productId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string>('');
  const [images, setImages] = useState<Array<{ url: string; label?: string }>>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const sb: any = createClient();
      const [prodRes, filesRes] = await Promise.all([
        sb.from('products').select('name, image_url').eq('id', productId).maybeSingle(),
        sb.from('product_files').select('file_url, file_name, file_type, sort_order')
          .eq('product_id', productId).order('sort_order').then((r: any) => r.error ? { data: [] } : r),
      ]);
      const list: Array<{ url: string; label?: string }> = [];
      if (prodRes.data?.image_url) list.push({ url: prodRes.data.image_url, label: '대표' });
      for (const f of (filesRes.data || [])) {
        if (f.file_type === 'image' && f.file_url) list.push({ url: f.file_url, label: f.file_name });
      }
      setName(prodRes.data?.name || '');
      setImages(list);
      setActiveIdx(0);
      setLoading(false);
    })();
  }, [productId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-2.5 border-b">
          <p className="font-semibold text-sm">{name || '자재 이미지'}{images.length > 0 && <span className="text-slate-400 text-xs ml-2">{activeIdx + 1} / {images.length}</span>}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-50">
          {loading ? (
            <p className="text-sm text-slate-400">불러오는 중...</p>
          ) : images.length === 0 ? (
            <p className="text-sm text-slate-400">등록된 이미지가 없습니다.</p>
          ) : (
            <img src={images[activeIdx].url} alt={images[activeIdx].label || ''} className="max-w-full max-h-[60vh] object-contain rounded" />
          )}
        </div>
        {images.length > 1 && (
          <div className="px-3 py-2 border-t flex gap-2 overflow-x-auto">
            {images.map((im, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={`shrink-0 rounded border-2 overflow-hidden transition-colors ${i === activeIdx ? 'border-blue-500' : 'border-transparent hover:border-slate-300'}`}
                title={im.label}
              >
                <img src={im.url} alt="" className="w-14 h-14 object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyBomModal({
  excludeId, finishedProducts, bomCountByProduct, onClose, onPick,
}: {
  excludeId: string;
  finishedProducts: Material[];
  bomCountByProduct: Record<string, number>;
  onClose: () => void;
  onPick: (sourceId: string, sourceName: string) => void;
}) {
  const [search, setSearch] = useState('');
  const candidates = finishedProducts
    .filter(p => p.id !== excludeId && (bomCountByProduct[p.id] || 0) > 0)
    .filter(p => !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.code || '').toLowerCase().includes(search.toLowerCase()) ||
      (isAllInitials(search) && extractInitials(p.name).includes(search)))
    .slice(0, 50);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center px-5 py-3 border-b">
          <div>
            <h2 className="font-bold">BOM 복사</h2>
            <p className="text-xs text-slate-500 mt-0.5">선택한 완제품의 BOM 구성을 이 완제품으로 복제합니다.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <div className="p-4 border-b">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="완제품명·코드·초성 검색"
            autoFocus
            className="input text-sm"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-8">
              {finishedProducts.length === 0 ? '등록된 완제품이 없습니다.' : 'BOM이 등록된 다른 완제품이 없습니다.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {candidates.map(p => {
                const count = bomCountByProduct[p.id] || 0;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => onPick(p.id, p.name)}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-slate-800 truncate">{p.name}</p>
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">{p.code}</p>
                      </div>
                      <span className="text-xs text-blue-700 bg-blue-100 rounded-full px-2 py-0.5 whitespace-nowrap">자재 {count}종</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
