'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import ReceiptModal from './ReceiptModal';
import RefundModal from './RefundModal';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

interface Branch { id: string; name: string; code?: string; channel?: string; }
interface OrderRow {
  id: string;
  order_number: string;
  ordered_at: string;
  status: string;
  total_amount: number;
  discount_amount: number;
  payment_method: string;
  points_earned: number;
  points_used: number;
  credit_settled: boolean | null;
  memo: string | null;
  approval_no: string | null;
  card_info: string | null;
  branch: { id: string; name: string } | null;
  customer: { id: string; name: string; phone: string } | null;
  items: { id: string; quantity: number }[];
  shipments?: { branch_id: string | null; recipient_name: string | null; status: string | null }[];
}

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: '완료', CANCELLED: '취소', REFUNDED: '환불', PARTIALLY_REFUNDED: '부분환불',
};
const STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  REFUNDED: 'bg-red-100 text-red-600',
  PARTIALLY_REFUNDED: 'bg-amber-100 text-amber-700',
};
const PAY_LABEL: Record<string, string> = {
  cash: '현금', card: '카드', card_keyin: '카드(키인)', kakao: '카카오',
  credit: '외상', cod: '수령시수금', mixed: '복합',
};

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function todayStr(): string { return fmtDate(new Date()); }
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return fmtDate(d);
}

type Period = 'today' | '7d' | '30d' | 'custom';

export default function SalesListTab() {
  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  const [branches, setBranches] = useState<Branch[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>('today');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [branchFilter, setBranchFilter] = useState(isBranchUser && userBranchId ? userBranchId : '');
  const [paymentFilter, setPaymentFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(true);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [reprintReceipt, setReprintReceipt] = useState<any>(null);

  // 초기 — 지점 목록
  useEffect(() => {
    const sb = createClient() as any;
    sb.from('branches').select('id, name, code, channel').eq('is_active', true).order('name')
      .then(({ data }: any) => setBranches(data || []));
  }, []);

  // 기간 프리셋
  const applyPeriod = (p: Period) => {
    setPeriod(p);
    if (p === 'today') { setStartDate(todayStr()); setEndDate(todayStr()); }
    else if (p === '7d') { setStartDate(daysAgo(6)); setEndDate(todayStr()); }
    else if (p === '30d') { setStartDate(daysAgo(29)); setEndDate(todayStr()); }
  };

  const loadOrders = useCallback(async () => {
    setLoading(true);
    const sb = createClient() as any;
    let q = sb
      .from('sales_orders')
      .select(`
        id, order_number, ordered_at, status, total_amount, discount_amount,
        payment_method, points_earned, points_used, credit_settled, memo,
        approval_no, card_info,
        branch:branches(id, name),
        customer:customers(id, name, phone),
        items:sales_order_items(id, quantity)
      `)
      .gte('ordered_at', `${startDate}T00:00:00`)
      .lte('ordered_at', `${endDate}T23:59:59`)
      .order('ordered_at', { ascending: false })
      .limit(500);

    if (branchFilter) q = q.eq('branch_id', branchFilter);
    if (paymentFilter) q = q.eq('payment_method', paymentFilter);
    if (statusFilter) q = q.eq('status', statusFilter);
    if (!includeCancelled && !statusFilter) q = q.not('status', 'in', '(CANCELLED,REFUNDED)');

    const { data, error } = await q;
    if (error) console.error('[SalesListTab] load error:', error);
    const rows = (data as any[]) || [];

    if (rows.length > 0) {
      const orderIds = rows.map((r: any) => r.id);
      const { data: shipData } = await sb
        .from('shipments')
        .select('sales_order_id, branch_id, recipient_name, status')
        .in('sales_order_id', orderIds);
      if (shipData) {
        const shipMap = new Map<string, any[]>();
        for (const s of shipData as any[]) {
          const arr = shipMap.get(s.sales_order_id) || [];
          arr.push(s);
          shipMap.set(s.sales_order_id, arr);
        }
        for (const r of rows) {
          r.shipments = shipMap.get(r.id) || [];
        }
      }
    }

    setOrders(rows);
    setLoading(false);
  }, [startDate, endDate, branchFilter, paymentFilter, statusFilter, includeCancelled]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // 클라이언트 검색 (주문번호·고객명·고객전화·메모)
  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.trim().toLowerCase();
    const digits = q.replace(/[^0-9]/g, '');
    return orders.filter(o => {
      if (o.order_number?.toLowerCase().includes(q)) return true;
      if (o.customer?.name?.toLowerCase().includes(q)) return true;
      if (digits && o.customer?.phone?.replace(/[^0-9]/g, '').includes(digits)) return true;
      if (o.memo?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [orders, search]);

  // 요약 카드
  const summary = useMemo(() => {
    const valid = filtered.filter(o => !['CANCELLED', 'REFUNDED'].includes(o.status));
    return {
      count: valid.length,
      total: valid.reduce((s, o) => s + (o.total_amount || 0), 0),
      discount: valid.reduce((s, o) => s + (o.discount_amount || 0), 0),
      pointsEarned: valid.reduce((s, o) => s + (o.points_earned || 0), 0),
      cancelledCount: filtered.length - valid.length,
    };
  }, [filtered]);

  // 일자별 집계 (기간 > 1일이면 보조 카드 노출)
  const perDay = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const o of filtered) {
      if (['CANCELLED', 'REFUNDED'].includes(o.status)) continue;
      const d = (o.ordered_at || '').slice(0, 10);
      const cur = map.get(d) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += o.total_amount || 0;
      map.set(d, cur);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const isMultiDay = startDate !== endDate;

  const handleCsv = () => {
    if (filtered.length === 0) return;
    const header = ['주문번호', '일시', '고객', '연락처', '지점', '품목수', '결제방법', '결제금액', '할인', '포인트적립', '외상정산', '상태', '메모'];
    const rows = filtered.map(o => [
      o.order_number,
      (o.ordered_at || '').slice(0, 19).replace('T', ' '),
      o.customer?.name || '',
      o.customer?.phone || '',
      o.branch?.name || '',
      (o.items || []).length,
      PAY_LABEL[o.payment_method] || o.payment_method,
      o.total_amount,
      o.discount_amount,
      o.points_earned,
      o.credit_settled === false ? '미정산' : (o.credit_settled === true ? '정산완료' : ''),
      STATUS_LABEL[o.status] || o.status,
      (o.memo || '').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...rows].map(r => r.map(cell => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `판매현황_${startDate}_${endDate}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="card space-y-3">
        {/* 기간 프리셋 */}
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['today', '오늘'],
            ['7d', '최근 7일'],
            ['30d', '최근 30일'],
            ['custom', '사용자 지정'],
          ] as [Period, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => applyPeriod(k)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                period === k ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-2">
            <input type="date" value={startDate}
              onChange={e => { setStartDate(e.target.value); setPeriod('custom'); }}
              className="input text-sm py-1 w-36" />
            <span className="text-slate-400">~</span>
            <input type="date" value={endDate}
              onChange={e => { setEndDate(e.target.value); setPeriod('custom'); }}
              className="input text-sm py-1 w-36" />
          </div>
          <button onClick={loadOrders} className="btn-secondary text-sm py-1.5 ml-auto">조회</button>
          <button onClick={handleCsv} disabled={filtered.length === 0}
            className="btn-secondary text-sm py-1.5 disabled:opacity-40">CSV 내보내기</button>
        </div>

        {/* 세부 필터 */}
        <div className="flex flex-wrap gap-2">
          {!isBranchUser && (
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input text-sm py-1 w-36">
              <option value="">전체 지점</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} className="input text-sm py-1 w-32">
            <option value="">전체 결제</option>
            {(['cash', 'card', 'card_keyin', 'kakao', 'credit', 'cod', 'mixed'] as const).map(m =>
              <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm py-1 w-32">
            <option value="">전체 상태</option>
            <option value="COMPLETED">완료</option>
            <option value="PARTIALLY_REFUNDED">부분환불</option>
            <option value="REFUNDED">환불</option>
            <option value="CANCELLED">취소</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="주문번호 · 고객명 · 전화 · 메모 검색"
            className="input text-sm py-1 flex-1 min-w-[200px]"
          />
          <label className="flex items-center gap-1.5 text-sm text-slate-600 px-2">
            <input type="checkbox" checked={includeCancelled}
              onChange={e => setIncludeCancelled(e.target.checked)} className="w-4 h-4" />
            취소·환불 포함
          </label>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="판매 건수" value={`${summary.count}건`} sub={summary.cancelledCount > 0 ? `취소·환불 ${summary.cancelledCount}건` : undefined} />
        <SummaryCard label="매출 합계" value={`${summary.total.toLocaleString()}원`} accent="blue" />
        <SummaryCard label="할인 합계" value={`${summary.discount.toLocaleString()}원`} accent="orange" />
        <SummaryCard label="포인트 적립" value={`${summary.pointsEarned.toLocaleString()}P`} accent="green" />
      </div>

      {/* 일자별 요약 (여러 날일 때) */}
      {isMultiDay && perDay.length > 0 && (
        <div className="card">
          <p className="text-sm font-semibold text-slate-700 mb-2">일자별 요약</p>
          <div className="overflow-x-auto">
            <table className="table text-sm min-w-[400px]">
              <thead>
                <tr>
                  <th>일자</th>
                  <th className="text-right">건수</th>
                  <th className="text-right">매출</th>
                </tr>
              </thead>
              <tbody>
                {perDay.map(([d, v]) => (
                  <tr key={d}>
                    <td className="font-mono">{d}</td>
                    <td className="text-right">{v.count}건</td>
                    <td className="text-right font-medium">{v.total.toLocaleString()}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-slate-700">판매 내역 ({filtered.length}건)</h3>
          <button onClick={() => setShowRefundModal(true)}
            className="text-sm text-red-600 hover:underline">환불 처리</button>
        </div>
        <div className="overflow-x-auto">
          <table className="table text-sm min-w-[900px]">
            <thead>
              <tr>
                <th>주문번호</th>
                <th>일시</th>
                <th>고객</th>
                <th>지점</th>
                <th className="text-center">품목</th>
                <th>결제</th>
                <th className="text-right">금액</th>
                <th>배송</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">로딩 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">
                  조건에 맞는 판매 내역이 없습니다
                </td></tr>
              ) : filtered.map(o => {
                const isCancelled = o.status === 'CANCELLED';
                const isRefunded = o.status === 'REFUNDED' || o.status === 'PARTIALLY_REFUNDED';
                return (
                  <tr
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${isCancelled || isRefunded ? 'opacity-60' : ''}`}
                  >
                    <td>
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedOrderId(o.id); }}
                        className="font-mono text-xs text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        {o.order_number}
                      </button>
                    </td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">
                      {(o.ordered_at || '').slice(0, 16).replace('T', ' ')}
                    </td>
                    <td>
                      {o.customer ? (
                        <div>
                          <p className="font-medium">{o.customer.name}</p>
                          <p className="text-xs text-slate-400">{o.customer.phone}</p>
                        </div>
                      ) : <span className="text-slate-300 text-xs">비회원</span>}
                    </td>
                    <td className="text-xs text-slate-500">
                      {o.branch?.name || '-'}
                      {(() => {
                        const shipFromId = o.shipments?.[0]?.branch_id;
                        if (!shipFromId || shipFromId === o.branch?.id) return null;
                        const shipFromName = branches.find(b => b.id === shipFromId)?.name || '타지점';
                        return (
                          <span
                            className="ml-1 inline-flex items-center px-1 text-[10px] rounded bg-indigo-50 text-indigo-600 border border-indigo-100"
                            title={`출고: ${shipFromName}`}
                          >
                            🚚{shipFromName}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="text-center text-xs text-slate-500">{(o.items || []).length}종</td>
                    <td>
                      <span className="text-sm">{PAY_LABEL[o.payment_method] || o.payment_method}</span>
                      {o.credit_settled === false && (
                        <span className="ml-1.5 badge text-[10px] bg-orange-100 text-orange-700">미정산</span>
                      )}
                    </td>
                    <td className={`text-right font-semibold ${isRefunded || isCancelled ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {(o.total_amount || 0).toLocaleString()}원
                    </td>
                    <td className="text-center text-xs">
                      {o.shipments && o.shipments.length > 0 ? (
                        <span className="inline-flex items-center gap-0.5" title={`받는 분: ${o.shipments[0].recipient_name || '-'}`}>
                          📦
                          <span className={`badge text-[10px] ${
                            o.shipments[0].status === 'DELIVERED' ? 'bg-green-100 text-green-700'
                            : o.shipments[0].status === 'SHIPPED' ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-600'
                          }`}>
                            {o.shipments[0].status === 'DELIVERED' ? '배달완료'
                            : o.shipments[0].status === 'SHIPPED' ? '발송'
                            : o.shipments[0].status === 'PRINTED' ? '인쇄'
                            : '대기'}
                          </span>
                        </span>
                      ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td>
                      <span className={`badge text-[10px] ${STATUS_BADGE[o.status] || ''}`}>
                        {STATUS_LABEL[o.status] || o.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrderId && (
        <SalesDetailDrawer
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onReprint={(r) => setReprintReceipt(r)}
          onRefundIntent={() => { setSelectedOrderId(null); setShowRefundModal(true); }}
          onChanged={loadOrders}
        />
      )}

      {reprintReceipt && (
        <ReceiptModal
          {...reprintReceipt}
          onClose={() => setReprintReceipt(null)}
        />
      )}

      {showRefundModal && (
        <RefundModal
          branchId={branchFilter || (branches[0]?.id ?? '')}
          onClose={() => setShowRefundModal(false)}
          onSuccess={(rn) => { setShowRefundModal(false); alert(`환불 완료 · ${rn}`); loadOrders(); }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string;
  accent?: 'blue' | 'orange' | 'green';
}) {
  const color = accent === 'blue' ? 'text-blue-700'
    : accent === 'orange' ? 'text-orange-600'
    : accent === 'green' ? 'text-green-700'
    : 'text-slate-800';
  return (
    <div className="card py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${color} mt-0.5`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── 상세 드로어 ────────────────────────────────────────────────────────────────
function SalesDetailDrawer({ orderId, onClose, onReprint, onRefundIntent, onChanged }: {
  orderId: string;
  onClose: () => void;
  onReprint: (receipt: any) => void;
  onRefundIntent: () => void;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [shipment, setShipment] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const sb = createClient() as any;
      const [ordRes, itemRes, payRes, shipRes] = await Promise.all([
        sb.from('sales_orders')
          .select('*, branch:branches(id, name), customer:customers(id, name, phone)')
          .eq('id', orderId).single(),
        sb.from('sales_order_items')
          .select('id, quantity, unit_price, discount_amount, total_price, product:products(id, name, code, unit)')
          .eq('sales_order_id', orderId).order('id'),
        sb.from('sales_order_payments')
          .select('id, payment_method, amount, approval_no, card_info, memo, paid_at')
          .eq('sales_order_id', orderId).order('paid_at').then((r: any) => r.error ? { data: [] } : r),
        sb.from('shipments')
          .select(`
            id, source, status, tracking_number, branch_id,
            sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail,
            recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail,
            delivery_message, created_at,
            branch:branches(id, name)
          `)
          .eq('sales_order_id', orderId).maybeSingle()
          .then((r: any) => r.error ? { data: null } : r),
      ]);
      if (!active) return;
      setOrder(ordRes.data || null);
      setItems((itemRes.data as any[]) || []);
      setPayments((payRes.data as any[]) || []);
      setShipment(shipRes.data || null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [orderId]);

  const handleReprint = () => {
    if (!order) return;
    onReprint({
      orderNumber: order.order_number,
      branchName: order.branch?.name || '',
      customerName: order.customer?.name,
      items: items.map(it => ({
        name: it.product?.name || '-',
        quantity: it.quantity,
        unitPrice: it.unit_price,
        totalPrice: it.total_price,
      })),
      totalAmount: order.total_amount,
      discountAmount: order.discount_amount,
      finalAmount: order.total_amount - (order.discount_amount || 0),
      pointsUsed: order.points_used || 0,
      pointsEarned: order.points_earned || 0,
      paymentMethod: order.payment_method,
      approvalNo: order.approval_no,
      cardInfo: order.card_info,
      orderedAt: order.ordered_at,
    });
  };

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = order ? Math.max(0, (order.total_amount || 0) - (order.discount_amount || 0) - totalPaid) : 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-stretch justify-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-800">판매 상세</h2>
            {order && <p className="text-xs text-slate-500 font-mono">{order.order_number}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">✕</button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-400">불러오는 중...</div>
        ) : !order ? (
          <div className="p-10 text-center text-slate-400">주문을 찾을 수 없습니다</div>
        ) : (
          <div className="p-5 space-y-4">
            {/* 기본 정보 */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-slate-500">일시</p>
                <p>{(order.ordered_at || '').slice(0, 19).replace('T', ' ')}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">지점</p>
                <p>{order.branch?.name || '-'}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">고객</p>
                {order.customer ? (
                  <Link href={`/customers/${order.customer.id}`} className="text-blue-600 hover:underline">
                    {order.customer.name} <span className="text-xs text-slate-400">{order.customer.phone}</span>
                  </Link>
                ) : <span className="text-slate-400">비회원</span>}
              </div>
              <div>
                <p className="text-[11px] text-slate-500">상태</p>
                <p>
                  <span className={`badge text-[10px] ${STATUS_BADGE[order.status] || ''}`}>
                    {STATUS_LABEL[order.status] || order.status}
                  </span>
                </p>
              </div>
            </div>

            {/* 메모 */}
            {order.memo && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm">
                <p className="text-[11px] font-semibold text-amber-700 mb-1">메모</p>
                <p className="text-amber-900 whitespace-pre-wrap">{order.memo}</p>
              </div>
            )}

            {/* 품목 */}
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">품목 ({items.length}종)</p>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-xs text-slate-500">
                      <th className="text-left px-3 py-1.5">품목</th>
                      <th className="text-right px-3 py-1.5">수량</th>
                      <th className="text-right px-3 py-1.5">단가</th>
                      <th className="text-right px-3 py-1.5">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">
                          <p className="font-medium">{it.product?.name || '-'}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{it.product?.code}</p>
                        </td>
                        <td className="px-3 py-1.5 text-right">{it.quantity}</td>
                        <td className="px-3 py-1.5 text-right">{Number(it.unit_price).toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{Number(it.total_price).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 결제 */}
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">결제</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">총액</span>
                  <span>{Number(order.total_amount || 0).toLocaleString()}원</span>
                </div>
                {order.discount_amount > 0 && (
                  <div className="flex justify-between text-orange-600">
                    <span>할인</span>
                    <span>-{Number(order.discount_amount).toLocaleString()}원</span>
                  </div>
                )}
                {order.points_used > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>포인트 사용</span>
                    <span>-{Number(order.points_used).toLocaleString()}P</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold pt-1 border-t border-slate-200">
                  <span>결제 금액</span>
                  <span>{(order.total_amount - (order.discount_amount || 0)).toLocaleString()}원</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>대표 결제 방식</span>
                  <span>{PAY_LABEL[order.payment_method] || order.payment_method}</span>
                </div>
              </div>

              {payments.length > 0 ? (
                <div className="mt-2 border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-1.5">방식</th>
                        <th className="text-right px-3 py-1.5">금액</th>
                        <th className="text-left px-3 py-1.5">승인번호/카드</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p: any) => (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">{PAY_LABEL[p.payment_method] || p.payment_method}</td>
                          <td className="px-3 py-1.5 text-right font-medium">{Number(p.amount).toLocaleString()}원</td>
                          <td className="px-3 py-1.5 text-slate-500">
                            {p.approval_no || ''}{p.approval_no && p.card_info ? ' · ' : ''}{p.card_info || ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {remaining > 0 && (
                    <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-700 flex justify-between">
                      <span>미결제 잔액 (외상)</span>
                      <span className="font-semibold">{remaining.toLocaleString()}원</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-slate-400">단건 결제 (분할 내역 없음)</p>
              )}

              {order.approval_no && payments.length === 0 && (
                <p className="mt-1 text-[11px] text-slate-500 font-mono">승인 {order.approval_no} · {order.card_info || ''}</p>
              )}
              {order.credit_settled === false && (
                <p className="mt-1 text-xs text-orange-600 font-medium">⚠ 외상 정산 대기</p>
              )}
            </div>

            {/* 택배 */}
            {shipment && (
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-2">택배</p>
                <div className="p-3 rounded-md border border-slate-200 text-sm space-y-1">
                  {shipment.branch?.id && shipment.branch.id !== order.branch?.id && (
                    <p className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-2 py-1 inline-block">
                      🚚 출고 지점: <span className="font-semibold">{shipment.branch.name}</span> (판매 지점과 다름 — 재고는 {shipment.branch.name}에서 차감됨)
                    </p>
                  )}
                  <p><span className="text-slate-500 text-xs mr-2">받는 분</span>
                    {shipment.recipient_name} · {shipment.recipient_phone}</p>
                  <p className="text-slate-600">
                    {shipment.recipient_zipcode ? `[${shipment.recipient_zipcode}] ` : ''}
                    {shipment.recipient_address}
                    {shipment.recipient_address_detail ? ` ${shipment.recipient_address_detail}` : ''}
                  </p>
                  {shipment.delivery_message && <p className="text-xs text-slate-500">메시지: {shipment.delivery_message}</p>}
                  {shipment.sender_name && (
                    <p className="pt-1 border-t border-slate-100 mt-1">
                      <span className="text-slate-500 text-xs mr-2">보내는 분</span>
                      {shipment.sender_name} · {shipment.sender_phone}
                      {shipment.sender_address && (
                        <span className="block text-slate-600 text-xs">
                          {shipment.sender_zipcode ? `[${shipment.sender_zipcode}] ` : ''}
                          {shipment.sender_address} {shipment.sender_address_detail || ''}
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-xs pt-1 flex items-center gap-1.5">
                    <span className={`badge text-[10px] ${
                      shipment.status === 'DELIVERED' ? 'bg-green-100 text-green-700'
                      : shipment.status === 'SHIPPED' ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-600'
                    }`}>
                      {shipment.status === 'DELIVERED' ? '배달완료'
                      : shipment.status === 'SHIPPED' ? '발송완료'
                      : shipment.status === 'PRINTED' ? '송장인쇄'
                      : '발송대기'}
                    </span>
                    {shipment.tracking_number && <span className="font-mono text-slate-500">{shipment.tracking_number}</span>}
                  </p>
                </div>
              </div>
            )}

            {/* 액션 */}
            <div className="flex gap-2 pt-3 border-t border-slate-100">
              <button onClick={handleReprint}
                className="flex-1 btn-secondary py-2 text-sm">영수증 재발행</button>
              {order.status === 'COMPLETED' && (
                <button onClick={onRefundIntent}
                  className="flex-1 py-2 text-sm rounded-md border border-red-200 text-red-600 hover:bg-red-50">
                  환불 처리
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
