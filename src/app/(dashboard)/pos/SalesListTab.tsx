'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ReceiptModal from './ReceiptModal';
import RefundModal from './RefundModal';
import { fmtDateKST, fmtTimeKST, fmtDateTimeKST, kstTodayString, kstDayStart, kstDayEnd } from '@/lib/date';
import { cancelSalesOrder } from '@/lib/sales-cancel-actions';
import { addSalesOrderItem, removeSalesOrderItem, updateSalesOrderItem, convertOrderToParcel, convertOrderToPickup, updateSalesOrderDetails, changeSalesOrderShipFromBranch } from '@/lib/sales-revise-actions';
import { bulkUpdateReceiptStatus } from '@/lib/shipping-actions';
import { settleSalesOrderReceivable } from '@/lib/accounting-actions';
import { useEscClose } from '@/hooks/useEscClose';

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
  item_text?: string | null;
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
  channel?: string | null;   // 자사몰(ONLINE)·STORE 등 — 택배 아이콘 영구 신호(#43)
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
  buyer_name?: string | null;   // 자사몰 주문자 스냅샷 (customer 미연결 시 표시)
  buyer_phone?: string | null;
  recipient_name?: string | null;          // 카페24 받는분 스냅샷 (shipment 없을 때 표시·검색·CSV)
  recipient_phone?: string | null;
  recipient_zipcode?: string | null;
  recipient_address?: string | null;
  recipient_address_detail?: string | null;
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
  COMPLETED: 'bg-slate-100 text-slate-500',   // 완료 = 낮은 강조(회색)
  CANCELLED: 'bg-slate-100 text-slate-400',
  REFUNDED: 'bg-red-100 text-red-600',
  PARTIALLY_REFUNDED: 'bg-amber-100 text-amber-700',
};
const PAY_LABEL: Record<string, string> = {
  cash: '현금', card: '카드', card_keyin: '카드(키인)', kakao: '카카오',
  credit: '외상', cod: '수령시수금', mixed: '복합',
};
const RECEIPT_STATUS_LABEL: Record<string, string> = {
  RECEIVED: '수령완료', PICKUP_PLANNED: '방문예정', QUICK_PLANNED: '퀵예정', PARCEL_PLANNED: '택배예정',
};
// 수령현황 열 = 수령 처리 단계만(#57). 배송 진행상태(발송완료/배송완료/출력완료)는 택배관리 화면 담당.
//   내부 값 RECEIVED → 표시 '수령완료'(상세 드로어 라벨과 일관). NULL 은 수령완료로 폴백(빈칸 금지).
function receiptStatusLabelFor(status: string | null | undefined): string {
  const st = status || 'RECEIVED';
  return RECEIPT_STATUS_LABEL[st] || '-';
}
// 색상 기준(#24): 완료=낮은 강조(회색), 확인·처리 필요(예정)=강조.
const RECEIPT_STATUS_BADGE: Record<string, string> = {
  RECEIVED: 'bg-slate-100 text-slate-500',          // 수령완료 = 회색(낮음)
  PICKUP_PLANNED: 'bg-pink-100 text-pink-700',      // 방문예정 = 강조(임박 응대). 발송완료(amber)와 구분 위해 pink
  QUICK_PLANNED: 'bg-purple-100 text-purple-700',   // 퀵예정 = 강조
  PARCEL_PLANNED: 'bg-blue-100 text-blue-700',      // 택배예정 = 강조
};
// 발송축(#55) — shipments.status 단일진실원천의 읽기전용 보조표시. 수령축(receipt_status)을 덮어쓰지 않는다(#57 규칙 유지).
//   라벨은 shipping/page.tsx STATUS_LABEL 과 동일 문구(중복 정의, 출처 명시). 발송=중립 슬레이트 색으로 수령배지와 시각 구분.
//   PRINTED/SHIPPED 만 보조배지 노출(필수). PENDING(대기중)·shipment 없음·방문/퀵은 미표시(노이즈 방지).
//   DELIVERED 는 receipt 가 이미 RECEIVED 로 종결되므로 중복 회피 위해 보조배지 생략.
const SHIP_STAGE_LABEL: Record<string, string> = {
  PRINTED: '출력완료', SHIPPED: '발송완료',
};
const APPROVAL_STATUS_LABEL: Record<string, string> = {
  COMPLETED: '결제완료', CARD_PENDING: '미승인(카드)', UNSETTLED: '미수금',
};
const APPROVAL_STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'bg-slate-100 text-slate-500 border border-slate-200',     // 결제완료 = 회색(낮음)
  CARD_PENDING: 'bg-amber-100 text-amber-800 border border-amber-300',  // 미승인(카드) = 강조
  UNSETTLED: 'bg-red-100 text-red-700 border border-red-300',           // 미결 = 강한 강조(미수금)
};

// KST "YYYY-MM-DD". 클라이언트 실행이지만 사용자 TZ에 의존하지 않도록 KST 고정.
function fmtDate(d: Date): string {
  return fmtDateKST(d);
}
function todayStr(): string { return kstTodayString(); }
// 매출 통일 기준(#18) — 고객 실결제 = total_amount(상품총액·할인 전) − discount_amount.
//   POS/백화점=총액 gross 저장, cafe24 웹훅=gross 저장(할인 별도), legacy=할인 없는 net.
//   할인·포인트·쿠폰을 별도 매출로 분리하지 않고 '최종 결제금액' 하나로 집계·표시한다.
function netSales(o: { total_amount?: number | null; discount_amount?: number | null }): number {
  return (o.total_amount || 0) - (o.discount_amount || 0);
}
// ISO(timestamptz) ↔ datetime-local(KST 벽시계 'YYYY-MM-DDTHH:mm') 변환 — 전표 판매일시 수정용(#23)
function isoToKstLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);
}
function kstLocalToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(`${local}:00+09:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return fmtDateKST(d);
}

type Period = 'today' | '7d' | '30d' | 'custom';

// 새로고침 생존용 조회조건 영속화 (localStorage 'salesList.filters').
// branchFilter는 복원 시 isBranchUser 가드를 별도 적용 — 여기선 단순 저장/로드만.
interface PersistedFilters {
  period: Period;
  startDate: string;
  endDate: string;
  search: string;
  branchFilter: string;
  paymentFilter: string;
  statusFilter: string;
  subView: 'list' | 'compare';
  listSort: 'order' | 'receipt';
  receiptStatusFilter: string;
  approvalStatusFilter: string;
  includeCancelled: boolean;
  showAdvanced: boolean;
  consultSearch: string;
  productSearch: string;
  orderOptionSearch: string;
  recipientSearch: string;
  addressSearch: string;
  handlerFilter: string;
  shipFromFilter: string;
  hideReceived: boolean;
  offlineOnly: boolean;
}

function readSalesFilters(): Partial<PersistedFilters> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('salesList.filters');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default function SalesListTab({ forcedView }: { forcedView?: 'list' | 'compare' } = {}) {
  const router = useRouter();
  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  // 새로고침 복원값 1회 로드 (lazy-init 폴백용)
  const saved = readSalesFilters();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>(() => saved.period ?? 'today');
  const [startDate, setStartDate] = useState(() => saved.startDate ?? todayStr());
  const [endDate, setEndDate] = useState(() => saved.endDate ?? todayStr());

  // 기본(축약) 필터
  // 지점 사용자는 저장값 무시하고 자기 지점 고정 (지점 잠금 침해 방지)
  const [branchFilter, setBranchFilter] = useState(() =>
    isBranchUser ? (userBranchId ?? '') : (saved.branchFilter ?? ''));
  const [paymentFilter, setPaymentFilter] = useState<string>(() => saved.paymentFilter ?? '');
  const [statusFilter, setStatusFilter] = useState<string>(() => saved.statusFilter ?? '');
  const [search, setSearch] = useState(() => saved.search ?? '');                  // 고객명·전화·주문번호·메모 통합
  const [debouncedSearch, setDebouncedSearch] = useState(() => saved.search ?? ''); // loadOrders 트리거용 debounced 값 (복원 search로 seed)
  const [includeCancelled, setIncludeCancelled] = useState(() => saved.includeCancelled ?? true);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);

  // 고급 검색 필터 (PDF 중요도 순 상위 먼저 노출)
  const [showAdvanced, setShowAdvanced] = useState(() => saved.showAdvanced ?? false);
  const [consultSearch, setConsultSearch] = useState(() => saved.consultSearch ?? '');     // 상담내역
  const [productSearch, setProductSearch] = useState(() => saved.productSearch ?? '');     // 품목
  const [orderOptionSearch, setOrderOptionSearch] = useState(() => saved.orderOptionSearch ?? ''); // 주문옵션
  const [recipientSearch, setRecipientSearch] = useState(() => saved.recipientSearch ?? ''); // 받는 분
  const [addressSearch, setAddressSearch] = useState(() => saved.addressSearch ?? '');     // 주소
  const [handlerFilter, setHandlerFilter] = useState(() => saved.handlerFilter ?? '');     // 담당자
  const [shipFromFilter, setShipFromFilter] = useState(() => saved.shipFromFilter ?? '');   // 출고처
  const [receiptStatusFilter, setReceiptStatusFilter] = useState(() => saved.receiptStatusFilter ?? '');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState(() => saved.approvalStatusFilter ?? '');
  // 미결 건만 보기 — 수령완료·배송완료(RECEIVED) 숨김. 담당자가 처리할 건만 직관 파악.
  const [hideReceived, setHideReceived] = useState(() => saved.hideReceived ?? false);
  // 오프라인 매장만 — 온라인몰(channel='ONLINE') 주문을 통합 리스트에서 숨김(#48 P3).
  //   ※ 별도 '온라인몰' 뷰가 ONLINE만 보는 것과 반대 방향(여기선 ONLINE 제외 토글).
  const [offlineOnly, setOfflineOnly] = useState(() => saved.offlineOnly ?? false);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundOrderNumber, setRefundOrderNumber] = useState<string | null>(null);
  const [reprintReceipt, setReprintReceipt] = useState<any>(null);

  // 서브뷰: 목록 ↔ 지점비교 (본사/관리자 전용). 지점비교는 기간 행 × 지점 열 매트릭스.
  //   forcedView 가 주어지면(판매현황=list / 지점별매출 탭=compare) 그 뷰로 고정하고 토글 숨김.
  const [subView, setSubView] = useState<'list' | 'compare'>(() => forcedView ?? saved.subView ?? 'list');
  // 일자별 요약 표시 토글 — 기본 숨김(고객별 내역 우선, 일자별 요약은 옵션)
  const [showDailySummary, setShowDailySummary] = useState(false);
  // 목록 정렬 토글: 'order'=주문일순(현행 flat) / 'receipt'=수령일자별 그룹
  const [listSort, setListSort] = useState<'order' | 'receipt'>(() => saved.listSort ?? 'receipt');
  // #38 수령상태 일괄변경 — 수령현황 뷰 다중선택
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<'RECEIVED'>('RECEIVED');
  const [bulkSaving, setBulkSaving] = useState(false);
  // 비교뷰 전용 다수선택 상태 — 기존 단일 branchFilter 와 독립. 기본값은 전체 active 지점.
  const [compareBranchIds, setCompareBranchIds] = useState<string[]>([]);
  // RPC branch_sales_summary 반환형 — legacy(<2026-05-19)+sales(>=2026-05-19) 통합 집계 행.
  const [compareRows, setCompareRows] = useState<{ period_date: string; branch_id: string | null; total: number }[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  // 집계 단위 — 일/월/연. 기본 'month'.
  const [compareGrain, setCompareGrain] = useState<'day' | 'month' | 'year'>('month');
  // compare 진입 시 기본기간(올해 1/1~오늘) 1회 세팅 가드.
  const [compareInit, setCompareInit] = useState(false);

  // 조회조건 변경 시 localStorage 저장 → 새로고침 후 복원. (compare 파생/모달/로딩 상태는 제외)
  useEffect(() => {
    try {
      const payload: PersistedFilters = {
        period, startDate, endDate, search,
        branchFilter, paymentFilter, statusFilter,
        subView, listSort, receiptStatusFilter, approvalStatusFilter,
        includeCancelled, showAdvanced, consultSearch, productSearch,
        orderOptionSearch, recipientSearch, addressSearch, handlerFilter, shipFromFilter,
        hideReceived, offlineOnly,
      };
      localStorage.setItem('salesList.filters', JSON.stringify(payload));
    } catch {}
  }, [period, startDate, endDate, search, branchFilter, paymentFilter, statusFilter,
      subView, listSort, receiptStatusFilter, approvalStatusFilter, includeCancelled,
      showAdvanced, consultSearch, productSearch, orderOptionSearch, recipientSearch, hideReceived,
      addressSearch, handlerFilter, shipFromFilter, offlineOnly]);

  // 초기 — 지점·직원 목록
  useEffect(() => {
    const sb = createClient() as any;
    // 매출처 콤보·지점별 매출은 코드관리 지점관리와 일치해야 함 → 전 지점 로드(비활성 포함).
    //   판매전표가 비활성 지점(예: 롯데몰)을 매출처로 가질 수 있어 활성 필터 시 콤보에서 누락됨.
    sb.from('branches').select('id, name, code, channel, sort_order, is_active').order('sort_order').order('name')
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
        id, order_number, ordered_at, channel, status, total_amount, discount_amount,
        payment_method, points_earned, points_used, credit_settled, memo,
        approval_no, card_info,
        receipt_status, receipt_date, approval_status, payment_info,
        recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail,
        branch:branches(id, name),
        customer:customers(id, name, phone),
        buyer_name, buyer_phone,
        handler:users!sales_orders_ordered_by_fkey(id, name),
        items:sales_order_items(id, quantity, unit_price, total_price, order_option, item_text, product:products(id, name, code))
      ` : `
        id, order_number, ordered_at, status, total_amount, discount_amount,
        payment_method, points_earned, points_used, credit_settled, memo,
        approval_no, card_info,
        branch:branches(id, name),
        customer:customers(id, name, phone),
        buyer_name, buyer_phone,
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
        // 미결만 보기: 수령완료(RECEIVED) 제외. NULL(수령상태 미설정)은 미결로 간주해 노출.
        if (hideReceived) q = q.or('receipt_status.is.null,receipt_status.neq.RECEIVED');
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
      debouncedSearch, productSearch, orderOptionSearch, recipientSearch, addressSearch, hideReceived]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // 비교뷰 지점 선택 초기화 — branches 로드되면 활성 지점만 기본 선택(비활성 매출처는 콤보엔 있되 비교 기본에선 제외해 컬럼 정돈).
  useEffect(() => {
    setCompareBranchIds(branches.filter(b => (b as any).is_active !== false).map(b => b.id));
  }, [branches]);

  // 일수 차이 (day grain 가드용). 둘 다 'YYYY-MM-DD' KST 일자 문자열.
  const compareDaySpan = useMemo(() => {
    const a = Date.parse(`${startDate}T00:00:00Z`);
    const b = Date.parse(`${endDate}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.round((b - a) / 86400000);
  }, [startDate, endDate]);

  // 지점비교 집계 로드 — RPC branch_sales_summary 1회 호출 (legacy+sales 통합, grain별 집계).
  // 지점 선택 필터는 클라이언트(compareMatrix)에서 처리 — RPC 는 전 지점 반환.
  const loadCompare = useCallback(async () => {
    // day grain 가드: 기간 366일 초과면 폭주 방지로 조회 차단.
    if (compareGrain === 'day' && compareDaySpan > 366) {
      setCompareRows([]);
      setCompareError('일별 조회는 366일 이내에서만 가능합니다. 기간을 줄이거나 월/연 단위를 선택하세요.');
      return;
    }
    setCompareLoading(true);
    setCompareError(null);
    const sb = createClient() as any;
    const { data, error } = await sb.rpc('branch_sales_summary', {
      p_from: startDate,
      p_to: endDate,
      p_grain: compareGrain,
    });
    if (error) {
      console.error('[SalesListTab] compare rpc error:', error);
      setCompareRows([]);
      setCompareError('지점별 매출 집계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setCompareLoading(false);
      return;
    }
    const rows = ((data as any[]) || []).map(r => ({
      period_date: String(r.period_date),
      branch_id: r.branch_id ?? null,
      total: Number(r.total) || 0,
    }));
    setCompareRows(rows);
    setCompareLoading(false);
  }, [startDate, endDate, compareGrain, compareDaySpan]);

  // 비교뷰 진입 시에만 페치 (목록 진입 시 불필요 페치 금지).
  useEffect(() => {
    if (subView === 'compare') loadCompare();
  }, [subView, loadCompare]);

  // compare 최초 진입 시 기본기간(올해 1/1~오늘)·월 단위로 1회 세팅. 사용자가 이미 바꿨으면 덮지 않음.
  useEffect(() => {
    if (subView === 'compare' && !compareInit) {
      const year = kstTodayString().slice(0, 4);
      setStartDate(`${year}-01-01`);
      setEndDate(kstTodayString());
      setPeriod('custom');
      setCompareInit(true);
    }
  }, [subView, compareInit]);

  // 매트릭스 빌드 — rows=기간(period_date 오름차순), cols=선택 지점 + 고정 '미매칭'(branch_id NULL) 열.
  // RPC 가 이미 period+branch_id 로 집계했으므로 여기선 열 매핑·합계만.
  const UNMATCHED = '__unmatched__';
  const compareMatrix = useMemo(() => {
    const branchName = new Map(branches.map(b => [b.id, b.name]));
    const selectedCols = compareBranchIds.map(id => ({ id, name: branchName.get(id) || id }));
    // 미매칭 합계 존재 여부 — NULL branch_id 행이 1개라도 있으면 열 노출.
    const hasUnmatched = compareRows.some(r => !r.branch_id);
    const cols = hasUnmatched
      ? [...selectedCols, { id: UNMATCHED, name: '미매칭' }]
      : selectedCols;

    // cell[period][colId] = total 합
    const cell = new Map<string, Map<string, number>>();
    const periodSet = new Set<string>();
    const colTotals = new Map<string, number>();
    let grandTotal = 0;
    for (const r of compareRows) {
      const colId = r.branch_id ?? UNMATCHED;
      // 미매칭이 아닌데 선택 안 된 지점은 제외 (미매칭 열은 항상 합산).
      if (colId !== UNMATCHED && !compareBranchIds.includes(colId)) continue;
      const p = r.period_date;
      periodSet.add(p);
      let row = cell.get(p);
      if (!row) { row = new Map(); cell.set(p, row); }
      row.set(colId, (row.get(colId) || 0) + r.total);
      colTotals.set(colId, (colTotals.get(colId) || 0) + r.total);
      grandTotal += r.total;
    }
    const periods = [...periodSet].sort((a, b) => b.localeCompare(a));   // #58 최신 일자 상단(내림차순)
    const rows = periods.map(p => {
      const row = cell.get(p);
      const values = cols.map(c => row?.get(c.id) || 0);
      const rowTotal = values.reduce((s, v) => s + v, 0);
      return { period: p, values, rowTotal };
    });
    const colTotalValues = cols.map(c => colTotals.get(c.id) || 0);
    return { cols, rows, colTotalValues, grandTotal };
  }, [compareRows, compareBranchIds, branches]);

  // 기간 라벨 — grain 따라 일/월/연 표시 형식.
  const fmtPeriodLabel = useCallback((iso: string) => {
    // iso = 'YYYY-MM-DD' (date_trunc 결과). grain 별로 잘라서 표시.
    if (compareGrain === 'year') return iso.slice(0, 4);
    if (compareGrain === 'month') return iso.slice(0, 7);
    return iso;
  }, [compareGrain]);

  const toggleCompareBranch = (id: string) => {
    setCompareBranchIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

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
      // 오프라인 매장만 — 온라인몰(ONLINE) 제외(#48 P3). NULL/STORE 등은 유지(클라 필터가 안전).
      if (offlineOnly && o.channel === 'ONLINE') return false;
      // 기본 검색
      if (mainQ) {
        const hit =
          o.order_number?.toLowerCase().includes(mainQ) ||
          o.customer?.name?.toLowerCase().includes(mainQ) ||
          (mainDigits && o.customer?.phone?.replace(/[^0-9]/g, '').includes(mainDigits)) ||
          o.buyer_name?.toLowerCase().includes(mainQ) ||
          (mainDigits && o.buyer_phone?.replace(/[^0-9]/g, '').includes(mainDigits)) ||
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
      // 받는 분 검색 (이름·전화) — shipment 우선, 없으면 sales_order recipient_* (shipment 없는 카페24 주문 포함)
      if (recQ) {
        const hit = (o.shipments || []).some(s => {
          if ((s.recipient_name || '').toLowerCase().includes(recQ)) return true;
          if (recDigits && (s.recipient_phone || '').replace(/[^0-9]/g, '').includes(recDigits)) return true;
          return false;
        }) ||
          (o.recipient_name || '').toLowerCase().includes(recQ) ||
          (!!recDigits && (o.recipient_phone || '').replace(/[^0-9]/g, '').includes(recDigits));
        if (!hit) return false;
      }
      // 주소 검색 (배송지) — shipment 우선, 없으면 sales_order recipient_*
      if (addrQ) {
        const hit = (o.shipments || []).some(s => {
          const addr = `${s.recipient_address || ''} ${s.recipient_address_detail || ''}`.toLowerCase();
          return addr.includes(addrQ);
        }) ||
          `${o.recipient_address || ''} ${o.recipient_address_detail || ''}`.toLowerCase().includes(addrQ);
        if (!hit) return false;
      }
      return true;
    });
  }, [orders, search, productSearch, orderOptionSearch, recipientSearch, addressSearch, offlineOnly]);

  // 수령 상태별 그룹 (listSort==='receipt' 렌더용). 수령 업무 흐름 기준 정렬.
  //   1차: 수령 상태 — 방문예정 → 퀵예정 → 택배예정 → 수령완료 → 기타
  //   각 상태 내: 수령일자 내림차순(없으면 맨 뒤), 동일하면 판매일자(ordered_at) 내림차순
  const receiptGroups = useMemo(() => {
    const ORDER = ['PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED', 'RECEIVED'];
    const LABEL: Record<string, string> = {
      PICKUP_PLANNED: '방문예정', QUICK_PLANNED: '퀵예정', PARCEL_PLANNED: '택배예정',
      RECEIVED: '수령완료', 기타: '기타',
    };
    const buckets = new Map<string, OrderRow[]>();
    for (const o of filtered) {
      const key = o.receipt_status && ORDER.includes(o.receipt_status) ? o.receipt_status : '기타';
      const arr = buckets.get(key);
      if (arr) arr.push(o); else buckets.set(key, [o]);
    }
    // 그룹 내 정렬: 수령일 DESC(null 맨 뒤) → 판매일 DESC
    const cmp = (a: OrderRow, b: OrderRow) => {
      const ra = a.receipt_date || '', rb = b.receipt_date || '';
      if (ra !== rb) {
        if (!ra) return 1;
        if (!rb) return -1;
        return ra < rb ? 1 : -1;
      }
      const oa = a.ordered_at || '', ob = b.ordered_at || '';
      return oa < ob ? 1 : oa > ob ? -1 : 0;
    };
    return [...ORDER, '기타']
      .filter(k => buckets.has(k))
      .map(k => {
        const orders = buckets.get(k)!.slice().sort(cmp);
        // #37 수령일자별 소계 — 위 정렬로 같은 수령일이 인접하므로 연속 묶음으로 분할.
        //   수령일 없으면 '미정'(맨 뒤). 같은 상태 안에서도 날짜별 헤더/건수로 구분.
        const dateGroups: { dateKey: string; label: string; orders: OrderRow[]; count: number }[] = [];
        for (const o of orders) {
          const dk = o.receipt_date || '미정';
          const last = dateGroups[dateGroups.length - 1];
          if (last && last.dateKey === dk) { last.orders.push(o); last.count++; }
          else dateGroups.push({ dateKey: dk, label: dk === '미정' ? '수령일 미정' : dk, orders: [o], count: 1 });
        }
        return {
          statusKey: k,
          label: LABEL[k] ?? k,
          orders,
          count: orders.length,
          dateGroups,
        };
      });
  }, [filtered]);

  // #38 수령상태 일괄변경 — 선택/그룹선택/적용
  const toggleReceiptSelect = (id: string) =>
    setSelectedReceiptIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroupSelect = (groupOrders: OrderRow[]) =>
    setSelectedReceiptIds(prev => {
      const n = new Set(prev);
      const allSel = groupOrders.length > 0 && groupOrders.every(o => n.has(o.id));
      for (const o of groupOrders) { if (allSel) n.delete(o.id); else n.add(o.id); }
      return n;
    });
  const clearReceiptSel = () => setSelectedReceiptIds(new Set());
  const handleBulkReceipt = async () => {
    const ids = [...selectedReceiptIds];
    if (ids.length === 0) return;
    const label = bulkTarget === 'RECEIVED' ? '배송완료(택배)·수령(방문)' : '발송완료';
    if (!confirm(`선택한 ${ids.length}건을 최종 상태(${label})로 일괄 변경하시겠습니까?\n택배건은 연결 배송이 '배송완료'로 갱신되어 택배관리에도 반영됩니다.\n기존 수령일자는 유지됩니다(#47).`)) return;
    setBulkSaving(true);
    try {
      const res = await bulkUpdateReceiptStatus(ids, bulkTarget);
      if (res.error) { alert('일괄 변경 실패: ' + res.error); return; }
      const skipMsg = res.skipped ? `\n(${res.skipped}건은 대상 상태가 아니어서 제외됨)` : '';
      alert(`✅ ${res.updated ?? 0}건을 '${label}'(으)로 변경했습니다.${skipMsg}`);
      clearReceiptSel();
      await loadOrders();
    } finally {
      setBulkSaving(false);
    }
  };

  // 주문 1행 렌더러 — order/receipt 두 모드 공통 사용. 셀 구성·onClick·뱃지 로직 원본 그대로.
  const renderOrderRow = (o: OrderRow) => {
                const isCancelled = o.status === 'CANCELLED';
                const isRefunded = o.status === 'REFUNDED' || o.status === 'PARTIALLY_REFUNDED';
                // 출고처(재고 차감 지점) = 배송 출고지점 → 없으면 판매지점(방문수령·자사몰은 판매지점=차감지점). 항상 표시.
                const shipFromId = o.shipments?.[0]?.branch_id || o.branch?.id;
                const shipFromName = (branches.find(b => b.id === shipFromId)?.name) || o.branch?.name || '';
                const receiptKey = (o.receipt_status as keyof typeof RECEIPT_STATUS_LABEL) || 'RECEIVED';
                const approvalKey = (o.approval_status as keyof typeof APPROVAL_STATUS_LABEL) || 'COMPLETED';
                const items = o.items || [];
                const itemNames = items.map(it => it.product?.name || it.item_text).filter(Boolean) as string[];
                const totalQty = items.reduce((s, it) => s + (it.quantity || 0), 0);
                const firstShip = (o.shipments || [])[0];
                // 배송방식 아이콘(#43, ESC-1) — receipt_status는 수령완료 시 RECEIVED로 바뀌므로
                //   영구 신호로 도출: firstShip.delivery_type · receipt_status · 자사몰(ONLINE) 채널.
                //   퀵 우선 판정 → 퀵이면 🛵, 택배면 📦, 둘 다 아니면 없음(방문/현장).
                const isQuickDelivery =
                  firstShip?.delivery_type === 'QUICK' || o.receipt_status === 'QUICK_PLANNED';
                const isParcelDelivery =
                  firstShip?.delivery_type === 'PARCEL'
                  || o.receipt_status === 'PARCEL_PLANNED'
                  || o.channel === 'ONLINE';   // 자사몰 주문은 본질적으로 택배
                const recvIcon = isQuickDelivery ? '🛵' : isParcelDelivery ? '📦' : null;
                // 받는분 = shipment 우선 → 없으면 sales_order recipient_* (카페24 받는분 스냅샷)
                const recv = {
                  name: firstShip?.recipient_name ?? o.recipient_name ?? null,
                  phone: firstShip?.recipient_phone ?? o.recipient_phone ?? null,
                  address: firstShip?.recipient_address ?? o.recipient_address ?? null,
                  addressDetail: firstShip?.recipient_address_detail ?? o.recipient_address_detail ?? null,
                };
                const hasRecv = !!(recv.name || recv.phone || recv.address);
                const optionBadges = items.map(it => it.order_option).filter(Boolean) as string[];
                return (
                  <tr
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${isCancelled || isRefunded ? 'opacity-60' : ''}`}
                  >
                    <td className="text-xs text-slate-600 whitespace-nowrap align-top">
                      <div className="flex items-start gap-1.5">
                        {listSort === 'receipt' && (
                          <input
                            type="checkbox"
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            checked={selectedReceiptIds.has(o.id)}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { e.stopPropagation(); toggleReceiptSelect(o.id); }}
                          />
                        )}
                        <div>
                          <p>{fmtDateKST(o.ordered_at)}</p>
                          <p className="text-[10px] text-slate-400">{fmtTimeKST(o.ordered_at)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap align-top">
                      <span className={`badge text-[10px] ${RECEIPT_STATUS_BADGE[receiptKey] || 'bg-slate-100 text-slate-600'}`}>
                        {receiptStatusLabelFor(o.receipt_status)}
                      </span>
                      {/* 발송단계 보조배지(#55) — 연결 shipment.status 읽기전용. 수령배지와 별개 표시(택배관리에서 처리 시 새로고침 반영). */}
                      {firstShip?.status && SHIP_STAGE_LABEL[firstShip.status] && (
                        <span
                          className="badge text-[10px] mt-0.5 ml-1 bg-slate-100 text-slate-500 border border-slate-200"
                          title="택배관리 발송 진행단계(읽기전용)"
                        >
                          🚚 {SHIP_STAGE_LABEL[firstShip.status]}
                        </span>
                      )}
                      {o.receipt_date && <p className="text-[10px] text-slate-500 mt-0.5">{o.receipt_date}</p>}
                    </td>
                    <td className="text-xs text-slate-700 whitespace-nowrap align-top">{o.branch?.name || '-'}</td>
                    <td className="text-xs text-slate-700 whitespace-nowrap align-top">
                      <span className="inline-flex items-center gap-1">
                        {/* 배송방식 아이콘(#57) — 택배(📦)/퀵(🛵) 단일 위치. 방문/현장은 null → 미표시. */}
                        {recvIcon && (
                          <span className={recvIcon === '🛵' ? 'text-indigo-600' : 'text-blue-600'}>
                            {recvIcon}
                          </span>
                        )}
                        {shipFromName ? (
                          shipFromId === o.branch?.id ? (
                            <span className="text-slate-400">동일</span>
                          ) : (
                            <span className="inline-flex items-center px-1 text-[10px] rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                              🚚 {shipFromName}
                            </span>
                          )
                        ) : <span className="text-slate-300">-</span>}
                      </span>
                    </td>
                    <td className="text-xs text-slate-700 whitespace-nowrap align-top">{o.handler?.name || '-'}</td>
                    <td className="align-top">
                      {o.customer ? (
                        <div>
                          <p className="font-medium text-sm">{o.customer.name}</p>
                          <p className="text-[11px] text-slate-400">{o.customer.phone}</p>
                        </div>
                      ) : (o.buyer_name || o.buyer_phone) ? (
                        <div title="자사몰 주문자 (고객 미연결)">
                          <p className="font-medium text-sm">
                            {o.buyer_name || '-'}
                            <span className="ml-1 text-[10px] px-1 rounded bg-slate-100 text-slate-500 align-middle">자사몰</span>
                          </p>
                          <p className="text-[11px] text-slate-400">{o.buyer_phone || ''}</p>
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
                      {/* 최종 결제금액 단일 표시(#18) — 할인·포인트는 별도 매출항목으로 분리하지 않음 */}
                      <p
                        className="font-semibold"
                        title={(o.discount_amount || 0) > 0
                          ? `상품 ${(o.total_amount || 0).toLocaleString()}원 − 할인 ${(o.discount_amount || 0).toLocaleString()}원`
                          : undefined}
                      >
                        {netSales(o).toLocaleString()}원
                      </p>
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
                      {/* 받는분 = 이름/연락처/주소만(#57). 배송방식 아이콘은 출고처 열로 이동. */}
                      {hasRecv ? (
                        <div className="text-xs leading-tight">
                          <p className="text-slate-700">{recv.name || '-'}</p>
                          <p className="text-[10px] text-slate-400">{recv.phone || ''}</p>
                          <p className="text-[10px] text-slate-500 line-clamp-1" title={`${recv.address || ''} ${recv.addressDetail || ''}`}>
                            {recv.address || ''}
                          </p>
                        </div>
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
  };

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
      total: valid.reduce((s, o) => s + netSales(o), 0),   // 최종 결제금액 기준(#18)
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
      const d = fmtDateKST(o.ordered_at);   // KST 기준 일자 그룹핑(UTC 슬라이스 금지)
      const cur = map.get(d) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += netSales(o);   // 최종 결제금액 기준(#18)
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
      // 출고처: 배송 출고지점 → 없으면 판매지점(방문수령·자사몰=차감지점). 항상 값 존재.
      const shipFromId = firstShip?.branch_id || o.branch?.id;
      const shipFromBranch = (branches.find(b => b.id === shipFromId)?.name) || o.branch?.name || '';
      const itemNames = (o.items || []).map(it => it.product?.name || '').filter(Boolean);
      const itemLabel = itemNames.slice(0, 3).join(' / ') + (itemNames.length > 3 ? ` 외 ${itemNames.length - 3}` : '');
      const totalQty = (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
      return [
        fmtDateKST(o.ordered_at),
        receiptStatusLabelFor(o.receipt_status),
        o.receipt_date || '',
        o.branch?.name || '',
        shipFromBranch,
        o.handler?.name || '',
        o.customer?.name || '',
        o.customer?.phone || '',
        o.order_number,
        itemLabel,
        totalQty,
        netSales(o),   // 매출 = 최종 결제금액(#18)
        PAY_LABEL[o.payment_method] || o.payment_method,
        APPROVAL_STATUS_LABEL[o.approval_status || 'COMPLETED'] || '',
        (o.payment_info || '').replace(/\n/g, ' '),
        firstShip?.recipient_name ?? o.recipient_name ?? '',
        firstShip?.recipient_phone ?? o.recipient_phone ?? '',
        `${firstShip?.recipient_address ?? o.recipient_address ?? ''} ${firstShip?.recipient_address_detail ?? o.recipient_address_detail ?? ''}`.trim(),
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
      {/* 서브뷰 토글 — 본사/관리자 전용 (지점직원은 목록만). forcedView(탭 분리) 시 숨김. */}
      {!isBranchUser && !forcedView && (
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {([['list', '매출 현황'], ['compare', '지점별 매출']] as ['list' | 'compare', string][]).map(([k, label]) => (
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
      )}

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
          <button
            onClick={subView === 'compare' ? loadCompare : loadOrders}
            className="btn-secondary text-sm py-1.5 ml-auto">조회</button>
          {subView === 'list' && (
            <>
              <button onClick={() => setShowCustomerLookup(true)}
                className="text-sm py-1.5 px-3 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                title="고객 이름·전화로 검색해 상담·구매(과거 포함) 이력 화면으로 이동">
                🔍 고객 찾기
              </button>
              <button onClick={handleCsv} disabled={filtered.length === 0}
                className="btn-secondary text-sm py-1.5 disabled:opacity-40">CSV 내보내기</button>
            </>
          )}
        </div>

        {/* 기본 필터 바 — 가장 빈번한 조회(고객명·전화·주문번호) */}
        {subView === 'list' && (
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
              {/* 콤보 옵션은 활성 지점만(#48 C). 단, 이미 선택된 비활성 지점은 누락되지 않게 유지. */}
              {branches
                .filter(b => (b as any).is_active !== false || b.id === branchFilter)
                .map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
        )}

        {/* 지점비교 — 집계 단위(일/월/연) + 지점 다수선택 */}
        {subView === 'compare' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">집계 단위</span>
              <div className="flex items-center gap-1 bg-slate-100 rounded-md p-0.5">
                {([['day', '일'], ['month', '월'], ['year', '연']] as ['day' | 'month' | 'year', string][]).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setCompareGrain(k)}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      compareGrain === k ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {compareGrain === 'day' && (
                <span className="text-[11px] text-slate-400">일별은 366일 이내</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                {/* 지점별 매출은 활성 지점만 선택 가능(비활성은 매출처 필터 콤보에만 노출) */}
                <button onClick={() => setCompareBranchIds(branches.filter(b => (b as any).is_active !== false).map(b => b.id))}
                  className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">전체</button>
                <button onClick={() => setCompareBranchIds([])}
                  className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">해제</button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {branches.filter(b => (b as any).is_active !== false).map(b => (
                  <label key={b.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input type="checkbox" className="w-4 h-4"
                      checked={compareBranchIds.includes(b.id)}
                      onChange={() => toggleCompareBranch(b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 고급 검색 패널 (PDF 중요도 순) */}
        {subView === 'list' && showAdvanced && (
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

      {/* 목록 뷰 본문 */}
      {subView === 'list' && (<>
      {/* 요약 카드 — 총 매출 중심(할인·포인트 적립은 제외, 최종 결제 기준 매출만) */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="판매 건수" value={`${summary.count}건`} sub={summary.cancelledCount > 0 ? `취소·환불 ${summary.cancelledCount}건` : undefined} />
        <SummaryCard label="매출 합계" value={`${summary.total.toLocaleString()}원`} accent="blue" />
      </div>

      {/* 테이블 */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-slate-700">판매 내역 ({filtered.length}건)</h3>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
              {([['order', '주문일순'], ['receipt', '수령 상태순']] as ['order' | 'receipt', string][]).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setListSort(k)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    listSort === k ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* 미결 건만 보기 — 수령완료·배송완료 숨겨 처리할 건만 직관 파악 */}
            <button
              onClick={() => setHideReceived(v => !v)}
              title="체크 시 수령(완료) 건을 숨기고 처리 대기 건(방문예정·택배예정 등)만 표시합니다"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                hideReceived
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className={`inline-block w-3 h-3 rounded-sm border ${hideReceived ? 'bg-white border-white' : 'border-slate-300'}`}>
                {hideReceived && <span className="block text-amber-500 text-[10px] leading-3 text-center">✓</span>}
              </span>
              미결 건만 보기
            </button>
            {/* 오프라인 매장만 — 온라인몰 주문 숨김(#48 P3). '온라인몰' 뷰와는 반대 방향(ONLINE 제외). */}
            <button
              onClick={() => setOfflineOnly(v => !v)}
              title="체크 시 온라인몰(자사몰) 주문을 숨기고 오프라인 매장 매출만 표시합니다"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                offlineOnly
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className={`inline-block w-3 h-3 rounded-sm border ${offlineOnly ? 'bg-white border-white' : 'border-slate-300'}`}>
                {offlineOnly && <span className="block text-amber-500 text-[10px] leading-3 text-center">✓</span>}
              </span>
              오프라인 매장만
            </button>
          </div>
          <button onClick={() => { setRefundOrderNumber(null); setShowRefundModal(true); }}
            className="text-sm text-red-600 hover:underline">환불 처리</button>
        </div>

        {/* #38 수령상태 일괄변경 바 — 수령현황 뷰에서 선택 시 노출 */}
        {listSort === 'receipt' && selectedReceiptIds.size > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <span className="font-semibold text-blue-800">{selectedReceiptIds.size}건 선택됨</span>
            <span className="text-slate-400">→</span>
            <select
              value={bulkTarget}
              onChange={e => setBulkTarget(e.target.value as 'RECEIVED')}
              className="input py-1 text-sm w-auto"
            >
              <option value="RECEIVED">배송완료(택배) · 수령(방문)</option>
            </select>
            <button
              onClick={handleBulkReceipt}
              disabled={bulkSaving}
              className="btn-primary text-sm px-3 py-1 disabled:opacity-50"
            >
              {bulkSaving ? '변경 중...' : '일괄 변경'}
            </button>
            <button
              onClick={clearReceiptSel}
              disabled={bulkSaving}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              선택 해제
            </button>
            <span className="text-xs text-slate-500">· 연결된 배송 상태도 함께 갱신됩니다</span>
          </div>
        )}

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
              ) : listSort === 'order' ? (
                filtered.map(renderOrderRow)
              ) : (
                receiptGroups.flatMap(g => [
                  <tr key={`h-${g.statusKey}`} className="bg-slate-100 font-semibold text-slate-700 text-sm">
                    <td colSpan={13} className="py-1.5">
                      <label className="inline-flex items-center gap-2 cursor-pointer mr-2" title="이 상태 전체 선택/해제">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={g.orders.length > 0 && g.orders.every(o => selectedReceiptIds.has(o.id))}
                          onChange={() => toggleGroupSelect(g.orders)}
                        />
                        <span className={`badge text-[10px] ${RECEIPT_STATUS_BADGE[g.statusKey] || 'bg-slate-200 text-slate-600'}`}>
                          {g.label}
                        </span>
                      </label>
                      <span className="font-normal text-slate-500">{g.count}건</span>
                    </td>
                  </tr>,
                  // #37 같은 상태 안에서 수령일자별 소계 헤더 + 구분선
                  ...g.dateGroups.flatMap(dg => [
                    <tr key={`dh-${g.statusKey}-${dg.dateKey}`} className="bg-slate-50 border-t-2 border-slate-200">
                      <td colSpan={13} className="py-1 pl-6 text-xs text-slate-500">
                        <span className="mr-1">📅</span>
                        <span className="font-medium text-slate-600">{dg.label}</span>
                        <span className="text-slate-400"> · {dg.count}건</span>
                      </td>
                    </tr>,
                    ...dg.orders.map(renderOrderRow),
                  ]),
                ])
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 일자별 요약 — 옵션(여러 날일 때만, 기본 숨김). 고객별 내역 아래에 표시 */}
      {isMultiDay && perDay.length > 0 && (
        <div className="card">
          <button
            type="button"
            onClick={() => setShowDailySummary(v => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-blue-700"
          >
            <span className="text-slate-400">{showDailySummary ? '▾' : '▸'}</span>
            📅 일자별 요약 ({perDay.length}일)
          </button>
          {showDailySummary && (
            <div className="overflow-x-auto mt-2">
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
          )}
        </div>
      )}
      </>)}

      {/* 지점비교 매트릭스 (본사/관리자) — legacy+sales 통합, 일/월/연 */}
      {subView === 'compare' && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-700">
              지점별 매출 ({compareGrain === 'day' ? '일' : compareGrain === 'month' ? '월' : '연'})
            </h3>
            <span className="text-xs text-slate-400">{startDate} ~ {endDate} · 선택 {compareBranchIds.length}개 지점</span>
          </div>
          {compareError ? (
            <div className="text-center py-10 text-amber-600 text-sm">{compareError}</div>
          ) : compareLoading ? (
            <div className="text-center py-10 text-slate-400">로딩 중...</div>
          ) : compareMatrix.cols.length === 0 ? (
            <div className="text-center py-10 text-slate-400">비교할 지점을 1개 이상 선택하세요</div>
          ) : compareMatrix.rows.length === 0 ? (
            <div className="text-center py-10 text-slate-400">해당 기간 매출이 없습니다</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table text-sm min-w-[480px]">
                <thead>
                  <tr className="text-xs text-slate-500">
                    <th className="whitespace-nowrap">
                      {compareGrain === 'day' ? '일자' : compareGrain === 'month' ? '월' : '연'}
                    </th>
                    {compareMatrix.cols.map(c => (
                      <th key={c.id} className="text-right whitespace-nowrap">{c.name}</th>
                    ))}
                    <th className="text-right whitespace-nowrap font-semibold">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {compareMatrix.rows.map(row => (
                    <tr key={row.period}>
                      <td className="font-mono whitespace-nowrap">{fmtPeriodLabel(row.period)}</td>
                      {row.values.map((v, i) => (
                        <td key={compareMatrix.cols[i].id} className="text-right">{v.toLocaleString()}원</td>
                      ))}
                      <td className="text-right font-semibold">{row.rowTotal.toLocaleString()}원</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold text-slate-800">
                    <td>지점 합계</td>
                    {compareMatrix.colTotalValues.map((v, i) => (
                      <td key={compareMatrix.cols[i].id} className="text-right">{v.toLocaleString()}원</td>
                    ))}
                    <td className="text-right text-blue-700">{compareMatrix.grandTotal.toLocaleString()}원</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedOrderId && (
        <SalesDetailDrawer
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          reprintOpen={!!reprintReceipt}
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

  useEscClose(onClose);

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

// 상담 content(JSONB)에서 표시 텍스트 추출 — 고객상세 page.tsx extractText와 동일 규칙
function consultText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content.text === 'string') return content.text;
  if (typeof content.summary === 'string') return content.summary;
  try { return JSON.stringify(content); } catch { return ''; }
}

// ── 상세 드로어 ────────────────────────────────────────────────────────────────
function SalesDetailDrawer({ orderId, onClose, reprintOpen, onReprint, onRefundIntent, onChanged }: {
  orderId: string;
  onClose: () => void;
  reprintOpen: boolean;
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
  // 미수금 수금 처리 (#39)
  const [showSettleForm, setShowSettleForm] = useState(false);
  const [settleMethod, setSettleMethod] = useState<'cash' | 'card' | 'kakao'>('cash');
  const [settling, setSettling] = useState(false);
  // 수령 전 전표 품목 추가/삭제
  const [revising, setRevising] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [productOptions, setProductOptions] = useState<{ id: string; name: string; code?: string; price?: number }[]>([]);
  const [addProductId, setAddProductId] = useState('');
  const [addQty, setAddQty] = useState('1');
  const [addPrice, setAddPrice] = useState('');
  const [addOption, setAddOption] = useState('');
  const [addDeliveryType, setAddDeliveryType] = useState<'PICKUP' | 'PARCEL' | 'QUICK'>('PICKUP');
  // 품목 수량/단가 인라인 수정 (#36)
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemQty, setEditItemQty] = useState('');
  const [editItemPrice, setEditItemPrice] = useState('');
  // 방문↔택배 배송전환
  const [converting, setConverting] = useState(false);
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [cvName, setCvName] = useState('');
  const [cvPhone, setCvPhone] = useState('');
  const [cvZipcode, setCvZipcode] = useState('');
  const [cvAddress, setCvAddress] = useState('');
  const [cvAddressDetail, setCvAddressDetail] = useState('');
  const [cvMessage, setCvMessage] = useState('');
  // 전표 상세 직접 수정 (고객/표시명/수령일/받는분)
  const [editingDetails, setEditingDetails] = useState(false);
  // 재출력 영수증(ReceiptModal)이 떠 있는 동안엔 드로어 ESC를 끈다 — 중첩 리스너 동시발화 방지
  useEscClose(onClose, { enabled: !reprintOpen, isDirty: () => editingDetails });
  const [savingDetails, setSavingDetails] = useState(false);
  const [edCustomerId, setEdCustomerId] = useState<string | null>(null);
  const [edCustomerLabel, setEdCustomerLabel] = useState('');   // 표시용 (이름 전화)
  const [edBuyerName, setEdBuyerName] = useState('');
  const [edBuyerPhone, setEdBuyerPhone] = useState('');
  const [edReceiptDate, setEdReceiptDate] = useState('');
  // #23: 기본정보 확대 수정 (판매일시·매출처·담당자·수령상태)
  const [edOrderedAt, setEdOrderedAt] = useState('');       // datetime-local 값
  const [edBranchId, setEdBranchId] = useState('');
  const [edShipFromBranchId, setEdShipFromBranchId] = useState(''); // 출고처(재고 차감 지점)
  const [edOrderedBy, setEdOrderedBy] = useState('');
  const [edReceiptStatus, setEdReceiptStatus] = useState('');
  const [edBranchOptions, setEdBranchOptions] = useState<{ id: string; name: string }[]>([]);
  const [edStaffOptions, setEdStaffOptions] = useState<{ id: string; name: string }[]>([]);
  const [edRcptName, setEdRcptName] = useState('');
  const [edRcptPhone, setEdRcptPhone] = useState('');
  const [edRcptZipcode, setEdRcptZipcode] = useState('');
  const [edRcptAddress, setEdRcptAddress] = useState('');
  const [edRcptAddressDetail, setEdRcptAddressDetail] = useState('');
  const [edReason, setEdReason] = useState('');
  // 고객 재연결 인라인 검색 (CustomerLookupModal fetch 패턴 차용)
  const [edCustSearchOpen, setEdCustSearchOpen] = useState(false);
  const [edCustQuery, setEdCustQuery] = useState('');
  const [edCustResults, setEdCustResults] = useState<any[]>([]);
  const [edCustLoading, setEdCustLoading] = useState(false);
  // 상담내역 인라인 조회 (#17 — 판매 상세에서 고객 상담을 바로 확인, 조제·CS 판단 연결)
  const [showConsults, setShowConsults] = useState(false);
  const [consults, setConsults] = useState<any[]>([]);
  const [consultsLoading, setConsultsLoading] = useState(false);
  const [consultsLoaded, setConsultsLoaded] = useState(false);

  const toggleConsults = async () => {
    const next = !showConsults;
    setShowConsults(next);
    const cid = order?.customer?.id;
    if (next && !consultsLoaded && cid) {
      setConsultsLoading(true);
      try {
        const sb = createClient() as any;
        const { data } = await sb
          .from('customer_consultations')
          .select('id, consultation_type, content, created_at, consulted_by:users(name)')
          .eq('customer_id', cid)
          .order('created_at', { ascending: false })
          .limit(20);
        setConsults((data as any[]) || []);
      } finally {
        setConsultsLoaded(true);
        setConsultsLoading(false);
      }
    }
  };

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
      // #47: 상태만 전이 후, receipt_date가 비어있을 때만 오늘로 채움(기존 수령일 보존).
      const { error } = await sb
        .from('sales_order_items')
        .update({ receipt_status: 'RECEIVED' })
        .eq('id', itemId);
      if (!error) {
        await sb
          .from('sales_order_items')
          .update({ receipt_date: today })
          .eq('id', itemId)
          .is('receipt_date', null);
      }
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
        ? { ...it, receipt_status: 'RECEIVED', receipt_date: it.receipt_date || today }
        : it);
      setItems(nextItems);
      // 전 품목 RECEIVED이면 주문 레벨 + shipments도 완료
      const allDone = nextItems.every(it => !it.receipt_status || it.receipt_status === 'RECEIVED');
      if (allDone) {
        // #47: 주문도 상태만 전이 후 비어있을 때만 오늘로 채움(기존 수령일 보존).
        await sb.from('sales_orders')
          .update({ receipt_status: 'RECEIVED' })
          .eq('id', orderId);
        await sb.from('sales_orders')
          .update({ receipt_date: today })
          .eq('id', orderId)
          .is('receipt_date', null);
        if (shipment?.id) {
          await sb.from('shipments').update({ status: 'DELIVERED' }).eq('id', shipment.id);
          setShipment((prev: any) => prev ? { ...prev, status: 'DELIVERED' } : prev);
        }
        setOrder((prev: any) => prev ? { ...prev, receipt_status: 'RECEIVED', receipt_date: prev.receipt_date || today } : prev);
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
    if (!confirm(`${statusLabel}을 완료 처리할까요?\n수령현황 → 수령완료, 수령일자 → 비어있으면 오늘(기존값 보존)`)) return;
    setMarkingReceipt(true);
    try {
      const sb = createClient() as any;
      const today = kstTodayString();
      // #47: 상태만 전이 후, receipt_date가 비어있을 때만 오늘로 채움(기존 수령일 보존).
      const { error: orderErr } = await sb
        .from('sales_orders')
        .update({ receipt_status: 'RECEIVED' })
        .eq('id', orderId);
      if (orderErr) {
        alert('수령 완료 처리 실패: ' + orderErr.message);
        setMarkingReceipt(false);
        return;
      }
      await sb
        .from('sales_orders')
        .update({ receipt_date: today })
        .eq('id', orderId)
        .is('receipt_date', null);
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
      setOrder((prev: any) => prev ? { ...prev, receipt_status: 'RECEIVED', receipt_date: prev.receipt_date || today } : prev);
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

  // 방문→택배 전환 폼 열기 — 고객 정보(name/phone/address) prefill (best-effort)
  const openConvertForm = async () => {
    setShowConvertForm(true);
    // 1차 prefill: 드로어에 이미 로드된 주문/고객 정보
    setCvName(order?.customer?.name || order?.buyer_name || '');
    setCvPhone(order?.customer?.phone || order?.buyer_phone || '');
    // 2차: 고객 주소는 별도 조회 (드로어 select엔 address가 없음)
    if (order?.customer?.id) {
      const sb = createClient() as any;
      const { data } = await sb.from('customers').select('address').eq('id', order.customer.id).maybeSingle();
      if (data?.address) setCvAddress(prev => prev || data.address);
    }
  };

  // 방문 → 택배 전환 실행
  const handleConvertToParcel = async () => {
    if (converting || !order) return;
    const name = cvName.trim();
    const phone = cvPhone.trim();
    const address = cvAddress.trim();
    if (!name || !phone || !address) {
      alert('수령자명·연락처·주소는 필수 입력 항목입니다.');
      return;
    }
    if (!confirm('택배 배송으로 전환합니다.\n배송 레코드가 생성되고 품목이 택배예정으로 변경됩니다.')) return;
    setConverting(true);
    try {
      const res = await convertOrderToParcel({
        orderId: order.id,
        recipient: {
          name, phone, address,
          zipcode: cvZipcode.trim() || null,
          addressDetail: cvAddressDetail.trim() || null,
          message: cvMessage.trim() || null,
        },
      });
      if (res.error) { alert('택배 전환 실패: ' + res.error); return; }
      setShowConvertForm(false);
      setCvName(''); setCvPhone(''); setCvZipcode(''); setCvAddress(''); setCvAddressDetail(''); setCvMessage('');
      await loadDetail(true);
      onChanged();
    } finally {
      setConverting(false);
    }
  };

  // 택배 → 방문 전환 실행
  const handleConvertToPickup = async () => {
    if (converting || !order) return;
    if (!confirm('배송 레코드가 삭제되고 방문 수령으로 전환됩니다.')) return;
    setConverting(true);
    try {
      const res = await convertOrderToPickup({ orderId: order.id });
      if (res.error) { alert(res.error); return; }
      await loadDetail(true);
      onChanged();
    } finally {
      setConverting(false);
    }
  };

  const loadDetail = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
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
              ship_from_branch_id,
              customer:customers(id, name, phone),
              buyer_name, buyer_phone,
              recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail
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
              customer:customers(id, name, phone),
              buyer_name, buyer_phone
            `)
            .eq('id', orderId).single();
        })(),
        (async () => {
          // 052 적용: delivery_type, receipt_status, receipt_date 포함
          const full = await sb.from('sales_order_items')
            .select('id, quantity, unit_price, discount_amount, total_price, order_option, item_text, delivery_type, receipt_status, receipt_date, product:products(id, name, code, unit)')
            .eq('sales_order_id', orderId).order('id');
          if (!full.error) return full;
          // 051만 적용
          const v051 = await sb.from('sales_order_items')
            .select('id, quantity, unit_price, discount_amount, total_price, order_option, item_text, product:products(id, name, code, unit)')
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
    setOrder(ordRes.data || null);
    setItems((itemRes.data as any[]) || []);
    setPayments((payRes.data as any[]) || []);
    setShipment(shipRes.data || null);
    if (showSpinner) setLoading(false);
  }, [orderId]);

  useEffect(() => {
    loadDetail(true);
    // 주문 전환 시 상담 패널 상태 초기화 (다른 고객 상담 잔존 방지)
    setShowConsults(false);
    setConsults([]);
    setConsultsLoaded(false);
  }, [loadDetail]);

  // 지점 목록 1회 로드 — 출고처 표시(override 지점명)·매출처/출고처 드롭다운 공용.
  useEffect(() => {
    if (edBranchOptions.length > 0) return;
    const sb = createClient() as any;
    sb.from('branches').select('id, name, sort_order').eq('is_active', true).order('sort_order').order('name')
      .then((r: any) => setEdBranchOptions((r.data as any[]) || []));
  }, []);
  // 지점 id→이름 맵 (출고처 override 표시용)
  const branchNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of edBranchOptions) m.set(b.id, b.name);
    return m;
  }, [edBranchOptions]);
  // 현재 출고처 도출: 배송 있으면 shipment 지점 ?? override(ship_from) ?? 매출처
  const shipFromId: string | null =
    shipment?.branch?.id ?? (order?.ship_from_branch_id || null) ?? order?.branch?.id ?? null;
  const shipFromName: string =
    shipment?.branch?.name
    ?? (order?.ship_from_branch_id ? branchNameById.get(order.ship_from_branch_id) : undefined)
    ?? order?.branch?.name ?? '-';

  // 수령 전 전표만 품목 추가/삭제 가능 (status=COMPLETED + receipt_status 존재 + ≠RECEIVED)
  const editable = order?.status === 'COMPLETED' && !!order?.receipt_status && order.receipt_status !== 'RECEIVED';
  // 전표 상세 직접 수정 가능 여부 (취소·환불 전표 제외)
  const detailEditable = !!order && !['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.status);

  // 상세 편집 모드 진입 — 현재값으로 폼 prefill (받는분은 shipment 우선)
  const openEditDetails = () => {
    if (!order) return;
    setEdCustomerId(order.customer?.id || null);
    setEdCustomerLabel(order.customer ? `${order.customer.name} ${order.customer.phone || ''}`.trim() : '');
    setEdBuyerName(order.buyer_name || '');
    setEdBuyerPhone(order.buyer_phone || '');
    setEdReceiptDate(order.receipt_date || '');
    // #23: 판매일시·매출처·담당자·수령상태 prefill + 지점/담당자 목록 지연 로드
    setEdOrderedAt(isoToKstLocal(order.ordered_at));
    setEdBranchId(order.branch?.id || '');
    setEdShipFromBranchId(shipFromId || ''); // 현재 출고처(배송지점/override/매출처) prefill
    setEdOrderedBy(order.handler?.id || '');
    setEdReceiptStatus(order.receipt_status || 'RECEIVED');
    if (edBranchOptions.length === 0 || edStaffOptions.length === 0) {
      const sb = createClient() as any;
      sb.from('branches').select('id, name, sort_order').eq('is_active', true).order('sort_order').order('name')
        .then((r: any) => setEdBranchOptions((r.data as any[]) || []));
      sb.from('users').select('id, name').eq('is_active', true).order('name')
        .then((r: any) => setEdStaffOptions((r.data as any[]) || []));
    }
    setEdRcptName(shipment?.recipient_name ?? order.recipient_name ?? '');
    setEdRcptPhone(shipment?.recipient_phone ?? order.recipient_phone ?? '');
    setEdRcptZipcode(shipment?.recipient_zipcode ?? order.recipient_zipcode ?? '');
    setEdRcptAddress(shipment?.recipient_address ?? order.recipient_address ?? '');
    setEdRcptAddressDetail(shipment?.recipient_address_detail ?? order.recipient_address_detail ?? '');
    setEdReason('');
    setEdCustSearchOpen(false);
    setEdCustQuery('');
    setEdCustResults([]);
    setEditingDetails(true);
  };

  // 고객 재연결 인라인 검색 (디바운스)
  useEffect(() => {
    if (!editingDetails || !edCustSearchOpen) return;
    const q = edCustQuery.trim();
    if (!q) { setEdCustResults([]); return; }
    const t = setTimeout(() => {
      setEdCustLoading(true);
      const params = new URLSearchParams({ q, page: '1', limit: '20' });
      fetch(`/api/customers/search?${params.toString()}`)
        .then(r => r.json())
        .then(d => setEdCustResults(d.customers || []))
        .catch(() => setEdCustResults([]))
        .finally(() => setEdCustLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [edCustQuery, edCustSearchOpen, editingDetails]);

  const saveDetails = async () => {
    if (!order || savingDetails) return;
    setSavingDetails(true);
    try {
      const res = await updateSalesOrderDetails({
        orderId: order.id,
        customer_id: edCustomerId,
        buyer_name: edBuyerName.trim() || null,
        buyer_phone: edBuyerPhone.trim() || null,
        // 판매일시는 실제 변경 시에만 전송(datetime-local 초 절삭으로 인한 무의미 변경 방지)
        ordered_at: edOrderedAt && edOrderedAt !== isoToKstLocal(order.ordered_at) ? kstLocalToIso(edOrderedAt) : undefined,
        branch_id: edBranchId || null,
        ordered_by: edOrderedBy || null,
        receipt_status: edReceiptStatus || null,
        receipt_date: edReceiptDate || null,
        recipient_name: edRcptName.trim() || null,
        recipient_phone: edRcptPhone.trim() || null,
        recipient_zipcode: edRcptZipcode.trim() || null,
        recipient_address: edRcptAddress.trim() || null,
        recipient_address_detail: edRcptAddressDetail.trim() || null,
        reason: edReason.trim() || undefined,
      });
      if ('error' in res && res.error) { alert(res.error); return; }
      // 출고처 변경 — 사용자가 현재 출고처와 다르게 골랐을 때만(재고 이전 동반).
      if (edShipFromBranchId && edShipFromBranchId !== shipFromId) {
        const shipRes = await changeSalesOrderShipFromBranch({
          orderId: order.id,
          ship_from_branch_id: edShipFromBranchId,
          reason: edReason.trim() || undefined,
        });
        if ('error' in shipRes && shipRes.error) { alert(`출고처 변경 실패: ${shipRes.error}`); return; }
        if ('moved' in shipRes) {
          alert(`출고처가 변경되었습니다. 재고 ${shipRes.moved}품목이 새 출고처로 이전되었습니다.`);
        }
      }
      setEditingDetails(false);
      await loadDetail(true);
      onChanged();
    } finally {
      setSavingDetails(false);
    }
  };
  // 삭제 가능한(아직 미수령) 품목 수 — 마지막 1개 비활성 판단용
  const deletableCount = items.filter(it => (it.receipt_status || 'RECEIVED') !== 'RECEIVED').length;

  // 활성 제품 목록 지연 로드 — '+ 품목 추가' 폼을 처음 열 때만
  const openAddForm = async () => {
    setShowAddForm(true);
    if (productOptions.length === 0) {
      const sb = createClient() as any;
      let res = await sb.from('products').select('id, name, code, price').eq('is_active', true).order('name');
      if (res.error) res = await sb.from('products').select('id, name, code').eq('is_active', true).order('name');
      if (res.error) res = await sb.from('products').select('id, name, code').order('name');
      setProductOptions((res.data as any[]) || []);
    }
  };

  const handleAddItem = async () => {
    if (revising || !order) return;
    const qty = Number(addQty);
    const price = Number(addPrice);
    if (!addProductId) { alert('제품을 선택해주세요.'); return; }
    if (!Number.isFinite(qty) || qty <= 0) { alert('수량을 올바르게 입력해주세요.'); return; }
    if (!Number.isFinite(price) || price < 0) { alert('단가를 올바르게 입력해주세요.'); return; }
    setRevising(true);
    try {
      const res = await addSalesOrderItem({
        orderId: order.id,
        productId: addProductId,
        quantity: qty,
        unitPrice: price,
        orderOption: addOption.trim() || null,
        deliveryType: addDeliveryType,
      });
      if (res.error) { alert('품목 추가 실패: ' + res.error); return; }
      if (res.delta && res.delta !== 0) {
        alert(`결제 차액 ₩${Math.abs(res.delta).toLocaleString()} 가 ${res.delta > 0 ? '추가결제' : '부분환불'}로 기록되었습니다.\n카드/단말기 정산은 별도로 처리하세요.`);
      }
      // 폼 초기화 + 재조회
      setAddProductId(''); setAddQty('1'); setAddPrice(''); setAddOption(''); setAddDeliveryType('PICKUP');
      setShowAddForm(false);
      await loadDetail(false);
      onChanged();
    } finally {
      setRevising(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (revising || !order) return;
    if (!confirm('이 품목을 삭제하시겠습니까?\n재고가 복원되고 결제 차액이 기록됩니다.')) return;
    setRevising(true);
    try {
      const res = await removeSalesOrderItem({ orderId: order.id, itemId });
      if (res.error) { alert('품목 삭제 실패: ' + res.error); return; }
      if (res.delta && res.delta !== 0) {
        alert(`결제 차액 ₩${Math.abs(res.delta).toLocaleString()} 가 ${res.delta > 0 ? '추가결제' : '부분환불'}로 기록되었습니다.\n카드/단말기 정산은 별도로 처리하세요.`);
      }
      await loadDetail(false);
      onChanged();
    } finally {
      setRevising(false);
    }
  };

  // #36 품목 수량/단가 인라인 수정
  const startEditItem = (it: any) => {
    setEditingItemId(it.id);
    setEditItemQty(String(it.quantity ?? ''));
    setEditItemPrice(String(Number(it.unit_price ?? 0)));
  };
  const cancelEditItem = () => {
    setEditingItemId(null); setEditItemQty(''); setEditItemPrice('');
  };
  const handleSaveItemEdit = async (itemId: string) => {
    if (revising || !order) return;
    const qty = Number(editItemQty);
    const price = Number(editItemPrice);
    if (!Number.isInteger(qty) || qty <= 0) { alert('수량은 1개 이상의 정수여야 합니다.'); return; }
    if (!Number.isFinite(price) || price < 0) { alert('단가를 올바르게 입력해주세요.'); return; }
    setRevising(true);
    try {
      const res = await updateSalesOrderItem({ orderId: order.id, itemId, quantity: qty, unitPrice: price });
      if (res.error) { alert('품목 수정 실패: ' + res.error); return; }
      if (res.delta && res.delta !== 0) {
        alert(`결제 차액 ₩${Math.abs(res.delta).toLocaleString()} 가 ${res.delta > 0 ? '추가결제' : '부분환불'}로 기록되었습니다.\n카드/단말기 정산은 별도로 처리하세요.`);
      }
      cancelEditItem();
      await loadDetail(false);
      onChanged();
    } finally {
      setRevising(false);
    }
  };

  const handleSettleReceivable = async () => {
    if (!order || settling) return;
    setSettling(true);
    try {
      const res = await settleSalesOrderReceivable({ orderId: order.id, settledMethod: settleMethod });
      if (!res.success) { alert(res.error || '수금 처리에 실패했습니다.'); return; }
      setOrder((prev: any) => prev ? {
        ...prev,
        approval_status: 'COMPLETED',
        credit_settled: prev.payment_method === 'credit' ? true : prev.credit_settled,
      } : prev);
      setShowSettleForm(false);
      onChanged();
    } finally {
      setSettling(false);
    }
  };

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
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">기본 정보</p>
              {detailEditable ? (
                !editingDetails && (
                  <button
                    type="button"
                    onClick={openEditDetails}
                    className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                    title="고객·수령일·받는분 수정"
                  >
                    ✏️ 수정
                  </button>
                )
              ) : (
                <span className="text-[11px] text-slate-400">취소/환불 전표는 수정할 수 없습니다.</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-slate-500">일시</p>
                <p>{fmtDateTimeKST(order.ordered_at)}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">매출처</p>
                <p>{order.branch?.name || '-'}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">출고처 <span className="text-slate-400">(재고 차감 기준)</span></p>
                <p>
                  {shipFromName}
                  {shipFromId && order.branch?.id && shipFromId !== order.branch.id && (
                    <span className="ml-1 text-[10px] px-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">🚚 출고지점</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">담당자</p>
                <p>{order.handler?.name || '-'}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">고객</p>
                {order.customer ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/customers/${order.customer.id}`} className="text-blue-600 hover:underline">
                      {order.customer.name} <span className="text-xs text-slate-400">{order.customer.phone}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={toggleConsults}
                      className="text-[11px] px-2 py-0.5 rounded border border-violet-300 text-violet-700 hover:bg-violet-50"
                      title="이 고객의 상담내역을 바로 확인 (조제·CS 판단용)"
                    >
                      💬 상담내역 {showConsults ? '닫기' : '보기'}
                    </button>
                  </div>
                ) : (order.buyer_name || order.buyer_phone) ? (
                  <span title="자사몰 주문자 (고객 미연결)">
                    {order.buyer_name || '-'} <span className="text-xs text-slate-400">{order.buyer_phone || ''}</span>
                    <span className="ml-1 text-[10px] px-1 rounded bg-slate-100 text-slate-500">자사몰</span>
                  </span>
                ) : <span className="text-slate-400">비회원</span>}
              </div>
              {/* 상담내역 인라인 패널 (#17) — 그리드 전체폭. 고객 연결건만 노출. */}
              {showConsults && order.customer && (
                <div className="col-span-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-violet-800">상담내역 (최근 20건)</p>
                    <Link
                      href={`/customers/${order.customer.id}?tab=consultations`}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      고객 상담 전체 보기 →
                    </Link>
                  </div>
                  {consultsLoading ? (
                    <p className="text-xs text-slate-400 py-2">상담내역 불러오는 중…</p>
                  ) : consults.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">상담 기록이 없습니다.</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {consults.map((c) => (
                        <div key={c.id} className="rounded border border-violet-100 bg-white px-2.5 py-1.5">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                              {c.consultation_type || '기타'}
                            </span>
                            <span className="text-[10px] text-slate-400 whitespace-nowrap">
                              {c.consulted_by?.name ? `${c.consulted_by.name} · ` : ''}{fmtDateTimeKST(c.created_at)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {consultText(c.content) || <span className="text-slate-400">(내용 없음)</span>}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div>
                <p className="text-[11px] text-slate-500">상태</p>
                <div className="flex flex-wrap gap-1">
                  <span className={`badge text-[10px] ${STATUS_BADGE[order.status] || ''}`}>
                    {STATUS_LABEL[order.status] || order.status}
                  </span>
                  {order.approval_status && order.approval_status !== 'COMPLETED' && (
                    <span className={`badge text-[10px] ${APPROVAL_STATUS_BADGE[order.approval_status] || 'bg-amber-100 text-amber-800'}`}>
                      {order.approval_status === 'UNSETTLED' ? '미수금' : '미승인(카드)'}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">수령</p>
                <p className="flex items-center gap-1.5">
                  <span className={`badge text-[10px] ${RECEIPT_STATUS_BADGE[order.receipt_status || 'RECEIVED'] || 'bg-slate-100 text-slate-500'}`}>
                    {!order.receipt_status ? (shipment ? '배송완료' : '수령완료')
                     : order.receipt_status === 'RECEIVED' ? (shipment ? '배송완료' : '수령완료')
                     : order.receipt_status === 'PICKUP_PLANNED' ? '방문예정'
                     : order.receipt_status === 'QUICK_PLANNED' ? '퀵예정'
                     : '택배예정'}
                  </span>
                  {order.receipt_date && <span className="text-[11px] text-slate-500">{order.receipt_date}</span>}
                </p>
              </div>
            </div>

            {/* 전표 상세 수정 폼 */}
            {editingDetails && (
              <div className="p-3 border border-amber-200 rounded-md bg-amber-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-700">전표 상세 수정 — 판매번호는 변경되지 않습니다</p>
                  <button onClick={() => setEditingDetails(false)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
                </div>

                {/* 고객 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-500">고객</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-slate-700">
                      {edCustomerId ? (edCustomerLabel || '연결됨') : <span className="text-slate-400">미연결</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setEdCustSearchOpen(v => !v); setEdCustQuery(''); setEdCustResults([]); }}
                      className="text-[11px] px-2 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                    >
                      고객 변경
                    </button>
                    {edCustomerId && (
                      <button
                        type="button"
                        onClick={() => { setEdCustomerId(null); setEdCustomerLabel(''); }}
                        className="text-[11px] px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-100"
                      >
                        연결 해제
                      </button>
                    )}
                  </div>
                  {edCustSearchOpen && (
                    <div className="border border-slate-200 rounded-md bg-white">
                      <input
                        autoFocus
                        type="text"
                        value={edCustQuery}
                        onChange={e => setEdCustQuery(e.target.value)}
                        placeholder="고객명 / 전화번호 / 주소"
                        className="w-full text-sm border-b border-slate-200 px-2 py-1.5 outline-none"
                      />
                      <div className="max-h-44 overflow-y-auto">
                        {edCustLoading ? (
                          <div className="text-center py-3 text-xs text-slate-400">검색 중...</div>
                        ) : !edCustQuery.trim() ? (
                          <div className="text-center py-3 text-xs text-slate-400">검색어를 입력하세요.</div>
                        ) : edCustResults.length === 0 ? (
                          <div className="text-center py-3 text-xs text-slate-400">검색 결과가 없습니다.</div>
                        ) : (
                          <ul>
                            {edCustResults.map((c: any) => (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEdCustomerId(c.id);
                                    setEdCustomerLabel(`${c.name} ${c.phone || ''}`.trim());
                                    setEdCustSearchOpen(false);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 hover:bg-slate-50 border-b border-slate-100"
                                >
                                  <span className="text-sm text-slate-700">{c.name}</span>
                                  <span className="ml-2 text-xs text-slate-400 font-mono">{c.phone}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500">표시명 (미연결 시)</label>
                      <input type="text" value={edBuyerName} onChange={e => setEdBuyerName(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">연락처 (표시)</label>
                      <input type="text" value={edBuyerPhone} onChange={e => setEdBuyerPhone(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                    </div>
                  </div>
                </div>

                {/* #23: 판매일시 · 수령상태 · 매출처 · 담당자 */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500">판매일시</label>
                    <input type="datetime-local" value={edOrderedAt} onChange={e => setEdOrderedAt(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">수령상태</label>
                    <select value={edReceiptStatus} onChange={e => setEdReceiptStatus(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded px-2 py-1">
                      {([['RECEIVED', '수령완료'], ['PICKUP_PLANNED', '방문예정'], ['QUICK_PLANNED', '퀵예정'], ['PARCEL_PLANNED', '택배예정']] as [string, string][]).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">매출처</label>
                    <select value={edBranchId} onChange={e => setEdBranchId(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded px-2 py-1">
                      <option value="">미지정</option>
                      {edBranchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">출고처 <span className="text-slate-400">(재고 차감 지점)</span></label>
                    <select value={edShipFromBranchId} onChange={e => setEdShipFromBranchId(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded px-2 py-1">
                      <option value="">미지정</option>
                      {edBranchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {edShipFromBranchId && edShipFromBranchId !== shipFromId && (
                      <p className="mt-0.5 text-[10px] text-indigo-600">
                        ⚠ 변경 시 이미 차감된 재고가 <b>{branchNameById.get(edShipFromBranchId) || '새 지점'}</b>(으)로 이전됩니다(옛 지점 복원·새 지점 차감).
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">담당자</label>
                    <select value={edOrderedBy} onChange={e => setEdOrderedBy(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded px-2 py-1">
                      <option value="">미지정</option>
                      {edStaffOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* 수령일자 */}
                <div>
                  <label className="text-[10px] text-slate-500">수령일자</label>
                  <input type="date" value={edReceiptDate} onChange={e => setEdReceiptDate(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                </div>

                {/* 받는분 */}
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-slate-500">받는분 (배송)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500">이름</label>
                      <input type="text" value={edRcptName} onChange={e => setEdRcptName(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">전화</label>
                      <input type="text" value={edRcptPhone} onChange={e => setEdRcptPhone(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500">우편번호</label>
                      <input type="text" value={edRcptZipcode} onChange={e => setEdRcptZipcode(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-500">주소</label>
                      <input type="text" value={edRcptAddress} onChange={e => setEdRcptAddress(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">상세 주소</label>
                    <input type="text" value={edRcptAddressDetail} onChange={e => setEdRcptAddressDetail(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                  </div>
                  {shipment && (
                    <p className="text-[10px] text-slate-400">※ 배송 레코드가 있어 받는분 변경 시 배송 정보도 함께 갱신됩니다.</p>
                  )}
                </div>

                {/* 사유 */}
                <div>
                  <label className="text-[10px] text-slate-500">수정 사유 (선택)</label>
                  <input type="text" value={edReason} onChange={e => setEdReason(e.target.value)}
                    placeholder="예: 주문자 전화로 받는분 변경 요청"
                    className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={saveDetails}
                    disabled={savingDetails}
                    className="flex-1 py-1.5 text-sm rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {savingDetails ? '저장 중...' : '저장'}
                  </button>
                  <button
                    onClick={() => setEditingDetails(false)}
                    disabled={savingDetails}
                    className="px-4 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}

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
                      // RECEIVED 라벨은 품목 배송유형별 구분(택배·퀵=배송완료, 방문=수령완료)
                      const rLabel = itemRStatus === 'RECEIVED'
                          ? (itemDType === 'PARCEL' || itemDType === 'QUICK' ? '배송완료' : '수령완료')
                        : itemRStatus === 'PARCEL_PLANNED' ? '택배예정'
                        : itemRStatus === 'QUICK_PLANNED' ? '퀵예정'
                        : '방문예정';
                      const rColor = RECEIPT_STATUS_BADGE[itemRStatus] || 'bg-amber-100 text-amber-800';
                      return (
                        <tr key={it.id} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">
                            {/* 미매핑 카페24 품목은 product 없음 → item_text(원본명) 폴백 표시 */}
                            <p className="font-medium">{it.product?.name || it.item_text || '-'}</p>
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
                            <span className={`whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded border ${dTypeColor}`}>
                              {dTypeLabel}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className={`whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded ${rColor}`}>
                                {rLabel}
                              </span>
                              {itemPending && (
                                <button
                                  onClick={() => markItemReceived(it.id)}
                                  disabled={markingItemId === it.id}
                                  className="whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                  title={`${rLabel} 품목 수령 완료`}
                                >
                                  {markingItemId === it.id ? '...' : '✓ 완료'}
                                </button>
                              )}
                              {itemRStatus === 'RECEIVED' && order.status === 'COMPLETED' && (
                                <button
                                  onClick={() => revertItemReceived(it.id)}
                                  disabled={markingItemId === it.id}
                                  className="whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                  title="이 품목의 수령 완료를 취소하고 예정 상태로 되돌립니다"
                                >
                                  {markingItemId === it.id ? '...' : '↩ 취소'}
                                </button>
                              )}
                            </div>
                            {editable && itemRStatus !== 'RECEIVED' && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {editingItemId === it.id ? (
                                  <>
                                    <button
                                      onClick={() => handleSaveItemEdit(it.id)}
                                      disabled={revising}
                                      className="whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      {revising ? '...' : '저장'}
                                    </button>
                                    <button
                                      onClick={cancelEditItem}
                                      disabled={revising}
                                      className="whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                                    >
                                      취소
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => startEditItem(it)}
                                      disabled={revising}
                                      className="whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                                      title="수량·단가를 수정하고 재고·결제 차액을 자동 정리합니다"
                                    >
                                      ✏ 수정
                                    </button>
                                    <button
                                      onClick={() => handleRemoveItem(it.id)}
                                      disabled={revising || deletableCount <= 1}
                                      className="whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                                      title={deletableCount <= 1 ? '전표의 마지막 품목은 삭제할 수 없습니다 (판매 취소 사용)' : '이 품목을 삭제하고 재고·결제 차액을 정리합니다'}
                                    >
                                      🗑 삭제
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                            {it.receipt_date && (
                              <p className="text-[10px] text-slate-400 mt-0.5">{it.receipt_date}</p>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {editingItemId === it.id ? (
                              <input
                                type="number" min="1" step="1"
                                value={editItemQty}
                                onChange={e => setEditItemQty(e.target.value)}
                                className="input w-16 text-right py-0.5 text-xs"
                              />
                            ) : it.quantity}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {editingItemId === it.id ? (
                              <input
                                type="number" min="0"
                                value={editItemPrice}
                                onChange={e => setEditItemPrice(e.target.value)}
                                className="input w-24 text-right py-0.5 text-xs"
                              />
                            ) : Number(it.unit_price).toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium">
                            {editingItemId === it.id
                              ? (Math.max(0, Number(editItemPrice || 0) * Number(editItemQty || 0))).toLocaleString()
                              : Number(it.total_price).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 수령 전 전표: 품목 추가 */}
              {editable && (
                <div className="mt-2">
                  {!showAddForm ? (
                    <button
                      onClick={openAddForm}
                      className="text-xs px-2.5 py-1.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                    >
                      + 품목 추가
                    </button>
                  ) : (
                    <div className="p-3 border border-blue-200 rounded-md bg-blue-50/40 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-blue-700">품목 추가</p>
                        <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
                      </div>
                      <select
                        value={addProductId}
                        onChange={e => {
                          setAddProductId(e.target.value);
                          const p = productOptions.find(o => o.id === e.target.value);
                          if (p && p.price != null && addPrice === '') setAddPrice(String(p.price));
                        }}
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
                      >
                        <option value="">제품 선택...</option>
                        {productOptions.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}{p.code ? ` (${p.code})` : ''}
                          </option>
                        ))}
                      </select>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-500">수량</label>
                          <input type="number" min={1} value={addQty} onChange={e => setAddQty(e.target.value)}
                            className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500">단가</label>
                          <input type="number" min={0} value={addPrice} onChange={e => setAddPrice(e.target.value)}
                            className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500">배송</label>
                          <select value={addDeliveryType} onChange={e => setAddDeliveryType(e.target.value as any)}
                            className="w-full text-sm border border-slate-300 rounded px-2 py-1">
                            <option value="PICKUP">🏠 현장</option>
                            <option value="PARCEL">📦 택배</option>
                            <option value="QUICK">🛵 퀵</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500">주문 옵션 (선택)</label>
                        <input type="text" value={addOption} onChange={e => setAddOption(e.target.value)}
                          placeholder="예: 선물포장"
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                      </div>
                      <p className="text-[10px] text-slate-500">
                        추가 시 재고가 차감되고 결제 차액이 자동 기록됩니다. 카드/단말기 정산은 별도 처리하세요.
                      </p>
                      <button
                        onClick={handleAddItem}
                        disabled={revising}
                        className="w-full py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {revising ? '처리 중...' : '품목 추가'}
                      </button>
                    </div>
                  )}
                </div>
              )}
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
                    {editable && (
                      <button
                        type="button"
                        onClick={handleConvertToPickup}
                        disabled={converting}
                        className="text-[11px] text-amber-600 hover:text-amber-800 underline disabled:opacity-50"
                        title="배송을 취소하고 방문 수령으로 전환합니다 (송장 미발행 건만 가능)"
                      >
                        {converting ? '전환 중...' : '🏠 방문 수령으로 전환'}
                      </button>
                    )}
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

            {/* 배송 레코드 없는 수정가능 전표: 택배로 전환 */}
            {!shipment && editable && (
              <div>
                {!showConvertForm ? (
                  <button
                    type="button"
                    onClick={openConvertForm}
                    className="text-xs px-2.5 py-1.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                  >
                    📦 택배로 전환
                  </button>
                ) : (
                  <div className="p-3 border border-blue-200 rounded-md bg-blue-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-blue-700">택배 전환 — 수령자 정보</p>
                      <button onClick={() => setShowConvertForm(false)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500">수령자명 *</label>
                        <input type="text" value={cvName} onChange={e => setCvName(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500">연락처 *</label>
                        <input type="text" value={cvPhone} onChange={e => setCvPhone(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500">우편번호</label>
                        <input type="text" value={cvZipcode} onChange={e => setCvZipcode(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] text-slate-500">주소 *</label>
                        <input type="text" value={cvAddress} onChange={e => setCvAddress(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">상세 주소</label>
                      <input type="text" value={cvAddressDetail} onChange={e => setCvAddressDetail(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">배송 메시지 (선택)</label>
                      <input type="text" value={cvMessage} onChange={e => setCvMessage(e.target.value)}
                        placeholder="예: 부재 시 경비실"
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1" />
                    </div>
                    <p className="text-[10px] text-slate-500">
                      전환 시 미수령 품목이 택배예정으로 바뀌고 배송 레코드가 생성됩니다. 금액 변동은 없습니다.
                    </p>
                    <button
                      onClick={handleConvertToParcel}
                      disabled={converting}
                      className="w-full py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {converting ? '처리 중...' : '택배로 전환'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 액션 */}
            <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
              {/* 수령 완료 처리 — 예정 상태일 때만 노출 */}
              {order.receipt_status && order.receipt_status !== 'RECEIVED' && order.status === 'COMPLETED' && (
                <button
                  onClick={markReceiptCompleted}
                  disabled={markingReceipt}
                  className="flex-1 min-w-[140px] py-2 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  title={order.receipt_status === 'PICKUP_PLANNED' ? '방문 수령 완료 처리' : '배송 완료 처리'}
                >
                  {markingReceipt ? '처리 중...'
                    : (order.receipt_status === 'PICKUP_PLANNED' ? '✓ 방문 수령 완료' : '✓ 배송 완료')}
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
              {order.approval_status === 'UNSETTLED' && !showSettleForm && (
                <button onClick={() => setShowSettleForm(true)}
                  className="flex-1 min-w-[120px] py-2 text-sm rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  title="미수금을 수금 완료 처리합니다.">
                  💰 수금 완료
                </button>
              )}
            </div>
            {order.approval_status === 'UNSETTLED' && showSettleForm && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <span className="text-sm font-medium text-emerald-800">수금 수단:</span>
                <select
                  value={settleMethod}
                  onChange={e => setSettleMethod(e.target.value as 'cash' | 'card' | 'kakao')}
                  disabled={settling}
                  className="rounded-md border border-emerald-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50"
                >
                  <option value="cash">현금</option>
                  <option value="card">카드</option>
                  <option value="kakao">카카오페이</option>
                </select>
                <button onClick={handleSettleReceivable}
                  disabled={settling}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
                  {settling ? '처리 중...' : '수금 확정'}
                </button>
                <button onClick={() => setShowSettleForm(false)}
                  disabled={settling}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  취소
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
