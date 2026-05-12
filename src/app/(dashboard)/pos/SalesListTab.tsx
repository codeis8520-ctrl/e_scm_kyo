'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ReceiptModal from './ReceiptModal';
import RefundModal from './RefundModal';
import { fmtDateKST, kstTodayString, kstDayStart, kstDayEnd } from '@/lib/date';
import { cancelSalesOrder } from '@/lib/sales-cancel-actions';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

interface Branch { id: string; name: string; code?: string; channel?: string; }
interface StaffUser { id: string; name: string; branch_id: string | null; }

interface OrderItem {
  id: string;
  quantity: number;
  unit_price?: number;
  total_price?: number;
  order_option?: string | null;
  product?: { id: string; name: string; code?: string } | null;
}

interface ShipmentRow {
  id?: string;
  branch_id: string | null;
  delivery_type?: string | null;
  recipient_name: string | null;
  recipient_phone?: string | null;
  recipient_address?: string | null;
  recipient_address_detail?: string | null;
  delivery_message?: string | null;
  status: string | null;
}

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
  receipt_status?: string | null;
  receipt_date?: string | null;
  approval_status?: string | null;
  payment_info?: string | null;
  branch: { id: string; name: string } | null;
  customer: { id: string; name: string; phone: string } | null;
  handler?: { id: string; name: string } | null;
  items: OrderItem[];
  shipments?: ShipmentRow[];
  // client-side 상담 매칭 캐시 (고객당 상담내역 prefetch)
  _consultMatch?: string | null;
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
const RECEIPT_STATUS_LABEL: Record<string, string> = {
  RECEIVED: '수령', PICKUP_PLANNED: '방문예정', QUICK_PLANNED: '퀵예정', PARCEL_PLANNED: '택배예정',
};
const RECEIPT_STATUS_BADGE: Record<string, string> = {
  RECEIVED: 'bg-green-100 text-green-700',
  PICKUP_PLANNED: 'bg-slate-100 text-slate-600',
  QUICK_PLANNED: 'bg-indigo-100 text-indigo-700',
  PARCEL_PLANNED: 'bg-blue-100 text-blue-700',
};
const APPROVAL_STATUS_LABEL: Record<string, string> = {
  COMPLETED: '결제완료', CARD_PENDING: '미승인(카드)', UNSETTLED: '미결',
};
const APPROVAL_STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'bg-green-50 text-green-700 border border-green-200',
  CARD_PENDING: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  UNSETTLED: 'bg-amber-50 text-amber-700 border border-amber-200',
};

// KST "YYYY-MM-DD". 클라이언트 실행이지만 사용자 TZ에 의존하지 않도록 KST 고정.
function fmtDate(d: Date): string {
  return fmtDateKST(d);
}
function todayStr(): string { return kstTodayString(); }
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return fmtDateKST(d);
}

type Period = 'today' | '7d' | '30d' | 'custom';

export default function SalesListTab() {
  const router = useRouter();
  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>('today');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());

  // 기본(축약) 필터
  const [branchFilter, setBranchFilter] = useState(isBranchUser && userBranchId ? userBranchId : '');
  const [paymentFilter, setPaymentFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');                  // 고객명·전화·주문번호·메모 통합
  const [debouncedSearch, setDebouncedSearch] = useState(''); // loadOrders 트리거용 debounced 값
  const [includeCancelled, setIncludeCancelled] = useState(true);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);

  // 고급 검색 필터 (PDF 중요도 순 상위 먼저 노출)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [consultSearch, setConsultSearch] = useState('');     // 상담내역
  const [productSearch, setProductSearch] = useState('');     // 품목
  const [orderOptionSearch, setOrderOptionSearch] = useState(''); // 주문옵션
  const [recipientSearch, setRecipientSearch] = useState(''); // 받는 분
  const [addressSearch, setAddressSearch] = useState('');     // 주소
  const [handlerFilter, setHandlerFilter] = useState('');     // 담당자
  const [shipFromFilter, setShipFromFilter] = useState('');   // 출고처
  const [receiptStatusFilter, setReceiptStatusFilter] = useState('');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState('');

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundOrderNumber, setRefundOrderNumber] = useState<string | null>(null);
  const [reprintReceipt, setReprintReceipt] = useState<any>(null);

  // 초기 — 지점·직원 목록
  useEffect(() => {
    const sb = createClient() as any;
    sb.from('branches').select('id, name, code, channel').eq('is_active', true).order('name')
      .then(({ data }: any) => setBranches(data || []));
    sb.from('users').select('id, name, branch_id').eq('is_active', true).order('name')
      .then(({ data }: any) => setStaff((data || []) as StaffUser[]));
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
    // 검색어가 있으면 날짜 필터 무시 (오늘이 아닌 과거 고객도 찾을 수 있게)
    // debouncedSearch (메인 검색만) + 기타 텍스트 검색 합산. 어느 하나라도 있으면 전체 기간으로 확장.
    const hasAnySearch = !!(
      debouncedSearch.trim() || consultSearch.trim() || productSearch.trim() ||
      orderOptionSearch.trim() || recipientSearch.trim() || addressSearch.trim()
    );
    // 051 적용 전/후 모두 대응: full select → 실패 시 basic select 폴백
    const buildQuery = (useExtended: boolean) => {
      const baseSelect = useExtended ? `
        id, order_number, ordered_at, status, total_amount, discount_amount,
        payment_method, points_earned, points_used, credit_settled, memo,
        approval_no, card_info,
        receipt_status, receipt_date, approval_status, payment_info,
        branch:branches(id, name),
        customer:customers(id, name, phone),
        handler:users!sales_orders_ordered_by_fkey(id, name),
        items:sales_order_items(id, quantity, unit_price, total_price, order_option, product:products(id, name, code))
      ` : `
        id, order_number, ordered_at, status, total_amount, discount_amount,
        payment_method, points_earned, points_used, credit_settled, memo,
        approval_no, card_info,
        branch:branches(id, name),
        customer:customers(id, name, phone),
        items:sales_order_items(id, quantity, unit_price, total_price, product:products(id, name, code))
      `;
      let q = sb.from('sales_orders').select(baseSelect)
        .order('ordered_at', { ascending: false })
        .limit(hasAnySearch ? 2000 : 500);
      // 검색어 없으면 날짜 필터 적용, 있으면 전체 기간 검색
      if (!hasAnySearch) {
        q = q.gte('ordered_at', kstDayStart(startDate)).lte('ordered_at', kstDayEnd(endDate));
      }
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      if (paymentFilter) q = q.eq('payment_method', paymentFilter);
      if (statusFilter) q = q.eq('status', statusFilter);
      if (!includeCancelled && !statusFilter) q = q.not('status', 'in', '(CANCELLED,REFUNDED)');
      if (useExtended) {
        if (handlerFilter) q = q.eq('ordered_by', handlerFilter);
        if (receiptStatusFilter) q = q.eq('receipt_status', receiptStatusFilter);
        if (approvalStatusFilter) q = q.eq('approval_status', approvalStatusFilter);
      }
      return q;
    };

    let { data, error } = await buildQuery(true);
    if (error) {
      const msg = String((error as any).message || '').toLowerCase();
      const code = String((error as any).code || '');
      if (code === '42703' || msg.includes('column') || msg.includes('relation')) {
        console.warn('[SalesListTab] extended select 실패 — 기본 select로 폴백');
        const retry = await buildQuery(false);
        data = retry.data; error = retry.error;
      }
    }
    if (error) console.error('[SalesListTab] load error:', error);
    const rows = (data as any[]) || [];

    if (rows.length > 0) {
      const orderIds = rows.map((r: any) => r.id);
      const shipFullQ = await sb
        .from('shipments')
        .select('sales_order_id, branch_id, delivery_type, recipient_name, recipient_phone, recipient_address, recipient_address_detail, status')
        .in('sales_order_id', orderIds);
      let shipData = shipFullQ.data;
      if (shipFullQ.error) {
        const fallback = await sb
          .from('shipments')
          .select('sales_order_id, branch_id, recipient_name, recipient_phone, recipient_address, status')
          .in('sales_order_id', orderIds);
        shipData = fallback.data;
      }
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

    // 출고처 필터 (client-side — shipments.branch_id)
    let filteredRows = rows as OrderRow[];
    if (shipFromFilter) {
      filteredRows = filteredRows.filter(r =>
        (r.shipments || []).some((s: any) => s.branch_id === shipFromFilter)
      );
    }

    // 상담내역 검색 — 별도 쿼리로 customer_id 매칭 (상위 100건 상담 매치)
    if (consultSearch.trim()) {
      const q = consultSearch.trim();
      const consultRes = await sb
        .from('customer_consultations')
        .select('customer_id, content, created_at')
        .ilike('content', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(500);
      const matchedIds = new Set<string>((consultRes.data || []).map((c: any) => c.customer_id));
      const consultMap = new Map<string, string>();
      for (const c of (consultRes.data as any[]) || []) {
        if (!consultMap.has(c.customer_id)) {
          const text = typeof c.content === 'string' ? c.content : (c.content?.text || '');
          consultMap.set(c.customer_id, text.slice(0, 80));
        }
      }
      filteredRows = filteredRows.filter(r => r.customer && matchedIds.has(r.customer.id));
      for (const r of filteredRows) {
        if (r.customer && consultMap.has(r.customer.id)) {
          r._consultMatch = consultMap.get(r.customer.id) || null;
        }
      }
    }

    setOrders(filteredRows);
    setLoading(false);
  }, [startDate, endDate, branchFilter, paymentFilter, statusFilter, includeCancelled,
      handlerFilter, receiptStatusFilter, approvalStatusFilter, shipFromFilter, consultSearch,
      // 검색어 변경 시 날짜 필터 토글되므로 재페치 필요 — debouncedSearch 만 deps 에 포함 (타이핑마다 DB 호출 방지)
      debouncedSearch, productSearch, orderOptionSearch, recipientSearch, addressSearch]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // search 입력 → 400ms 후 debouncedSearch 반영 (DB 재호출 빈도 제한)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // 클라이언트 검색 (텍스트 기반 부가 조건)
  const filtered = useMemo(() => {
    const mainQ = search.trim().toLowerCase();
    const mainDigits = mainQ.replace(/[^0-9]/g, '');
    const prodQ = productSearch.trim().toLowerCase();
    const optQ = orderOptionSearch.trim().toLowerCase();
    const recQ = recipientSearch.trim().toLowerCase();
    const recDigits = recQ.replace(/[^0-9]/g, '');
    const addrQ = addressSearch.trim().toLowerCase();

    return orders.filter(o => {
      // 기본 검색
      if (mainQ) {
        const hit =
          o.order_number?.toLowerCase().includes(mainQ) ||
          o.customer?.name?.toLowerCase().includes(mainQ) ||
          (mainDigits && o.customer?.phone?.replace(/[^0-9]/g, '').includes(mainDigits)) ||
          o.memo?.toLowerCase().includes(mainQ);
        if (!hit) return false;
      }
      // 품목 검색 (품목명 or 코드)
      if (prodQ) {
        const hit = (o.items || []).some(it =>
          (it.product?.name || '').toLowerCase().includes(prodQ) ||
          (it.product?.code || '').toLowerCase().includes(prodQ)
        );
        if (!hit) return false;
      }
      // 주문옵션 검색
      if (optQ) {
        const hit = (o.items || []).some(it =>
          (it.order_option || '').toLowerCase().includes(optQ)
        );
        if (!hit) return false;
      }
      // 받는 분 검색 (이름·전화)
      if (recQ) {
        const hit = (o.shipments || []).some(s => {
          if ((s.recipient_name || '').toLowerCase().includes(recQ)) return true;
          if (recDigits && (s.recipient_phone || '').replace(/[^0-9]/g, '').includes(recDigits)) return true;
          return false;
        });
        if (!hit) return false;
      }
      // 주소 검색 (배송지)
      if (addrQ) {
        const hit = (o.shipments || []).some(s => {
          const addr = `${s.recipient_address || ''} ${s.recipient_address_detail || ''}`.toLowerCase();
          return addr.includes(addrQ);
        });
        if (!hit) return false;
      }
      return true;
    });
  }, [orders, search, productSearch, orderOptionSearch, recipientSearch, addressSearch]);

  // 활성 필터 카운트 (고급 검색 버튼 배지)
  const activeAdvancedCount = useMemo(() => {
    const checks = [
      consultSearch, productSearch, orderOptionSearch, recipientSearch, addressSearch,
      handlerFilter, shipFromFilter, receiptStatusFilter, approvalStatusFilter,
    ];
    return checks.filter(v => !!v && v !== '').length;
  }, [consultSearch, productSearch, orderOptionSearch, recipientSearch, addressSearch,
      handlerFilter, shipFromFilter, receiptStatusFilter, approvalStatusFilter]);

  const clearAdvanced = () => {
    setConsultSearch(''); setProductSearch(''); setOrderOptionSearch('');
    setRecipientSearch(''); setAddressSearch('');
    setHandlerFilter(''); setShipFromFilter('');
    setReceiptStatusFilter(''); setApprovalStatusFilter('');
  };

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
    const header = [
      '일자', '수령현황', '수령일자', '매출처', '출고처', '담당자',
      '고객명', '연락처', '주문번호',
      '품목', '수량', '합계', '결제수단', '승인', '결제정보',
      '받는 분', '받는 분 연락처', '받는 분 주소', '특이사항',
      '상담내역(고객)', '상태', '메모',
    ];
    const rows = filtered.map(o => {
      const firstShip = (o.shipments || [])[0];
      const shipFromBranch = firstShip?.branch_id
        ? (branches.find(b => b.id === firstShip.branch_id)?.name || '')
        : '';
      const itemNames = (o.items || []).map(it => it.product?.name || '').filter(Boolean);
      const itemLabel = itemNames.slice(0, 3).join(' / ') + (itemNames.length > 3 ? ` 외 ${itemNames.length - 3}` : '');
      const totalQty = (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
      return [
        (o.ordered_at || '').slice(0, 10),
        RECEIPT_STATUS_LABEL[o.receipt_status || 'RECEIVED'] || '',
        o.receipt_date || '',
        o.branch?.name || '',
        shipFromBranch,
        o.handler?.name || '',
        o.customer?.name || '',
        o.customer?.phone || '',
        o.order_number,
        itemLabel,
        totalQty,
        o.total_amount,
        PAY_LABEL[o.payment_method] || o.payment_method,
        APPROVAL_STATUS_LABEL[o.approval_status || 'COMPLETED'] || '',
        (o.payment_info || '').replace(/\n/g, ' '),
        firstShip?.recipient_name || '',
        firstShip?.recipient_phone || '',
        `${firstShip?.recipient_address || ''} ${firstShip?.recipient_address_detail || ''}`.trim(),
        (firstShip?.delivery_message || '').replace(/\n/g, ' '),
        (o._consultMatch || '').replace(/\n/g, ' '),
        STATUS_LABEL[o.status] || o.status,
        (o.memo || '').replace(/\n/g, ' '),
      ];
    });
    const csv = [header, ...rows].map(r => r.map(cell => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `판매조회_${startDate}_${endDate}.csv`;
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
          <button onClick={() => setShowCustomerLookup(true)}
            className="text-sm py-1.5 px-3 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            title="고객 이름·전화로 검색해 상담·구매(과거 포함) 이력 화면으로 이동">
            🔍 고객 찾기
          </button>
          <button onClick={handleCsv} disabled={filtered.length === 0}
            className="btn-secondary text-sm py-1.5 disabled:opacity-40">CSV 내보내기</button>
        </div>

        {/* 기본 필터 바 — 가장 빈번한 조회(고객명·전화·주문번호) */}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="고객명 · 전화번호 · 주문번호 · 메모 (입력 시 전체 기간 검색)"
            className="input text-sm py-1 flex-1 min-w-[240px]"
            title="검색어가 있으면 위 기간 필터를 무시하고 전체 기간에서 찾습니다"
          />
          {!isBranchUser && (
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input text-sm py-1 w-36">
              <option value="">전체 매출처</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} className="input text-sm py-1 w-28">
            <option value="">전체 결제</option>
            {(['cash', 'card', 'credit', 'cod', 'mixed'] as const).map(m =>
              <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm py-1 w-28">
            <option value="">전체 상태</option>
            <option value="COMPLETED">완료</option>
            <option value="PARTIALLY_REFUNDED">부분환불</option>
            <option value="REFUNDED">환불</option>
            <option value="CANCELLED">취소</option>
          </select>
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              showAdvanced || activeAdvancedCount > 0
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
            title="상담내역·품목·주문옵션·받는분·주소 등 정밀 검색"
          >
            🔍 검색 {activeAdvancedCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white text-blue-700 text-[10px] font-bold">{activeAdvancedCount}</span>
            )}
          </button>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 px-2">
            <input type="checkbox" checked={includeCancelled}
              onChange={e => setIncludeCancelled(e.target.checked)} className="w-4 h-4" />
            취소·환불 포함
          </label>
        </div>

        {/* 고급 검색 패널 (PDF 중요도 순) */}
        {showAdvanced && (
          <div className="mt-1 pt-3 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-600">정밀 검색</p>
              <div className="flex items-center gap-2">
                {activeAdvancedCount > 0 && (
                  <button onClick={clearAdvanced} className="text-xs text-red-500 hover:underline">조건 초기화</button>
                )}
                <span className="text-[11px] text-slate-400">중요도 순: 고객 → 상담 → 품목 → 주문옵션</span>
              </div>
            </div>
            {/* 중요도 1-2: 상담 · 품목 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">상담내역</span>
                <input
                  type="text"
                  value={consultSearch}
                  onChange={e => setConsultSearch(e.target.value)}
                  placeholder="상담 본문 키워드 (예: 혈압, 수면)"
                  className="input text-sm py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">품목</span>
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="품목명 · 코드"
                  className="input text-sm py-1"
                />
              </label>
            </div>
            {/* 중요도 3-4: 주문옵션 · 받는 분 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">주문옵션</span>
                <input
                  type="text"
                  value={orderOptionSearch}
                  onChange={e => setOrderOptionSearch(e.target.value)}
                  placeholder="예: 보자기, 택배 예정"
                  className="input text-sm py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">받는 분 / 연락처</span>
                <input
                  type="text"
                  value={recipientSearch}
                  onChange={e => setRecipientSearch(e.target.value)}
                  placeholder="수령인 이름 · 전화"
                  className="input text-sm py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">받는 분 주소</span>
                <input
                  type="text"
                  value={addressSearch}
                  onChange={e => setAddressSearch(e.target.value)}
                  placeholder="배송지 주소 키워드"
                  className="input text-sm py-1"
                />
              </label>
            </div>
            {/* 보조 필터: 출고처 · 담당자 · 수령/승인 상태 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">출고처</span>
                <select value={shipFromFilter} onChange={e => setShipFromFilter(e.target.value)} className="input text-sm py-1">
                  <option value="">전체</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">담당자</span>
                <select value={handlerFilter} onChange={e => setHandlerFilter(e.target.value)} className="input text-sm py-1">
                  <option value="">전체</option>
                  {staff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">수령현황</span>
                <select value={receiptStatusFilter} onChange={e => setReceiptStatusFilter(e.target.value)} className="input text-sm py-1">
                  <option value="">전체</option>
                  {(['RECEIVED', 'PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED'] as const).map(s =>
                    <option key={s} value={s}>{RECEIPT_STATUS_LABEL[s]}</option>
                  )}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">승인</span>
                <select value={approvalStatusFilter} onChange={e => setApprovalStatusFilter(e.target.value)} className="input text-sm py-1">
                  <option value="">전체</option>
                  {(['COMPLETED', 'CARD_PENDING', 'UNSETTLED'] as const).map(s =>
                    <option key={s} value={s}>{APPROVAL_STATUS_LABEL[s]}</option>
                  )}
                </select>
              </label>
            </div>
          </div>
        )}
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
          <button onClick={() => { setRefundOrderNumber(null); setShowRefundModal(true); }}
            className="text-sm text-red-600 hover:underline">환불 처리</button>
        </div>
        <div className="overflow-x-auto">
          <table className="table text-sm min-w-[1180px]">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="whitespace-nowrap">일자</th>
                <th className="whitespace-nowrap">수령</th>
                <th className="whitespace-nowrap">매출처</th>
                <th className="whitespace-nowrap">출고처</th>
                <th className="whitespace-nowrap">담당자</th>
                <th>고객 / 연락처</th>
                <th>품목</th>
                <th className="text-center">수량</th>
                <th className="text-right">합계</th>
                <th className="whitespace-nowrap">결제 / 승인</th>
                <th>받는 분 · 주소</th>
                <th>상담 · 옵션</th>
                <th className="whitespace-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="text-center py-10 text-slate-400">로딩 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={13} className="text-center py-10 text-slate-400">
                  조건에 맞는 판매 내역이 없습니다
                </td></tr>
              ) : filtered.map(o => {
                const isCancelled = o.status === 'CANCELLED';
                const isRefunded = o.status === 'REFUNDED' || o.status === 'PARTIALLY_REFUNDED';
                const shipFromId = o.shipments?.[0]?.branch_id;
                const shipFromName = shipFromId
                  ? (branches.find(b => b.id === shipFromId)?.name || '')
                  : '';
                const receiptKey = (o.receipt_status as keyof typeof RECEIPT_STATUS_LABEL) || 'RECEIVED';
                const approvalKey = (o.approval_status as keyof typeof APPROVAL_STATUS_LABEL) || 'COMPLETED';
                const items = o.items || [];
                const itemNames = items.map(it => it.product?.name).filter(Boolean) as string[];
                const totalQty = items.reduce((s, it) => s + (it.quantity || 0), 0);
                const firstShip = (o.shipments || [])[0];
                const optionBadges = items.map(it => it.order_option).filter(Boolean) as string[];
                return (
                  <tr
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${isCancelled || isRefunded ? 'opacity-60' : ''}`}
                  >
                    <td className="text-xs text-slate-600 whitespace-nowrap align-top">
                      <p>{(o.ordered_at || '').slice(0, 10)}</p>
                      <p className="text-[10px] text-slate-400">{(o.ordered_at || '').slice(11, 16)}</p>
                    </td>
                    <td className="whitespace-nowrap align-top">
                      <span className={`badge text-[10px] ${RECEIPT_STATUS_BADGE[receiptKey] || 'bg-slate-100 text-slate-600'}`}>
                        {RECEIPT_STATUS_LABEL[receiptKey] || '-'}
                      </span>
                      {o.receipt_date && <p className="text-[10px] text-slate-500 mt-0.5">{o.receipt_date}</p>}
                    </td>
                    <td className="text-xs text-slate-700 whitespace-nowrap align-top">{o.branch?.name || '-'}</td>
                    <td className="text-xs text-slate-700 whitespace-nowrap align-top">
                      {shipFromName ? (
                        shipFromId === o.branch?.id ? (
                          <span className="text-slate-400">동일</span>
                        ) : (
                          <span className="inline-flex items-center px-1 text-[10px] rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                            🚚 {shipFromName}
                          </span>
                        )
                      ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="text-xs text-slate-700 whitespace-nowrap align-top">{o.handler?.name || '-'}</td>
                    <td className="align-top">
                      {o.customer ? (
                        <div>
                          <p className="font-medium text-sm">{o.customer.name}</p>
                          <p className="text-[11px] text-slate-400">{o.customer.phone}</p>
                        </div>
                      ) : <span className="text-slate-300 text-xs">비회원</span>}
                    </td>
                    <td className="align-top">
                      {itemNames.length > 0 ? (
                        <div className="text-xs leading-tight">
                          <p className="text-slate-700 line-clamp-2" title={itemNames.join(', ')}>
                            {itemNames.slice(0, 2).join(' · ')}
                            {itemNames.length > 2 && <span className="text-slate-400"> 외 {itemNames.length - 2}</span>}
                          </p>
                          <p className="text-[10px] text-slate-400">{items.length}종</p>
                        </div>
                      ) : <span className="text-slate-300 text-xs">-</span>}
                    </td>
                    <td className="text-center text-xs text-slate-600 align-top">{totalQty || '-'}</td>
                    <td className={`text-right align-top ${isRefunded || isCancelled ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {(o.discount_amount || 0) > 0 ? (
                        <>
                          <p className="text-[10px] text-slate-400 line-through leading-tight">
                            {(o.total_amount || 0).toLocaleString()}원
                          </p>
                          <p className="font-semibold leading-tight">
                            {((o.total_amount || 0) - (o.discount_amount || 0)).toLocaleString()}원
                          </p>
                          <p className="text-[10px] text-orange-600 leading-tight">
                            -{(o.discount_amount || 0).toLocaleString()}
                          </p>
                        </>
                      ) : (
                        <p className="font-semibold">{(o.total_amount || 0).toLocaleString()}원</p>
                      )}
                    </td>
                    <td className="align-top whitespace-nowrap">
                      <p className="text-xs">{PAY_LABEL[o.payment_method] || o.payment_method}</p>
                      <span className={`badge text-[10px] mt-0.5 ${APPROVAL_STATUS_BADGE[approvalKey] || ''}`}>
                        {APPROVAL_STATUS_LABEL[approvalKey] || '-'}
                      </span>
                      {o.payment_method === 'credit' && o.credit_settled === false && (
                        <span className="ml-1 badge text-[10px] bg-orange-100 text-orange-700">외상 미정산</span>
                      )}
                    </td>
                    <td className="align-top">
                      {firstShip ? (
                        (() => {
                          const firstShipQuick =
                            firstShip.delivery_type === 'QUICK'
                            || (!firstShip.delivery_type && o.receipt_status === 'QUICK_PLANNED');
                          return (
                            <div className="text-xs leading-tight">
                              <p className="text-slate-700 flex items-center gap-1">
                                <span className={firstShipQuick ? 'text-indigo-600' : 'text-blue-600'}>
                                  {firstShipQuick ? '🛵' : '📦'}
                                </span>
                                {firstShip.recipient_name || '-'}
                              </p>
                              <p className="text-[10px] text-slate-400">{firstShip.recipient_phone || ''}</p>
                              <p className="text-[10px] text-slate-500 line-clamp-1" title={`${firstShip.recipient_address || ''} ${firstShip.recipient_address_detail || ''}`}>
                                {firstShip.recipient_address || ''}
                              </p>
                            </div>
                          );
                        })()
                      ) : <span className="text-slate-300 text-xs">-</span>}
                    </td>
                    <td className="align-top">
                      {(o._consultMatch || optionBadges.length > 0) ? (
                        <div className="space-y-1 text-[11px] max-w-[180px]">
                          {o._consultMatch && (
                            <p className="text-slate-600 line-clamp-2" title={o._consultMatch}>💬 {o._consultMatch}</p>
                          )}
                          {optionBadges.slice(0, 2).map((opt, i) => (
                            <span key={i} className="inline-block mr-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">🎀 {opt}</span>
                          ))}
                          {optionBadges.length > 2 && <span className="text-[10px] text-slate-400">+{optionBadges.length - 2}</span>}
                        </div>
                      ) : <span className="text-slate-300 text-xs">-</span>}
                    </td>
                    <td className="align-top">
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
          onRefundIntent={(orderNumber) => {
            setSelectedOrderId(null);
            setRefundOrderNumber(orderNumber);
            setShowRefundModal(true);
          }}
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
          initialOrderNumber={refundOrderNumber ?? undefined}
          onClose={() => { setShowRefundModal(false); setRefundOrderNumber(null); }}
          onSuccess={(rn) => {
            setShowRefundModal(false);
            setRefundOrderNumber(null);
            alert(`환불 완료 · ${rn}`);
            loadOrders();
          }}
        />
      )}

      {showCustomerLookup && (
        <CustomerLookupModal onClose={() => setShowCustomerLookup(false)} />
      )}
    </div>
  );
}

// ─── 고객 직접 검색 모달 — 신규 customers + legacy 고객 모두 검색 ──────────────
function CustomerLookupModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 디바운스
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced.trim()) { setResults([]); return; }
    setLoading(true);
    const params = new URLSearchParams();
    params.set('q', debounced.trim());
    params.set('page', '1');
    params.set('limit', '20');
    fetch(`/api/customers/search?${params.toString()}`)
      .then(r => r.json())
      .then(d => setResults(d.customers || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debounced]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-slate-800">고객 찾기 — 상담·구매(과거 포함) 이력 보기</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <div className="p-4 border-b">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="고객명 / 전화번호 / 주소 / 이메일"
            className="input w-full"
          />
          <p className="text-[11px] text-slate-400 mt-1.5">
            신규 등록 고객 + 과거 데이터 임포트 고객(레거시) 모두 검색됩니다.
            선택하면 상담 · 구매 · 과거 구매 이력이 통합된 상세 화면으로 이동합니다.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center py-8 text-slate-400 text-sm">검색 중...</div>
          ) : !debounced.trim() ? (
            <div className="text-center py-12 text-slate-400 text-sm">검색어를 입력하세요.</div>
          ) : results.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">검색 결과가 없습니다.</div>
          ) : (
            <ul className="space-y-1">
              {results.map((c: any) => (
                <li key={c.id}>
                  <button
                    onClick={() => { router.push(`/customers/${c.id}`); onClose(); }}
                    className="w-full text-left p-3 rounded-lg hover:bg-slate-50 border border-slate-200 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-slate-800">{c.name}</span>
                          {c.grade && c.grade !== 'NORMAL' && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.grade === 'VVIP' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                              {c.grade}
                            </span>
                          )}
                          {(c.legacy_purchase_count || 0) > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="과거 구매(legacy) 데이터 보유">
                              과거 {c.legacy_purchase_count}건
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
                        {c.address && (
                          <div className="text-xs text-slate-400 mt-0.5 truncate">{c.address}</div>
                        )}
                      </div>
                      <div className="text-right text-xs text-slate-500 whitespace-nowrap">
                        {(c.consultation_count || 0) > 0 && <div>상담 {c.consultation_count}건</div>}
                        {c.last_purchase_at && (
                          <div>
                            최근 구매: {String(c.last_purchase_at).slice(0, 10)}
                            {c.last_purchase_source === 'legacy' && <span className="ml-1 text-amber-600">(과거)</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
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
  onRefundIntent: (orderNumber: string) => void;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [shipment, setShipment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [markingReceipt, setMarkingReceipt] = useState(false);

  const handleCancelSale = async () => {
    if (!order) return;
    const isCard = ['card', 'card_keyin', 'kakao'].includes(order.payment_method);
    const cardWarning = isCard
      ? '\n\n⚠️ 카드 결제건입니다. 결제 단말기/PG에서 결제 취소를 별도로 진행해주세요.\n   본 처리는 ERP 데이터(매출·재고·포인트·분개)만 무릅니다.'
      : '';
    const shipped = (shipment?.status === 'SHIPPED' || shipment?.status === 'DELIVERED');
    const shipWarning = shipped
      ? '\n\n⚠️ 이미 배송된 건입니다. 일반적으로는 환불·반품으로 처리하는 것이 권장됩니다.'
      : '';
    const reason = window.prompt(
      `이 판매를 "취소" 처리하시겠습니까?\n\n` +
      `주문번호: ${order.order_number}\n` +
      `금액: ${Number(order.total_amount).toLocaleString()}원\n` +
      `결제수단: ${order.payment_method}` +
      cardWarning + shipWarning +
      `\n\n취소 사유를 입력하세요:`
    );
    if (!reason || !reason.trim()) return;

    setCancelling(true);
    const res = await cancelSalesOrder({ orderId: order.id, reason: reason.trim() });
    setCancelling(false);
    if ('error' in res && res.error) {
      alert(`취소 실패: ${res.error}`);
      return;
    }
    alert(`판매 취소 완료 · ${(res as any).orderNumber || order.order_number}`);
    onChanged();
    onClose();
  };
  const [changingDeliveryType, setChangingDeliveryType] = useState(false);
  const [markingItemId, setMarkingItemId] = useState<string | null>(null);

  // 품목별 수령 완료 처리 — 모든 품목이 RECEIVED가 되면 주문 레벨도 자동 완료
  const markItemReceived = async (itemId: string) => {
    if (markingItemId) return;
    setMarkingItemId(itemId);
    try {
      const sb = createClient() as any;
      const today = kstTodayString();
      const { error } = await sb
        .from('sales_order_items')
        .update({ receipt_status: 'RECEIVED', receipt_date: today })
        .eq('id', itemId);
      if (error) {
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('column') || msg.includes('receipt_status')) {
          alert('sales_order_items.receipt_status 컬럼이 없습니다.\nSupabase에 migration 052를 먼저 적용해 주세요.');
        } else {
          alert('품목 수령 처리 실패: ' + error.message);
        }
        return;
      }
      const nextItems = items.map(it => it.id === itemId
        ? { ...it, receipt_status: 'RECEIVED', receipt_date: today }
        : it);
      setItems(nextItems);
      // 전 품목 RECEIVED이면 주문 레벨 + shipments도 완료
      const allDone = nextItems.every(it => !it.receipt_status || it.receipt_status === 'RECEIVED');
      if (allDone) {
        await sb.from('sales_orders')
          .update({ receipt_status: 'RECEIVED', receipt_date: today })
          .eq('id', orderId);
        if (shipment?.id) {
          await sb.from('shipments').update({ status: 'DELIVERED' }).eq('id', shipment.id);
          setShipment((prev: any) => prev ? { ...prev, status: 'DELIVERED' } : prev);
        }
        setOrder((prev: any) => prev ? { ...prev, receipt_status: 'RECEIVED', receipt_date: today } : prev);
      }
      onChanged();
    } finally {
      setMarkingItemId(null);
    }
  };

  const markReceiptCompleted = async () => {
    if (markingReceipt) return;
    const wasQuick = order?.receipt_status === 'QUICK_PLANNED';
    const wasParcel = order?.receipt_status === 'PARCEL_PLANNED';
    const statusLabel = wasQuick ? '퀵 수령'
      : wasParcel ? '택배 수령'
      : order?.receipt_status === 'PICKUP_PLANNED' ? '방문 수령'
      : '수령';
    if (!confirm(`${statusLabel}을 완료 처리할까요?\n수령현황 → 수령완료, 수령일자 → 오늘`)) return;
    setMarkingReceipt(true);
    try {
      const sb = createClient() as any;
      const today = kstTodayString();
      const { error: orderErr } = await sb
        .from('sales_orders')
        .update({ receipt_status: 'RECEIVED', receipt_date: today })
        .eq('id', orderId);
      if (orderErr) {
        alert('수령 완료 처리 실패: ' + orderErr.message);
        setMarkingReceipt(false);
        return;
      }
      // 배송 레코드가 있다면 함께 DELIVERED로 갱신 +
      // receipt_status가 바뀌기 전에 퀵/택배 단서를 shipments.delivery_type에 고정
      if (shipment?.id) {
        const shipUpdate: any = { status: 'DELIVERED' };
        if (!shipment.delivery_type) {
          shipUpdate.delivery_type = wasQuick ? 'QUICK' : 'PARCEL';
        }
        const { error: shipErr } = await sb.from('shipments').update(shipUpdate).eq('id', shipment.id);
        // delivery_type 컬럼 부재(050 미적용)면 그 필드 없이 재시도
        if (shipErr) {
          const msg = String(shipErr.message || '').toLowerCase();
          if (msg.includes('delivery_type') || msg.includes('column')) {
            await sb.from('shipments').update({ status: 'DELIVERED' }).eq('id', shipment.id);
          }
        }
      }
      // 로컬 상태 반영
      setOrder((prev: any) => prev ? { ...prev, receipt_status: 'RECEIVED', receipt_date: today } : prev);
      if (shipment?.id) {
        setShipment((prev: any) => prev ? {
          ...prev,
          status: 'DELIVERED',
          delivery_type: prev.delivery_type || (wasQuick ? 'QUICK' : 'PARCEL'),
        } : prev);
      }
      onChanged();
    } finally {
      setMarkingReceipt(false);
    }
  };

  // 주문 레벨 수령상태 되돌리기 — RECEIVED → 예정 상태(PARCEL/QUICK/PICKUP)
  // 배송 정보에서 적절한 예정 상태를 추론하고, receipt_date를 비우며, 배송 레코드도 SHIPPED로 되돌림.
  const revertReceiptStatus = async () => {
    if (markingReceipt) return;
    // 추론: shipment.delivery_type이 있으면 그 값 기준, 없으면 PICKUP_PLANNED
    let target: 'PARCEL_PLANNED' | 'QUICK_PLANNED' | 'PICKUP_PLANNED' = 'PICKUP_PLANNED';
    if (shipment?.delivery_type === 'PARCEL') target = 'PARCEL_PLANNED';
    else if (shipment?.delivery_type === 'QUICK') target = 'QUICK_PLANNED';
    else if (shipment) target = 'PARCEL_PLANNED'; // 배송 레코드는 있는데 type 미지정 → 택배로 가정

    const targetLabel = target === 'PARCEL_PLANNED' ? '택배예정'
      : target === 'QUICK_PLANNED' ? '퀵예정' : '방문예정';
    if (!confirm(`수령 완료를 취소하고 "${targetLabel}"으로 되돌릴까요?\n수령일자가 비워지며, 배송 상태도 발송 단계로 복구됩니다.`)) return;
    setMarkingReceipt(true);
    try {
      const sb = createClient() as any;
      const { error: orderErr } = await sb
        .from('sales_orders')
        .update({ receipt_status: target, receipt_date: null })
        .eq('id', orderId);
      if (orderErr) {
        alert('수령 상태 되돌리기 실패: ' + orderErr.message);
        return;
      }
      // 품목 수령상태도 일괄 되돌림 — 각 품목의 delivery_type 기반으로 결정
      // (052 미적용 환경이면 컬럼 부재로 실패 → 무시)
      const itemUpdates = items
        .filter(it => it.receipt_status === 'RECEIVED')
        .map(it => {
          const dt = it.delivery_type || (target === 'PARCEL_PLANNED' ? 'PARCEL'
            : target === 'QUICK_PLANNED' ? 'QUICK' : 'PICKUP');
          const itemTarget = dt === 'PARCEL' ? 'PARCEL_PLANNED'
            : dt === 'QUICK' ? 'QUICK_PLANNED' : 'PICKUP_PLANNED';
          return sb.from('sales_order_items')
            .update({ receipt_status: itemTarget, receipt_date: null })
            .eq('id', it.id);
        });
      await Promise.all(itemUpdates).catch(() => {});

      // 배송 레코드: DELIVERED → SHIPPED(송장 있음) / PRINTED(송장 없는 발송완료) / PENDING으로 안전 복구
      if (shipment?.id && shipment.status === 'DELIVERED') {
        const nextShipStatus = shipment.tracking_number ? 'SHIPPED' : 'PENDING';
        await sb.from('shipments').update({ status: nextShipStatus }).eq('id', shipment.id);
        setShipment((prev: any) => prev ? { ...prev, status: nextShipStatus } : prev);
      }

      // 로컬 상태 반영
      setOrder((prev: any) => prev ? { ...prev, receipt_status: target, receipt_date: null } : prev);
      setItems(prevItems => prevItems.map(it => {
        if (it.receipt_status !== 'RECEIVED') return it;
        const dt = it.delivery_type || (target === 'PARCEL_PLANNED' ? 'PARCEL'
          : target === 'QUICK_PLANNED' ? 'QUICK' : 'PICKUP');
        const itemTarget = dt === 'PARCEL' ? 'PARCEL_PLANNED'
          : dt === 'QUICK' ? 'QUICK_PLANNED' : 'PICKUP_PLANNED';
        return { ...it, receipt_status: itemTarget, receipt_date: null };
      }));
      onChanged();
    } finally {
      setMarkingReceipt(false);
    }
  };

  // 품목 단건 수령상태 되돌리기 — RECEIVED → 해당 품목 delivery_type 기반 예정상태
  const revertItemReceived = async (itemId: string) => {
    if (markingItemId) return;
    const item = items.find(it => it.id === itemId);
    if (!item) return;
    const dt = item.delivery_type || 'PICKUP';
    const target: 'PARCEL_PLANNED' | 'QUICK_PLANNED' | 'PICKUP_PLANNED' =
      dt === 'PARCEL' ? 'PARCEL_PLANNED'
      : dt === 'QUICK' ? 'QUICK_PLANNED'
      : 'PICKUP_PLANNED';
    setMarkingItemId(itemId);
    try {
      const sb = createClient() as any;
      const { error } = await sb.from('sales_order_items')
        .update({ receipt_status: target, receipt_date: null })
        .eq('id', itemId);
      if (error) { alert('품목 수령 취소 실패: ' + error.message); return; }
      const nextItems = items.map(it => it.id === itemId
        ? { ...it, receipt_status: target, receipt_date: null }
        : it);
      setItems(nextItems);
      // 한 품목이라도 RECEIVED가 아니면 주문 레벨도 RECEIVED 해제
      if (order?.receipt_status === 'RECEIVED') {
        const orderTarget = (shipment?.delivery_type === 'QUICK') ? 'QUICK_PLANNED'
          : (shipment?.delivery_type === 'PARCEL') ? 'PARCEL_PLANNED'
          : target;
        await sb.from('sales_orders')
          .update({ receipt_status: orderTarget, receipt_date: null })
          .eq('id', orderId);
        setOrder((prev: any) => prev ? { ...prev, receipt_status: orderTarget, receipt_date: null } : prev);
        if (shipment?.id && shipment.status === 'DELIVERED') {
          const nextShipStatus = shipment.tracking_number ? 'SHIPPED' : 'PENDING';
          await sb.from('shipments').update({ status: nextShipStatus }).eq('id', shipment.id);
          setShipment((prev: any) => prev ? { ...prev, status: nextShipStatus } : prev);
        }
      }
      onChanged();
    } finally {
      setMarkingItemId(null);
    }
  };

  // 배송 유형(택배 ↔ 퀵) 수동 변경 — 레거시/오분류 보정
  const changeDeliveryType = async (next: 'PARCEL' | 'QUICK') => {
    if (!shipment?.id || changingDeliveryType) return;
    const label = next === 'QUICK' ? '퀵배송' : '택배';
    if (!confirm(`배송 유형을 ${label}로 변경할까요?`)) return;
    setChangingDeliveryType(true);
    try {
      const sb = createClient() as any;
      const { error } = await sb.from('shipments').update({ delivery_type: next }).eq('id', shipment.id);
      if (error) {
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('delivery_type') || msg.includes('column')) {
          alert('shipments.delivery_type 컬럼이 없습니다.\nSupabase에 migration 050을 먼저 적용해 주세요.');
        } else {
          alert('배송 유형 변경 실패: ' + error.message);
        }
        return;
      }
      setShipment((prev: any) => prev ? { ...prev, delivery_type: next } : prev);
      onChanged();
    } finally {
      setChangingDeliveryType(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const sb = createClient() as any;
      const [ordRes, itemRes, payRes, shipRes] = await Promise.all([
        (async () => {
          const full = await sb.from('sales_orders')
            .select(`
              id, order_number, ordered_at, status, total_amount, discount_amount,
              payment_method, points_earned, points_used, credit_settled, memo,
              approval_no, card_info,
              receipt_status, receipt_date, approval_status, payment_info,
              handler:users!sales_orders_ordered_by_fkey(id, name),
              branch:branches(id, name),
              customer:customers(id, name, phone)
            `)
            .eq('id', orderId).single();
          if (!full.error) return full;
          // 051 미적용·join 실패 폴백
          return await sb.from('sales_orders')
            .select(`
              id, order_number, ordered_at, status, total_amount, discount_amount,
              payment_method, points_earned, points_used, credit_settled, memo,
              approval_no, card_info,
              branch:branches(id, name),
              customer:customers(id, name, phone)
            `)
            .eq('id', orderId).single();
        })(),
        (async () => {
          // 052 적용: delivery_type, receipt_status, receipt_date 포함
          const full = await sb.from('sales_order_items')
            .select('id, quantity, unit_price, discount_amount, total_price, order_option, delivery_type, receipt_status, receipt_date, product:products(id, name, code, unit)')
            .eq('sales_order_id', orderId).order('id');
          if (!full.error) return full;
          // 051만 적용
          const v051 = await sb.from('sales_order_items')
            .select('id, quantity, unit_price, discount_amount, total_price, order_option, product:products(id, name, code, unit)')
            .eq('sales_order_id', orderId).order('id');
          if (!v051.error) return v051;
          // 051/052 모두 미적용
          return await sb.from('sales_order_items')
            .select('id, quantity, unit_price, discount_amount, total_price, product:products(id, name, code, unit)')
            .eq('sales_order_id', orderId).order('id');
        })(),
        sb.from('sales_order_payments')
          .select('id, payment_method, amount, approval_no, card_info, memo, paid_at')
          .eq('sales_order_id', orderId).order('paid_at').then((r: any) => r.error ? { data: [] } : r),
        (async () => {
          // 마이그 050(delivery_type) + 046(sender_*) 모두 적용된 전체 셀렉트
          const full = await sb.from('shipments')
            .select(`
              id, source, delivery_type, status, tracking_number, branch_id,
              sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail,
              recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail,
              delivery_message, created_at,
              branch:branches(id, name)
            `)
            .eq('sales_order_id', orderId).maybeSingle();
          if (!full.error) return full;
          // delivery_type 미적용(050 없음) — 046은 있다고 가정하고 시도
          const noType = await sb.from('shipments')
            .select(`
              id, source, status, tracking_number, branch_id,
              sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail,
              recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail,
              delivery_message, created_at,
              branch:branches(id, name)
            `)
            .eq('sales_order_id', orderId).maybeSingle();
          if (!noType.error) return noType;
          // 046도 미적용
          const fallback = await sb.from('shipments')
            .select(`
              id, source, status, tracking_number, branch_id,
              sender_name, sender_phone,
              recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail,
              delivery_message, created_at,
              branch:branches(id, name)
            `)
            .eq('sales_order_id', orderId).maybeSingle();
          return fallback.error ? { data: null } : fallback;
        })(),
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
                <p className="text-[11px] text-slate-500">매출처</p>
                <p>{order.branch?.name || '-'}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">담당자</p>
                <p>{order.handler?.name || '-'}</p>
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
                <div className="flex flex-wrap gap-1">
                  <span className={`badge text-[10px] ${STATUS_BADGE[order.status] || ''}`}>
                    {STATUS_LABEL[order.status] || order.status}
                  </span>
                  {order.approval_status && order.approval_status !== 'COMPLETED' && (
                    <span className={`badge text-[10px] ${
                      order.approval_status === 'UNSETTLED' ? 'bg-amber-100 text-amber-700'
                      : 'bg-indigo-100 text-indigo-700'
                    }`}>
                      {order.approval_status === 'UNSETTLED' ? '미결' : '미승인(카드)'}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">수령</p>
                <p className="flex items-center gap-1.5">
                  <span className={`badge text-[10px] ${
                    !order.receipt_status || order.receipt_status === 'RECEIVED' ? 'bg-green-100 text-green-700'
                    : order.receipt_status === 'PARCEL_PLANNED' ? 'bg-blue-100 text-blue-700'
                    : order.receipt_status === 'QUICK_PLANNED' ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-slate-100 text-slate-600'
                  }`}>
                    {!order.receipt_status ? '수령완료'
                     : order.receipt_status === 'RECEIVED' ? '수령완료'
                     : order.receipt_status === 'PICKUP_PLANNED' ? '방문예정'
                     : order.receipt_status === 'QUICK_PLANNED' ? '퀵예정'
                     : '택배예정'}
                  </span>
                  {order.receipt_date && <span className="text-[11px] text-slate-500">{order.receipt_date}</span>}
                </p>
              </div>
            </div>

            {/* 결제정보 (자유기입) */}
            {order.payment_info && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-sm">
                <p className="text-[11px] font-semibold text-slate-500 mb-1">결제 정보</p>
                <p className="text-slate-700 whitespace-pre-wrap">{order.payment_info}</p>
              </div>
            )}

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
                      <th className="text-left px-3 py-1.5">주문 옵션</th>
                      <th className="text-left px-3 py-1.5">배송</th>
                      <th className="text-left px-3 py-1.5">수령</th>
                      <th className="text-right px-3 py-1.5">수량</th>
                      <th className="text-right px-3 py-1.5">단가</th>
                      <th className="text-right px-3 py-1.5">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => {
                      const itemDType = it.delivery_type || 'PICKUP';
                      const itemRStatus = it.receipt_status || 'RECEIVED';
                      const itemPending = itemRStatus !== 'RECEIVED' && order.status === 'COMPLETED';
                      const dTypeLabel = itemDType === 'PARCEL' ? '📦 택배'
                        : itemDType === 'QUICK' ? '🛵 퀵'
                        : '🏠 현장';
                      const dTypeColor = itemDType === 'PARCEL' ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : itemDType === 'QUICK' ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200';
                      const rLabel = itemRStatus === 'RECEIVED' ? '수령완료'
                        : itemRStatus === 'PARCEL_PLANNED' ? '택배예정'
                        : itemRStatus === 'QUICK_PLANNED' ? '퀵예정'
                        : '방문예정';
                      const rColor = itemRStatus === 'RECEIVED' ? 'bg-green-100 text-green-700'
                        : itemRStatus === 'PARCEL_PLANNED' ? 'bg-blue-100 text-blue-700'
                        : itemRStatus === 'QUICK_PLANNED' ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-slate-100 text-slate-600';
                      return (
                        <tr key={it.id} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">
                            <p className="font-medium">{it.product?.name || '-'}</p>
                            <p className="text-[11px] text-slate-400 font-mono">{it.product?.code}</p>
                          </td>
                          <td className="px-3 py-1.5 text-xs text-indigo-700">
                            {it.order_option ? (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-100">
                                🎀 {it.order_option}
                              </span>
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dTypeColor}`}>
                              {dTypeLabel}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${rColor}`}>
                                {rLabel}
                              </span>
                              {itemPending && (
                                <button
                                  onClick={() => markItemReceived(it.id)}
                                  disabled={markingItemId === it.id}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                  title={`${rLabel} 품목 수령 완료`}
                                >
                                  {markingItemId === it.id ? '...' : '✓ 완료'}
                                </button>
                              )}
                              {itemRStatus === 'RECEIVED' && order.status === 'COMPLETED' && (
                                <button
                                  onClick={() => revertItemReceived(it.id)}
                                  disabled={markingItemId === it.id}
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                  title="이 품목의 수령 완료를 취소하고 예정 상태로 되돌립니다"
                                >
                                  {markingItemId === it.id ? '...' : '↩ 취소'}
                                </button>
                              )}
                            </div>
                            {it.receipt_date && (
                              <p className="text-[10px] text-slate-400 mt-0.5">{it.receipt_date}</p>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">{it.quantity}</td>
                          <td className="px-3 py-1.5 text-right">{Number(it.unit_price).toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right font-medium">{Number(it.total_price).toLocaleString()}</td>
                        </tr>
                      );
                    })}
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
              {order.payment_method === 'credit' && order.credit_settled === false && (
                <p className="mt-1 text-xs text-orange-600 font-medium">⚠ 외상 정산 대기</p>
              )}
            </div>

            {/* 배송 (택배 / 퀵 구분) */}
            {shipment && (() => {
              // 050 미적용 환경 대응: delivery_type 없으면 receipt_status로 추론, 그것도 없으면 택배로 가정
              const isQuick =
                shipment.delivery_type === 'QUICK'
                || (!shipment.delivery_type && order.receipt_status === 'QUICK_PLANNED');
              const headerLabel = isQuick ? '퀵배송' : '택배';
              const headerIcon = isQuick ? '🛵' : '📦';
              const headerColor = isQuick
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-blue-50 border-blue-200 text-blue-700';
              // 퀵은 송장·인쇄 단계가 없음 — 상태 라벨 맵 분기
              const statusLabel = isQuick
                ? (shipment.status === 'DELIVERED' ? '수령완료'
                   : shipment.status === 'SHIPPED' ? '출발'
                   : '대기')
                : (shipment.status === 'DELIVERED' ? '배달완료'
                   : shipment.status === 'SHIPPED' ? '발송완료'
                   : shipment.status === 'PRINTED' ? '송장인쇄'
                   : '발송대기');
              const statusBadge =
                shipment.status === 'DELIVERED' ? 'bg-green-100 text-green-700'
                : shipment.status === 'SHIPPED' ? 'bg-blue-100 text-blue-700'
                : 'bg-slate-100 text-slate-600';
              return (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-semibold text-slate-700">{headerIcon} {headerLabel}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${headerColor}`}>
                      {headerLabel}
                    </span>
                    {!shipment.delivery_type && (
                      <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                        title="shipments.delivery_type이 비어있어 receipt_status로 추론한 값입니다.">
                        ⚠ 추론
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => changeDeliveryType(isQuick ? 'PARCEL' : 'QUICK')}
                      disabled={changingDeliveryType}
                      className="ml-auto text-[11px] text-slate-400 hover:text-slate-700 underline disabled:opacity-50"
                      title={`${isQuick ? '택배' : '퀵배송'}로 변경`}
                    >
                      {changingDeliveryType ? '변경 중...' : `${isQuick ? '📦 택배' : '🛵 퀵'}로 변경`}
                    </button>
                  </div>
                  <div className={`p-3 rounded-md border text-sm space-y-1 ${isQuick ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200'}`}>
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
                    {shipment.delivery_message && (
                      <p className="text-xs text-slate-500">
                        {isQuick ? '퀵 기사 전달' : '배송'} 메시지: {shipment.delivery_message}
                      </p>
                    )}
                    {/* 퀵은 보내는 분 일반적으로 불필요 — 택배만 표시 */}
                    {!isQuick && shipment.sender_name && (
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
                      <span className={`badge text-[10px] ${statusBadge}`}>{statusLabel}</span>
                      {/* 송장번호는 택배만 */}
                      {!isQuick && shipment.tracking_number && (
                        <span className="font-mono text-slate-500">{shipment.tracking_number}</span>
                      )}
                      {isQuick && (
                        <span className="text-[10px] text-indigo-500">※ 퀵은 송장 없음 — 인편 직접 배송</span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* 액션 */}
            <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
              {/* 수령 완료 처리 — 예정 상태일 때만 노출 */}
              {order.receipt_status && order.receipt_status !== 'RECEIVED' && order.status === 'COMPLETED' && (
                <button
                  onClick={markReceiptCompleted}
                  disabled={markingReceipt}
                  className="flex-1 min-w-[140px] py-2 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  title={`${order.receipt_status === 'QUICK_PLANNED' ? '퀵' : order.receipt_status === 'PARCEL_PLANNED' ? '택배' : '방문'} 수령 완료 처리`}
                >
                  {markingReceipt ? '처리 중...'
                    : `✓ ${order.receipt_status === 'QUICK_PLANNED' ? '퀵' : order.receipt_status === 'PARCEL_PLANNED' ? '택배' : '방문'} 수령 완료`}
                </button>
              )}
              {/* 수령 취소 — RECEIVED 상태에서 예정 단계로 되돌림 */}
              {order.receipt_status === 'RECEIVED' && order.status === 'COMPLETED' && (
                <button
                  onClick={revertReceiptStatus}
                  disabled={markingReceipt}
                  className="flex-1 min-w-[140px] py-2 text-sm rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  title="수령 완료를 취소하고 예정 상태로 되돌립니다"
                >
                  {markingReceipt ? '처리 중...' : '↩ 수령 취소 (예정으로 되돌리기)'}
                </button>
              )}
              <button onClick={handleReprint}
                className="flex-1 min-w-[120px] btn-secondary py-2 text-sm">영수증 재발행</button>
              <button
                onClick={() => {
                  // 전표 복사 → POS 페이지로 이동 (copy_from 쿼리)
                  window.location.href = `/pos?copy=${order.id}`;
                }}
                className="flex-1 min-w-[120px] py-2 text-sm rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                title="수령현황·날짜만 변경하여 새 판매 전표를 생성합니다"
              >
                📋 전표 복사
              </button>
              {(order.status === 'COMPLETED' || order.status === 'PARTIALLY_REFUNDED') && (
                <button onClick={() => onRefundIntent(order.order_number)}
                  className="flex-1 min-w-[120px] py-2 text-sm rounded-md border border-red-200 text-red-600 hover:bg-red-50">
                  환불 처리
                </button>
              )}
              {order.status === 'COMPLETED' && (
                <button onClick={() => handleCancelSale()}
                  disabled={cancelling}
                  className="flex-1 min-w-[120px] py-2 text-sm rounded-md border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  title="거래 자체를 취소합니다 (잘못 등록한 건). 환불과 달리 매출 자체를 역분개합니다.">
                  {cancelling ? '취소 중...' : '🚫 판매 취소'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
