'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { settleCreditOrder } from '@/lib/accounting-actions';
import { cancelCreditOrder } from '@/lib/credit-actions';
import Link from 'next/link';

interface CreditOrder {
  id: string;
  order_number: string;
  total_amount: number;
  ordered_at: string;
  credit_settled: boolean;
  credit_settled_at: string | null;
  credit_settled_method: string | null;
  customer: { id: string; name: string; phone: string; grade: string } | null;
  branch: { id: string; name: string } | null;
}

const SETTLE_METHODS = [
  { value: 'cash', label: '현금' },
  { value: 'card', label: '카드' },
  { value: 'card_keyin', label: '카드(키인)' },
  { value: 'kakao', label: '카카오페이' },
];

const GRADE_BADGE: Record<string, string> = {
  VVIP: 'bg-red-100 text-red-700',
  VIP: 'bg-amber-100 text-amber-700',
  NORMAL: 'bg-slate-100 text-slate-500',
};

function defaultDateRange() {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { start, end };
}

export default function CreditManagementPage() {
  const [orders, setOrders] = useState<CreditOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'unsettled' | 'settled'>('unsettled');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(defaultDateRange().start);
  const [endDate, setEndDate] = useState(defaultDateRange().end);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [settleMethod, setSettleMethod] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient() as any;
    let q = supabase
      .from('sales_orders')
      .select(`
        id, order_number, total_amount, ordered_at, status,
        credit_settled, credit_settled_at, credit_settled_method,
        customer:customers(id, name, phone, grade),
        branch:branches(id, name)
      `)
      .eq('payment_method', 'credit')
      .order('ordered_at', { ascending: false });

    if (startDate) q = q.gte('ordered_at', `${startDate}T00:00:00`);
    if (endDate) q = q.lte('ordered_at', `${endDate}T23:59:59`);

    const { data } = await q.limit(500);
    setOrders(data || []);
    setPage(0);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [startDate, endDate]);

  // CANCELLED 건은 양쪽 탭에서 모두 제외
  const activeOrders = orders.filter(o => (o as any).status !== 'CANCELLED');

  // 필터링
  const filtered = activeOrders.filter(o => {
    if (tab === 'unsettled' && o.credit_settled) return false;
    if (tab === 'settled' && !o.credit_settled) return false;
    if (search) {
      const q = search.toLowerCase();
      const inName = (o.customer?.name || '').toLowerCase().includes(q);
      const inPhone = (o.customer?.phone || '').replace(/-/g, '').includes(q.replace(/-/g, ''));
      const inOrder = o.order_number.toLowerCase().includes(q);
      const inBranch = (o.branch?.name || '').toLowerCase().includes(q);
      if (!inName && !inPhone && !inOrder && !inBranch) return false;
    }
    return true;
  });

  // 통계 (CANCELLED 제외)
  const unsettledOrders = activeOrders.filter(o => !o.credit_settled);
  const settledOrders = activeOrders.filter(o => o.credit_settled);
  const totalUnsettled = unsettledOrders.reduce((s, o) => s + Number(o.total_amount), 0);
  const totalSettled = settledOrders.reduce((s, o) => s + Number(o.total_amount), 0);

  // 고객별 미수금 집계
  const customerSummary = new Map<string, { name: string; phone: string; grade: string; count: number; total: number; customerId: string }>();
  for (const o of unsettledOrders) {
    if (!o.customer) continue;
    const key = o.customer.id;
    const cur = customerSummary.get(key) || { name: o.customer.name, phone: o.customer.phone, grade: o.customer.grade, count: 0, total: 0, customerId: o.customer.id };
    cur.count++;
    cur.total += Number(o.total_amount);
    customerSummary.set(key, cur);
  }
  const customerSummaryList = Array.from(customerSummary.values()).sort((a, b) => b.total - a.total);

  const handleSettle = async (orderId: string) => {
    const method = settleMethod[orderId];
    if (!method) { alert('수금 방법을 선택해주세요.'); return; }
    if (!confirm('이 외상 건을 수금 처리하시겠습니까?')) return;
    setSettlingId(orderId);
    const res = await settleCreditOrder({ orderId, settledMethod: method as 'cash' | 'card' | 'kakao' | 'card_keyin' });
    setSettlingId(null);
    if (!res.success) {
      alert('수금 처리 실패: ' + (res.error || '알 수 없는 오류'));
    } else {
      fetchData();
    }
  };

  const handleCancel = async (orderId: string, orderNumber: string) => {
    const reason = prompt(`"${orderNumber}" 외상 거래를 취소합니다.\n\n취소 사유를 입력하세요:`);
    if (reason === null) return; // 취소 클릭
    if (!reason.trim()) { alert('취소 사유를 입력해주세요.'); return; }
    if (!confirm(`정말 이 외상 거래를 취소하시겠습니까?\n\n전표: ${orderNumber}\n사유: ${reason}\n\n⚠️ 취소 시 재고가 복원되고, 적립 포인트가 차감되며, 역분개가 생성됩니다.`)) return;

    setCancellingId(orderId);
    const res = await cancelCreditOrder({ orderId, reason: reason.trim() });
    setCancellingId(null);
    if (res.error) {
      alert('거래 취소 실패: ' + res.error);
    } else {
      alert(`거래 취소 완료\n전표: ${res.orderNumber}\n금액: ${(res.amount || 0).toLocaleString()}원`);
      fetchData();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">외상 관리</h2>
          <p className="text-sm text-slate-500 mt-1">외상 결제 건의 미수금 현황과 수금 처리를 관리합니다.</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">시작일</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input text-sm py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">종료일</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input text-sm py-1.5" />
          </div>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="stat-card">
          <p className="text-sm text-slate-500">미수금 건수</p>
          <p className="text-2xl font-bold text-red-600">{unsettledOrders.length}건</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">미수금 총액</p>
          <p className="text-2xl font-bold text-red-600">{totalUnsettled.toLocaleString()}원</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">수금 완료</p>
          <p className="text-2xl font-bold text-green-600">{settledOrders.length}건</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">수금 총액</p>
          <p className="text-2xl font-bold text-green-600">{totalSettled.toLocaleString()}원</p>
        </div>
      </div>

      {/* 고객별 미수금 요약 */}
      {tab === 'unsettled' && customerSummaryList.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">고객별 미수금 현황</h3>
          <div className="overflow-x-auto">
            <table className="table min-w-[400px]">
              <thead>
                <tr>
                  <th>고객</th>
                  <th>등급</th>
                  <th className="text-right">미수금 건수</th>
                  <th className="text-right">미수금 합계</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {customerSummaryList.map(c => (
                  <tr key={c.customerId}>
                    <td>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-slate-400">{c.phone}</div>
                    </td>
                    <td>
                      <span className={`badge text-xs ${GRADE_BADGE[c.grade] || ''}`}>
                        {c.grade}
                      </span>
                    </td>
                    <td className="text-right text-sm font-mono">{c.count}건</td>
                    <td className="text-right text-sm font-bold text-red-600">{c.total.toLocaleString()}원</td>
                    <td>
                      <Link href={`/customers/${c.customerId}`} className="text-xs text-blue-600 hover:underline">
                        상세
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 탭 + 검색 + 테이블 */}
      <div className="card">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex gap-1 border-b border-slate-200">
            <button
              onClick={() => setTab('unsettled')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === 'unsettled' ? 'border-red-500 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              미수금 ({unsettledOrders.length})
            </button>
            <button
              onClick={() => setTab('settled')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === 'settled' ? 'border-green-500 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              수금 완료 ({settledOrders.length})
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="고객명 / 전화 / 전표번호 / 지점"
            className="input text-sm py-1.5 w-56"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="table min-w-[700px]">
            <thead>
              <tr>
                <th>주문일</th>
                <th>전표번호</th>
                <th>고객</th>
                <th>지점</th>
                <th className="text-right">금액</th>
                {tab === 'unsettled' && <th className="w-44">수금 처리</th>}
                {tab === 'settled' && <th>수금일</th>}
                {tab === 'settled' && <th>수금 방법</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={tab === 'unsettled' ? 6 : 7} className="text-center py-8 text-slate-400">로딩 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={tab === 'unsettled' ? 6 : 7} className="text-center py-8 text-slate-400">
                  {search ? '검색 결과가 없습니다' : tab === 'unsettled' ? '미수금 건이 없습니다' : '수금 완료 건이 없습니다'}
                </td></tr>
              ) : filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(o => (
                <tr key={o.id}>
                  <td className="text-sm text-slate-500 whitespace-nowrap">{o.ordered_at?.slice(0, 10)}</td>
                  <td className="text-sm font-mono text-blue-700">{o.order_number}</td>
                  <td>
                    {o.customer ? (
                      <Link href={`/customers/${o.customer.id}`} className="hover:underline">
                        <div className="text-sm font-medium">{o.customer.name}</div>
                        <div className="text-xs text-slate-400">{o.customer.phone}</div>
                      </Link>
                    ) : (
                      <span className="text-xs text-red-500">고객 미지정</span>
                    )}
                  </td>
                  <td className="text-sm">{o.branch?.name || '-'}</td>
                  <td className="text-right text-sm font-semibold">{Number(o.total_amount).toLocaleString()}원</td>

                  {tab === 'unsettled' && (
                    <td>
                      <div className="flex items-center gap-1">
                        <select
                          value={settleMethod[o.id] || ''}
                          onChange={e => setSettleMethod(prev => ({ ...prev, [o.id]: e.target.value }))}
                          className="input text-xs py-1 w-24"
                        >
                          <option value="">수금 방법</option>
                          {SETTLE_METHODS.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSettle(o.id)}
                          disabled={settlingId === o.id || !settleMethod[o.id]}
                          className="px-2 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 whitespace-nowrap"
                        >
                          {settlingId === o.id ? '...' : '수금'}
                        </button>
                        <button
                          onClick={() => handleCancel(o.id, o.order_number)}
                          disabled={cancellingId === o.id}
                          className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-40 whitespace-nowrap"
                          title="외상 거래 취소 (재고 복원 + 포인트 차감 + 역분개)"
                        >
                          {cancellingId === o.id ? '...' : '취소'}
                        </button>
                      </div>
                    </td>
                  )}

                  {tab === 'settled' && (
                    <>
                      <td className="text-sm text-slate-500 whitespace-nowrap">{o.credit_settled_at?.slice(0, 10) || '-'}</td>
                      <td className="text-sm">
                        {({ cash: '현금', card: '카드', card_keyin: '카드(키인)', kakao: '카카오페이' } as Record<string, string>)[o.credit_settled_method || ''] || o.credit_settled_method || '-'}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이징 */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">
              총 {filtered.length}건 중 {page * PAGE_SIZE + 1}~{Math.min((page + 1) * PAGE_SIZE, filtered.length)}건
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 disabled:opacity-40"
              >
                ← 이전
              </button>
              <span className="px-2 py-1 text-xs text-slate-600">
                {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
              </span>
              <button
                onClick={() => setPage(p => Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1))}
                disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                className="px-2 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 disabled:opacity-40"
              >
                다음 →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
