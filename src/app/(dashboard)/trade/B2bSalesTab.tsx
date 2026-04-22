'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getB2bSalesOrders, getB2bPartners, createB2bSalesOrder, settleB2bOrder, cancelB2bOrder, getB2bPartnerSummary, getPartnerPrices } from '@/lib/b2b-actions';
import { fmtDateKST, kstTodayString } from '@/lib/date';

const STATUS_LABEL: Record<string, string> = { DELIVERED: '납품완료', PARTIALLY_SETTLED: '부분수금', SETTLED: '정산완료', CANCELLED: '취소' };
const STATUS_BADGE: Record<string, string> = {
  DELIVERED: 'bg-amber-100 text-amber-700',
  PARTIALLY_SETTLED: 'bg-blue-100 text-blue-700',
  SETTLED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
};

function defaultRange() {
  // 지난 1개월 (KST)
  const end = kstTodayString();
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return { start: fmtDateKST(d), end };
}

export default function B2bSalesTab() {
  const [orders, setOrders] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerFilter, setPartnerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState(defaultRange().start);
  const [endDate, setEndDate] = useState(defaultRange().end);
  const [showForm, setShowForm] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient() as any;
    const [ordersRes, partnersRes, productsRes, branchesRes, summaryRes] = await Promise.all([
      getB2bSalesOrders({ partnerId: partnerFilter || undefined, status: statusFilter || undefined, startDate, endDate }),
      getB2bPartners(),
      supabase.from('products').select('id, name, code, price').eq('is_active', true).order('name'),
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      getB2bPartnerSummary(),
    ]);
    setOrders(ordersRes.data || []);
    setPartners(partnersRes.data || []);
    setProducts(productsRes.data || []);
    setBranches(branchesRes.data || []);
    setSummary(summaryRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [partnerFilter, statusFilter, startDate, endDate]);

  const activeOrders = orders.filter(o => o.status !== 'CANCELLED');
  const totalOutstanding = activeOrders.filter(o => o.status !== 'SETTLED').reduce((s, o) => s + Number(o.total_amount) - Number(o.settled_amount || 0), 0);

  const handleSettle = async (orderId: string, totalAmount: number, settled: number) => {
    const remaining = totalAmount - settled;
    const input = prompt(`수금 금액을 입력하세요 (미수금: ${remaining.toLocaleString()}원)`, String(remaining));
    if (!input) return;
    const amount = parseInt(input);
    if (isNaN(amount) || amount <= 0) { alert('올바른 금액을 입력하세요.'); return; }
    setSettlingId(orderId);
    const res = await settleB2bOrder(orderId, amount);
    setSettlingId(null);
    if (res.error) alert(res.error);
    else fetchData();
  };

  const handleCancel = async (orderId: string, orderNumber: string) => {
    const reason = prompt(`"${orderNumber}" 납품을 취소합니다. 사유:`);
    if (reason === null) return;
    if (!confirm('정말 취소하시겠습니까? 재고가 복원됩니다.')) return;
    const res = await cancelB2bOrder(orderId, reason);
    if (res.error) alert(res.error);
    else fetchData();
  };

  return (
    <div className="space-y-4">
      {/* 거래처별 미수금 요약 */}
      {summary.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">거래처별 미수금 현황</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="stat-card">
              <p className="text-sm text-slate-500">총 미수금</p>
              <p className="text-2xl font-bold text-red-600">{totalOutstanding.toLocaleString()}원</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-slate-500">납품 건수</p>
              <p className="text-2xl font-bold text-slate-700">{activeOrders.length}건</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead><tr><th>거래처</th><th className="text-right">납품건수</th><th className="text-right">납품총액</th><th className="text-right">수금액</th><th className="text-right font-bold">미수금</th></tr></thead>
              <tbody>
                {summary.map((s: any) => (
                  <tr key={s.partnerId}>
                    <td className="font-medium">{s.name} <span className="text-xs text-slate-400">{s.code}</span></td>
                    <td className="text-right">{s.count}건</td>
                    <td className="text-right">{s.totalSales.toLocaleString()}원</td>
                    <td className="text-right">{s.totalSettled.toLocaleString()}원</td>
                    <td className="text-right font-bold text-red-600">{s.outstanding.toLocaleString()}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 필터 + 테이블 */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <select value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)} className="input text-sm py-1.5 w-40">
            <option value="">전체 거래처</option>
            {partners.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm py-1.5 w-32">
            <option value="">전체 상태</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input text-sm py-1.5" />
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input text-sm py-1.5" />
          <div className="ml-auto">
            <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 납품 등록</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table min-w-[800px]">
            <thead>
              <tr>
                <th>납품일</th>
                <th>전표</th>
                <th>거래처</th>
                <th>품목</th>
                <th className="text-right">납품액</th>
                <th className="text-right">수금액</th>
                <th>정산예정일</th>
                <th>상태</th>
                <th>동작</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">로딩 중...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">납품 내역이 없습니다</td></tr>
              ) : orders.map(o => (
                <tr key={o.id} className={o.status === 'CANCELLED' ? 'opacity-40' : ''}>
                  <td className="text-sm whitespace-nowrap">{o.delivered_at?.slice(0, 10)}</td>
                  <td className="font-mono text-xs text-blue-700">{o.order_number}</td>
                  <td className="text-sm font-medium">{o.partner?.name}</td>
                  <td className="text-xs text-slate-500 max-w-[200px] truncate">
                    {(o.items || []).map((i: any) => `${i.product?.name} ×${i.quantity}`).join(', ')}
                  </td>
                  <td className="text-right text-sm">{Number(o.total_amount).toLocaleString()}원</td>
                  <td className="text-right text-sm">{Number(o.settled_amount || 0).toLocaleString()}원</td>
                  <td className="text-sm">{o.settlement_due_date || '-'}</td>
                  <td><span className={`badge text-xs ${STATUS_BADGE[o.status] || ''}`}>{STATUS_LABEL[o.status] || o.status}</span></td>
                  <td>
                    {(o.status === 'DELIVERED' || o.status === 'PARTIALLY_SETTLED') && (
                      <button
                        onClick={() => handleSettle(o.id, Number(o.total_amount), Number(o.settled_amount || 0))}
                        disabled={settlingId === o.id}
                        className="text-xs text-green-600 hover:underline mr-2"
                      >
                        수금
                      </button>
                    )}
                    {o.status === 'DELIVERED' && Number(o.settled_amount || 0) === 0 && (
                      <button onClick={() => handleCancel(o.id, o.order_number)} className="text-xs text-red-500 hover:underline">취소</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <B2bSalesForm
          partners={partners.filter(p => p.is_active)}
          products={products}
          branches={branches}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); fetchData(); }}
        />
      )}
    </div>
  );
}

// ── 납품 등록 모달 ──────────────────────────────────────────────────

function B2bSalesForm({ partners, products, branches, onClose, onSuccess }: any) {
  const [partnerId, setPartnerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [items, setItems] = useState<Array<{ productId: string; quantity: number; unitPrice: number }>>([{ productId: '', quantity: 1, unitPrice: 0 }]);
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // 거래처별 단가표 (partnerId 변경 시 로드)
  const [partnerPriceMap, setPartnerPriceMap] = useState<Map<string, number>>(new Map());

  // 거래처 선택 시 단가표 로드
  const handlePartnerChange = async (pid: string) => {
    setPartnerId(pid);
    if (!pid) { setPartnerPriceMap(new Map()); return; }
    const res = await getPartnerPrices(pid);
    const map = new Map<string, number>();
    for (const p of (res.data || [])) map.set(p.product_id, Number(p.unit_price));
    setPartnerPriceMap(map);
    // 이미 선택된 품목의 단가도 업데이트
    setItems(prev => prev.map(item => {
      if (item.productId && map.has(item.productId)) {
        return { ...item, unitPrice: map.get(item.productId)! };
      }
      return item;
    }));
  };

  const addItem = () => setItems([...items, { productId: '', quantity: 1, unitPrice: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, val: any) => {
    const next = [...items];
    (next[i] as any)[field] = val;
    // 제품 선택 시 단가 자동 세팅 — 거래처 단가 → 없으면 정가
    if (field === 'productId') {
      const partnerPrice = partnerPriceMap.get(val);
      if (partnerPrice !== undefined) {
        next[i].unitPrice = partnerPrice;
      } else {
        const p = products.find((p: any) => p.id === val);
        if (p) next[i].unitPrice = p.price;
      }
    }
    setItems(next);
  };

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId) { setError('거래처를 선택하세요.'); return; }
    if (items.some(i => !i.productId || i.quantity <= 0)) { setError('품목과 수량을 확인하세요.'); return; }
    setSubmitting(true);
    setError('');
    const res = await createB2bSalesOrder({ partnerId, branchId: branchId || undefined, items, memo });
    setSubmitting(false);
    if (res.error) setError(res.error);
    else { alert(`납품 등록 완료 (${res.orderNumber})`); onSuccess(); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-2xl mx-auto max-h-[92vh] overflow-y-auto rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">납품 등록</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        {error && <div className="mb-3 p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">거래처 *</label>
              <select value={partnerId} onChange={e => handlePartnerChange(e.target.value)} required className="input">
                <option value="">선택</option>
                {partners.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">출고 지점</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input">
                <option value="">선택 (재고 차감 안 함)</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">납품 품목</label>
              <button type="button" onClick={addItem} className="text-xs text-blue-600 hover:underline">+ 품목 추가</button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <select value={item.productId} onChange={e => updateItem(i, 'productId', e.target.value)} className="input flex-1 text-sm">
                    <option value="">제품 선택</option>
                    {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                  </select>
                  <input type="number" min={1} value={item.quantity} onChange={e => updateItem(i, 'quantity', parseInt(e.target.value) || 1)} className="input w-16 text-sm text-center" placeholder="수량" />
                  <input type="number" min={0} value={item.unitPrice} onChange={e => updateItem(i, 'unitPrice', parseInt(e.target.value) || 0)} className="input w-24 text-sm text-right" placeholder="단가" />
                  <span className="text-sm text-slate-500 w-24 text-right">{(item.quantity * item.unitPrice).toLocaleString()}원</span>
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                  )}
                </div>
              ))}
            </div>
            <div className="text-right font-bold text-lg mt-2">합계: {total.toLocaleString()}원</div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">메모</label>
            <input value={memo} onChange={e => setMemo(e.target.value)} className="input" placeholder="납품 사유, 특이사항 등" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={submitting} className="flex-1 btn-primary">{submitting ? '처리 중...' : '납품 등록'}</button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
