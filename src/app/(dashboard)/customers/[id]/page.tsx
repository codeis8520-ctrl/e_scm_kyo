'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatPhone } from '@/lib/validators';
import { settleCreditOrder } from '@/lib/accounting-actions';
import { mergeCustomers } from '@/lib/actions';
import { fmtDateTimeKST, fmtDateKST, fmtKoreanMonthKST, kstDayStart, kstDayEnd } from '@/lib/date';
import CustomerModal from '../CustomerModal';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}

interface CustomerDetail {
  id: string;
  name: string;
  phone: string;
  phone2: string | null;
  email: string | null;
  address: string | null;
  grade: string;
  primary_branch_id: string | null;
  health_note: string | null;
  total_points: number;
  is_active: boolean;
  cafe24_member_id: string | null;
  created_at: string;
  primary_branch?: { id: string; name: string };
  tags?: { id: string; name: string; color: string }[];
  assigned_to?: { id: string; name: string } | null;
}

interface Consultation {
  id: string;
  consultation_type: string;
  content: Record<string, any>;
  consulted_by?: { name: string } | null;
  consulted_by_id?: string | null;
  created_at: string;
}

interface Tag { id: string; name: string; color: string; }
interface Branch { id: string; name: string; }
interface User { id: string; name: string; }

type TabKey = 'timeline' | 'consultations' | 'purchases' | 'legacy' | 'info';

interface LegacyOrderItem {
  line_seq: number | null;
  item_code: string | null;
  item_text: string | null;
  option_text: string | null;
  quantity: number | null;
  total_amount: number | null;
}

interface LegacyOrder {
  id: string;
  legacy_order_no: string | null;
  ordered_at: string;
  channel_text: string | null;
  branch_code_raw: string | null;
  branch?: { name: string } | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_address: string | null;
  payment_status: string | null;
  total_amount: number | null;
  source_file: string | null;
  legacy_order_items: LegacyOrderItem[];
}

const GRADE_COLORS: Record<string, string> = {
  NORMAL: 'bg-slate-100 text-slate-700',
  VIP: 'bg-blue-100 text-blue-700',
  VVIP: 'bg-amber-100 text-amber-700',
};
const GRADE_LABELS: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
const PAYMENT_LABELS: Record<string, string> = {
  cash: '현금', card: '카드', kakao: '카카오페이',
  card_keyin: '카드(키인)', credit: '외상',
};

const CONSULT_TYPES = ['전화 상담', '방문 상담', '구매 상담', '민원 처리', '기타'] as const;
const CONSULT_STYLE: Record<string, { bg: string; dot: string; text: string; border: string }> = {
  '전화 상담': { bg: 'bg-sky-50', dot: 'bg-sky-500', text: 'text-sky-700', border: 'border-sky-200' },
  '방문 상담': { bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-200' },
  '구매 상담': { bg: 'bg-violet-50', dot: 'bg-violet-500', text: 'text-violet-700', border: 'border-violet-200' },
  '민원 처리': { bg: 'bg-red-50', dot: 'bg-red-500', text: 'text-red-700', border: 'border-red-200' },
  '기타': { bg: 'bg-slate-50', dot: 'bg-slate-400', text: 'text-slate-700', border: 'border-slate-200' },
};
function consultStyle(t?: string | null) {
  if (!t) return CONSULT_STYLE['기타'];
  return CONSULT_STYLE[t] || CONSULT_STYLE['기타'];
}

function fmtDate(date: Date): string { return fmtDateKST(date); }
// 고객 상세 표시용 (KST). 쿼리 경계 계산에는 fmtDate(Date)를 계속 사용.
function fmtDateTime(iso: string): string {
  if (!iso) return '';
  return fmtDateTimeKST(iso);
}
// LEGACY 상담은 import 시점이 아니라 실제 상담 일자(content.consulted_at)를 우선 사용.
function consultDisplayDate(c: { consultation_type?: string; content: any; created_at: string }): string {
  if (c.consultation_type === 'LEGACY') {
    const consulted = c.content?.consulted_at;
    if (consulted) {
      // 'YYYY-MM-DD' → 동일 일자 정오로 변환 (정렬·표시 일관성)
      return /^\d{4}-\d{2}-\d{2}$/.test(consulted) ? `${consulted}T12:00:00+09:00` : String(consulted);
    }
  }
  return c.created_at;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}주 전`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}개월 전`;
  return `${Math.floor(diff / (86400 * 365))}년 전`;
}

const PERIOD_PRESETS = [
  { label: '1개월', months: 1 },
  { label: '3개월', months: 3 },
  { label: '6개월', months: 6 },
  { label: '1년', months: 12 },
  { label: '전체', months: 0 },
] as const;

function getDateRange(months: number): { start: string; end: string } {
  const end = new Date();
  if (months === 0) return { start: '2020-01-01', end: fmtDate(end) };
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  return { start: fmtDate(start), end: fmtDate(end) };
}

function extractText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content.text === 'string') return content.text;
  if (typeof content.summary === 'string') return content.summary;
  try { return JSON.stringify(content); } catch { return ''; }
}

export default function CustomerDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const customerId = params.id as string;
  const initialTab = (searchParams.get('tab') as TabKey) || 'consultations';

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [legacyOrders, setLegacyOrders] = useState<LegacyOrder[]>([]);
  const [expandedLegacy, setExpandedLegacy] = useState<Set<string>>(new Set());
  const [legacySearch, setLegacySearch] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);

  const [activePeriod, setActivePeriod] = useState(1);
  const [purchaseDateRange, setPurchaseDateRange] = useState(() => getDateRange(1));
  const [consultDateRange, setConsultDateRange] = useState(() => getDateRange(12));
  const [settlingOrderId, setSettlingOrderId] = useState<string | null>(null);
  const [purchaseProductSearch, setPurchaseProductSearch] = useState('');
  const [purchaseBranchFilter, setPurchaseBranchFilter] = useState('');

  // 상담 기록 필터/입력 상태
  const [consultTypeFilter, setConsultTypeFilter] = useState<string>('');
  const [consultTextSearch, setConsultTextSearch] = useState('');
  const [quickType, setQuickType] = useState<string>('전화 상담');
  const [quickContent, setQuickContent] = useState('');
  const [savingQuick, setSavingQuick] = useState(false);
  const [editingConsultId, setEditingConsultId] = useState<string | null>(null);
  const [editType, setEditType] = useState('');
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => { fetchData(); }, [customerId]);

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();

    const [customerRes, purchasesRes, consultationsRes, tagsRes, branchesRes, usersRes, pointRes, legacyRes] = await Promise.all([
      supabase
        .from('customers')
        .select(`*, primary_branch:branches(*), tags:customer_tag_map(tag:customer_tags(*)), assigned_to:users!customers_assigned_to_fkey(*)`)
        .eq('id', customerId)
        .single(),
      supabase
        .from('sales_orders')
        .select(`id, order_number, ordered_at, status, total_amount, discount_amount, payment_method, credit_settled, credit_settled_method, points_earned, points_used, branch_id, branch:branches(name, id), items:sales_order_items(id, quantity, unit_price, total_price, order_option, item_text, product:products(name))`)
        .eq('customer_id', customerId)
        .gte('ordered_at', kstDayStart(purchaseDateRange.start))
        .lte('ordered_at', kstDayEnd(purchaseDateRange.end))
        .order('ordered_at', { ascending: false }),
      supabase
        .from('customer_consultations')
        .select('*, consulted_by:users(name)')
        .eq('customer_id', customerId)
        .gte('created_at', kstDayStart(consultDateRange.start))
        .lte('created_at', kstDayEnd(consultDateRange.end))
        .order('created_at', { ascending: false }),
      supabase.from('customer_tags').select('*').order('name'),
      supabase.from('branches').select('id, name').eq('is_active', true),
      supabase.from('users').select('id, name').eq('is_active', true),
      supabase.from('point_history').select('balance').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      // legacy_orders 는 PostgREST db-max-rows(기본 1000) 캡 때문에 .range(0,9999) 로도
      // 1000건에서 잘린다. 1000건씩 페이지네이션해 전량 로드 (헤비 계정 집계 불일치 방지).
      (async () => {
        const PAGE = 1000;
        let all: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data } = await supabase
            .from('legacy_orders')
            .select('id, legacy_order_no, ordered_at, channel_text, branch_code_raw, recipient_name, recipient_phone, recipient_address, payment_status, total_amount, source_file, branch:branches(name), legacy_order_items(line_seq, item_code, item_text, option_text, quantity, total_amount)')
            .eq('customer_id', customerId)
            .order('ordered_at', { ascending: false })
            .order('legacy_order_no', { ascending: false })
            .range(from, from + PAGE - 1);
          if (!data?.length) break;
          all = all.concat(data);
          if (data.length < PAGE) break;
        }
        return { data: all };
      })(),
    ]) as any;

    if (customerRes.data) {
      const c = customerRes.data as any;
      setCustomer({
        ...c,
        total_points: pointRes?.data?.balance || 0,
        tags: c.tags?.map((t: any) => t.tag).filter(Boolean) || [],
      });
    }

    const filteredOrders = (purchasesRes.data || []).filter((order: any) => {
      if (purchaseBranchFilter && order.branch_id !== purchaseBranchFilter) return false;
      if (purchaseProductSearch) {
        const q = purchaseProductSearch.toLowerCase();
        const match = (order.items || []).some((i: any) =>
          (i.product?.name || i.item_text || '').toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
    setPurchaseOrders(filteredOrders);
    setLegacyOrders((legacyRes?.data || []) as LegacyOrder[]);
    // LEGACY 상담의 실제 일자(content.consulted_at) 기준으로 다시 정렬 — 시간순 일관성 확보
    const sortedConsults = ((consultationsRes.data || []) as Consultation[]).slice().sort((a, b) =>
      new Date(consultDisplayDate(b)).getTime() - new Date(consultDisplayDate(a)).getTime()
    );
    setConsultations(sortedConsults);
    setAllTags((tagsRes.data || []) as Tag[]);
    setBranches((branchesRes.data || []) as Branch[]);
    setUsers((usersRes.data || []) as User[]);
    setLoading(false);
  };

  const handlePeriodPreset = (months: number) => {
    setActivePeriod(months);
    const range = getDateRange(months);
    setPurchaseDateRange(range);
    setTimeout(() => fetchData(), 0);
  };

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedOrders(new Set());
      setAllExpanded(false);
    } else {
      setExpandedOrders(new Set(purchaseOrders.map((o: any) => o.id)));
      setAllExpanded(true);
    }
  };

  const productFrequency = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const order of purchaseOrders) {
      if (['CANCELLED', 'REFUNDED'].includes(order.status)) continue;
      for (const item of order.items || []) {
        const name = item.product?.name;
        if (name) freq[name] = (freq[name] || 0) + item.quantity;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [purchaseOrders]);

  const ordersWithMonthDividers = useMemo(() => {
    const result: { type: 'divider' | 'order'; month?: string; order?: any }[] = [];
    let lastMonth = '';
    for (const order of purchaseOrders) {
      const month = fmtKoreanMonthKST(order.ordered_at);
      if (month !== lastMonth) {
        result.push({ type: 'divider', month });
        lastMonth = month;
      }
      result.push({ type: 'order', order });
    }
    return result;
  }, [purchaseOrders]);

  const purchaseStats = useMemo(() => {
    const validOrders = purchaseOrders.filter(o => !['CANCELLED', 'REFUNDED'].includes(o.status));
    // LTV·누적구매액 = 실결제 합(#18: total_amount − discount_amount)
    const totalAmount = validOrders.reduce((s: number, o: any) => s + (Number(o.total_amount || 0) - Number(o.discount_amount || 0)), 0);
    const orderCount = validOrders.length;
    const lastDate = purchaseOrders.length > 0 ? purchaseOrders[0].ordered_at?.slice(0, 10) : null;

    let avgInterval: number | null = null;
    if (validOrders.length >= 2) {
      const dates = validOrders.map(o => new Date(o.ordered_at).getTime()).sort((a, b) => b - a);
      const intervals: number[] = [];
      for (let i = 0; i < dates.length - 1; i++) {
        intervals.push(Math.round((dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24)));
      }
      avgInterval = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length);
    }

    return {
      orderCount,
      totalAmount,
      lastDate,
      avgOrderValue: orderCount > 0 ? Math.round(totalAmount / orderCount) : 0,
      avgInterval,
    };
  }, [purchaseOrders]);

  // 상담 카운트 by type
  const consultCountByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of consultations) {
      counts[c.consultation_type] = (counts[c.consultation_type] || 0) + 1;
    }
    return counts;
  }, [consultations]);

  // 필터링된 상담
  const filteredConsultations = useMemo(() => {
    const q = consultTextSearch.trim().toLowerCase();
    return consultations.filter(c => {
      if (consultTypeFilter && c.consultation_type !== consultTypeFilter) return false;
      if (q) {
        const text = extractText(c.content).toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [consultations, consultTypeFilter, consultTextSearch]);

  // 통합 타임라인 (상담 + 주문 + 과거구매(자사몰 등) 시간순) — 고객의 모든 이력 포함
  const timelineItems = useMemo(() => {
    type Item =
      | { kind: 'consult'; at: string; data: Consultation }
      | { kind: 'order'; at: string; data: any }
      | { kind: 'legacy'; at: string; data: LegacyOrder };
    const items: Item[] = [];
    for (const c of consultations) items.push({ kind: 'consult', at: consultDisplayDate(c), data: c });
    for (const o of purchaseOrders) items.push({ kind: 'order', at: o.ordered_at, data: o });
    // 과거구매(legacy_orders): 자사몰 포함 모든 과거 구매 이력. 구매이력 탭과 별개로 타임라인에도 통합.
    for (const l of legacyOrders) items.push({ kind: 'legacy', at: l.ordered_at, data: l });
    items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    return items;
  }, [consultations, purchaseOrders, legacyOrders]);

  // 태그 관련
  const handleAddTag = async (tagId: string) => {
    const supabase = createClient() as any;
    await supabase.from('customer_tag_map').insert({ customer_id: customerId, tag_id: tagId });
    fetchData();
  };

  const handleRemoveTag = async (tagId: string) => {
    const supabase = createClient() as any;
    await supabase.from('customer_tag_map').delete().eq('customer_id', customerId).eq('tag_id', tagId);
    fetchData();
  };

  const handleUpdateAssignedTo = async (userId: string | null) => {
    const supabase = createClient() as any;
    await supabase.from('customers').update({ assigned_to: userId }).eq('id', customerId);
    fetchData();
    setShowAssignModal(false);
  };

  // 상담 추가/수정/삭제
  const handleQuickAdd = async () => {
    if (!quickContent.trim() || savingQuick) return;
    setSavingQuick(true);
    try {
      const supabase = createClient() as any;
      const userId = getCookie('user_id');
      const { error } = await supabase.from('customer_consultations').insert({
        customer_id: customerId,
        consultation_type: quickType,
        content: { text: quickContent.trim() },
        consulted_by: userId || null,
      });
      if (error) {
        alert('저장 실패: ' + error.message);
      } else {
        setQuickContent('');
        await fetchData();
      }
    } finally {
      setSavingQuick(false);
    }
  };

  const startEditConsult = (c: Consultation) => {
    setEditingConsultId(c.id);
    setEditType(c.consultation_type);
    setEditContent(extractText(c.content));
  };
  const cancelEdit = () => {
    setEditingConsultId(null);
    setEditType('');
    setEditContent('');
  };
  const saveEdit = async () => {
    if (!editingConsultId || savingEdit) return;
    setSavingEdit(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase
        .from('customer_consultations')
        .update({
          consultation_type: editType,
          content: { text: editContent.trim() },
        })
        .eq('id', editingConsultId);
      if (error) alert('수정 실패: ' + error.message);
      else {
        cancelEdit();
        await fetchData();
      }
    } finally {
      setSavingEdit(false);
    }
  };
  const deleteConsult = async (id: string) => {
    if (!confirm('이 상담 기록을 삭제할까요?')) return;
    const supabase = createClient() as any;
    const { error } = await supabase.from('customer_consultations').delete().eq('id', id);
    if (error) alert('삭제 실패: ' + error.message);
    else await fetchData();
  };

  const handleSettleCredit = async (orderId: string, method: 'cash' | 'card' | 'kakao' | 'card_keyin') => {
    setSettlingOrderId(orderId);
    try {
      const result = await settleCreditOrder({ orderId, settledMethod: method });
      if (result.success) fetchData();
      else alert(`수금 처리 실패: ${result.error}`);
    } finally { setSettlingOrderId(null); }
  };

  const toggleOrder = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleLegacy = (orderId: string) => {
    setExpandedLegacy(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const handleDateFilterChange = (type: 'purchase' | 'consult', field: 'start' | 'end', value: string) => {
    if (type === 'purchase') {
      setActivePeriod(-1);
      setPurchaseDateRange(prev => ({ ...prev, [field]: value }));
    } else {
      setConsultDateRange(prev => ({ ...prev, [field]: value }));
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-slate-500">로딩 중...</div></div>;
  }
  if (!customer) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500">고객을 찾을 수 없습니다.</p>
        <Link href="/customers" className="text-blue-600 hover:underline mt-4 inline-block">고객 목록으로 돌아가기</Link>
      </div>
    );
  }

  const customerTags = customer.tags || [];
  const availableTags = allTags.filter(t => !customerTags.find(ct => ct.id === t.id));

  // "← 목록" 복원용 — 목록 검색 키만 추려 href 구성 (상세전용 tab 제외)
  const backHref = (() => {
    const keys = ['q', 'grade', 'hasConsult', 'sort', 'page'];
    const p = new URLSearchParams();
    for (const k of keys) { const v = searchParams.get(k); if (v) p.set(k, v); }
    const qs = p.toString();
    return qs ? `/customers?${qs}` : '/customers';
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-4">
          <Link href={backHref} className="text-slate-400 hover:text-slate-600">← 목록</Link>
          <div>
            <h1 className="text-2xl font-bold">{customer.name}</h1>
            <p className="text-slate-500">
              {formatPhone(customer.phone)}
              {customer.phone2 && <span> · {formatPhone(customer.phone2)}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowMergeModal(true)} className="btn-secondary text-sm"
            title="동명이인으로 쪼개진 같은 고객을 이 고객으로 합칩니다">
            고객 병합
          </button>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${GRADE_COLORS[customer.grade] || ''}`}>
            {GRADE_LABELS[customer.grade] || customer.grade}
          </span>
          {!customer.is_active && <span className="badge badge-error">비활성</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 사이드바 */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">기본 정보</h3>
              <button onClick={() => setShowEditModal(true)} className="text-sm text-blue-600 hover:underline">수정</button>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">이메일</dt><dd>{customer.email || '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">주소</dt><dd className="text-right max-w-[180px] truncate" title={customer.address || ''}>{customer.address || '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">담당 지점</dt><dd>{customer.primary_branch?.name || '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">적립 포인트</dt><dd className="font-medium text-blue-600">{customer.total_points?.toLocaleString() || 0}P</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">고객 등급</dt><dd>{GRADE_LABELS[customer.grade] || customer.grade}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">자사몰 ID</dt><dd className="font-mono text-xs">{customer.cafe24_member_id || '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">등록일</dt><dd>{fmtDateKST(customer.created_at)}</dd></div>
              {customer.assigned_to && (
                <div className="flex justify-between"><dt className="text-slate-500">담당자</dt><dd>{customer.assigned_to.name}</dd></div>
              )}
            </dl>
            <button onClick={() => setShowAssignModal(true)} className="mt-4 w-full text-sm text-blue-600 hover:underline">
              {customer.assigned_to ? '담당자 변경' : '담당자 지정'}
            </button>
          </div>

          <div className="card">
            <div className="flex justify-between items-center mb-3"><h3 className="font-semibold">태그</h3></div>
            <div className="flex flex-wrap gap-2 mb-3">
              {customerTags.map(tag => (
                <span key={tag.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-white" style={{ backgroundColor: tag.color }}>
                  {tag.name}
                  <button onClick={() => handleRemoveTag(tag.id)} className="hover:opacity-70">x</button>
                </span>
              ))}
              {customerTags.length === 0 && <span className="text-slate-400 text-sm">등록된 태그 없음</span>}
            </div>
            {availableTags.length > 0 && (
              <select onChange={(e) => { if (e.target.value) { handleAddTag(e.target.value); e.target.value = ''; } }} className="input text-sm" defaultValue="">
                <option value="">+ 태그 추가</option>
                {availableTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            )}
          </div>

          {customer.health_note && (
            <div className="card">
              <h3 className="font-semibold mb-3">건강 메모</h3>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{customer.health_note}</p>
            </div>
          )}

          <div className="card">
            <h3 className="font-semibold mb-3">상담 요약</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">총 상담 건수</dt>
                <dd className="font-medium text-slate-700">{consultations.length}건</dd>
              </div>
              {consultations[0] && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">최근 상담</dt>
                  <dd className="text-slate-700">{relativeTime(consultations[0].created_at)}</dd>
                </div>
              )}
              {Object.entries(consultCountByType).map(([type, count]) => (
                <div key={type} className="flex justify-between items-center">
                  <dt className="text-xs text-slate-500">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${consultStyle(type).dot}`}></span>
                    {type}
                  </dt>
                  <dd className="text-xs text-slate-600">{count}건</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-3">구매 요약</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">주문 건수</dt><dd>{purchaseStats.orderCount}건</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">누적 구매액 (LTV)</dt><dd className="font-semibold text-blue-700">{purchaseStats.totalAmount.toLocaleString()}원</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">평균 주문 금액</dt><dd>{purchaseStats.avgOrderValue.toLocaleString()}원</dd></div>
              {purchaseStats.avgInterval !== null && (
                <div className="flex justify-between"><dt className="text-slate-500">주문 간격</dt><dd>평균 {purchaseStats.avgInterval}일</dd></div>
              )}
              {purchaseStats.lastDate && (
                <div className="flex justify-between"><dt className="text-slate-500">최근 구매일</dt><dd>{purchaseStats.lastDate}</dd></div>
              )}
            </dl>
          </div>
        </div>

        {/* 메인 콘텐츠 */}
        <div className="lg:col-span-2">
          <div className="flex overflow-x-auto gap-1 border-b border-slate-200 mb-4">
            {([
              { key: 'consultations' as TabKey, label: `상담 기록 (${consultations.length})` },
              { key: 'timeline' as TabKey, label: `통합 타임라인` },
              { key: 'purchases' as TabKey, label: `구매 이력 (${purchaseOrders.length})` },
              ...(legacyOrders.length > 0 ? [{ key: 'legacy' as TabKey, label: `과거 구매 (${legacyOrders.length})` }] : []),
              { key: 'info' as TabKey, label: '기본 정보' },
            ]).map(t => (
              <button key={t.key} onClick={() => {
                setActiveTab(t.key);
                const sp = new URLSearchParams(searchParams.toString());
                sp.set('tab', t.key);
                router.replace(`/customers/${customerId}?${sp.toString()}`, { scroll: false });
              }}
                className={`px-4 py-2 font-medium border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* 상담 기록 (기본 탭) */}
          {activeTab === 'consultations' && (
            <div className="space-y-4">
              {/* 빠른 추가 */}
              <div className="card border-blue-100 bg-blue-50/30">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm text-slate-700">상담 기록 추가</h4>
                  <div className="flex flex-wrap gap-1">
                    {CONSULT_TYPES.map(t => {
                      const s = consultStyle(t);
                      const active = quickType === t;
                      return (
                        <button
                          key={t}
                          onClick={() => setQuickType(t)}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                            active ? `${s.bg} ${s.text} ${s.border} font-medium` : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <textarea
                  value={quickContent}
                  onChange={(e) => setQuickContent(e.target.value)}
                  placeholder="상담 내용을 입력하세요 (Ctrl+Enter로 저장)"
                  rows={3}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleQuickAdd();
                  }}
                  className="input text-sm w-full"
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => setQuickContent('')}
                    disabled={!quickContent}
                    className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-40 px-3"
                  >
                    지우기
                  </button>
                  <button
                    onClick={handleQuickAdd}
                    disabled={!quickContent.trim() || savingQuick}
                    className="btn-primary py-1.5 px-4 text-sm disabled:opacity-50"
                  >
                    {savingQuick ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>

              {/* 필터 */}
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setConsultTypeFilter('')}
                    className={`px-2.5 py-1 text-xs rounded-full border ${
                      !consultTypeFilter ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    전체 ({consultations.length})
                  </button>
                  {CONSULT_TYPES.map(t => {
                    const s = consultStyle(t);
                    const active = consultTypeFilter === t;
                    const cnt = consultCountByType[t] || 0;
                    if (cnt === 0 && !active) return null;
                    return (
                      <button
                        key={t}
                        onClick={() => setConsultTypeFilter(active ? '' : t)}
                        className={`px-2.5 py-1 text-xs rounded-full border ${
                          active ? `${s.bg} ${s.text} ${s.border} font-medium` : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {t} ({cnt})
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="date"
                  value={consultDateRange.start}
                  onChange={(e) => handleDateFilterChange('consult', 'start', e.target.value)}
                  className="input w-36"
                />
                <span className="text-slate-400">~</span>
                <input
                  type="date"
                  value={consultDateRange.end}
                  onChange={(e) => handleDateFilterChange('consult', 'end', e.target.value)}
                  className="input w-36"
                />
                <input
                  type="text"
                  value={consultTextSearch}
                  onChange={(e) => setConsultTextSearch(e.target.value)}
                  placeholder="상담 내용 검색"
                  className="input flex-1 min-w-[150px]"
                />
                <button onClick={() => fetchData()} className="btn-secondary">기간 조회</button>
                <button
                  onClick={() => {
                    setConsultDateRange(getDateRange(12));
                    setConsultTypeFilter('');
                    setConsultTextSearch('');
                    setTimeout(() => fetchData(), 0);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  초기화
                </button>
              </div>

              {/* 타임라인 리스트 */}
              {filteredConsultations.length > 0 ? (
                <div className="relative pl-4 border-l-2 border-slate-200 space-y-3">
                  {filteredConsultations.map(consult => {
                    const s = consultStyle(consult.consultation_type);
                    const isEditing = editingConsultId === consult.id;
                    return (
                      <div key={consult.id} className="relative">
                        <span className={`absolute -left-[21px] top-4 w-3 h-3 rounded-full ring-4 ring-white ${s.dot}`}></span>
                        <div className={`card border ${s.border}`}>
                          {isEditing ? (
                            <div className="space-y-2">
                              <select value={editType} onChange={(e) => setEditType(e.target.value)} className="input text-sm">
                                {CONSULT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                rows={4}
                                className="input text-sm w-full"
                              />
                              <div className="flex justify-end gap-2">
                                <button onClick={cancelEdit} className="text-sm text-slate-500 hover:text-slate-700 px-3">취소</button>
                                <button
                                  onClick={saveEdit}
                                  disabled={savingEdit || !editContent.trim()}
                                  className="btn-primary py-1.5 px-4 text-sm disabled:opacity-50"
                                >
                                  {savingEdit ? '저장 중...' : '수정 저장'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex justify-between items-start gap-2 mb-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${s.bg} ${s.text} ${s.border}`}>
                                    {consult.consultation_type || '기타'}
                                  </span>
                                  <span className="text-xs text-slate-500">{consult.consulted_by?.name || '시스템'}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-400 whitespace-nowrap">
                                  {(() => {
                                    const isLegacy = consult.consultation_type === 'LEGACY';
                                    const consulted = isLegacy ? (consult.content as any)?.consulted_at : null;
                                    if (isLegacy && consulted) {
                                      return (
                                        <>
                                          <span className="font-medium text-slate-600">{consulted}</span>
                                          <span title={`임포트 시점: ${fmtDateTime(consult.created_at)}`} className="text-slate-300">(상담일)</span>
                                        </>
                                      );
                                    }
                                    return (
                                      <>
                                        <span title={fmtDateTime(consult.created_at)}>{relativeTime(consult.created_at)}</span>
                                        <span>·</span>
                                        <span>{fmtDateTime(consult.created_at)}</span>
                                      </>
                                    );
                                  })()}
                                  <button
                                    onClick={() => startEditConsult(consult)}
                                    className="text-slate-400 hover:text-blue-600 ml-1"
                                    title="수정"
                                  >
                                    수정
                                  </button>
                                  <button
                                    onClick={() => deleteConsult(consult.id)}
                                    className="text-slate-400 hover:text-red-600"
                                    title="삭제"
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>
                              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                {extractText(consult.content) || <span className="text-slate-400">(내용 없음)</span>}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="card text-center text-slate-400 py-8">
                  {consultations.length === 0 ? '상담 기록이 없습니다' : '조건에 맞는 상담이 없습니다'}
                </div>
              )}
            </div>
          )}

          {/* 통합 타임라인 */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-slate-500">상담·주문·과거구매(자사몰 포함)를 시간 순으로 모아 고객의 모든 이력을 통합 추적합니다.</p>
                <div className="text-xs text-slate-500">
                  상담 {consultations.length}건 · 주문 {purchaseOrders.length}건{legacyOrders.length > 0 && <> · 과거 {legacyOrders.length}건</>}
                </div>
              </div>

              {timelineItems.length === 0 ? (
                <div className="card text-center text-slate-400 py-8">기록된 활동이 없습니다</div>
              ) : (
                <div className="relative pl-4 border-l-2 border-slate-200 space-y-3">
                  {timelineItems.map((item, idx) => {
                    if (item.kind === 'consult') {
                      const c = item.data;
                      const s = consultStyle(c.consultation_type);
                      return (
                        <div key={`c-${c.id}`} className="relative">
                          <span className={`absolute -left-[21px] top-4 w-3 h-3 rounded-full ring-4 ring-white ${s.dot}`}></span>
                          <div className={`card border ${s.border}`}>
                            <div className="flex justify-between items-start gap-2 mb-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${s.bg} ${s.text} ${s.border}`}>
                                  상담 · {c.consultation_type || '기타'}
                                </span>
                                <span className="text-xs text-slate-500">{c.consulted_by?.name || '시스템'}</span>
                              </div>
                              <div className="text-xs text-slate-400 whitespace-nowrap">
                                {(() => {
                                  const isLegacy = c.consultation_type === 'LEGACY';
                                  const consulted = isLegacy ? (c.content as any)?.consulted_at : null;
                                  if (isLegacy && consulted) {
                                    return (
                                      <>
                                        <span className="font-medium text-slate-600">{consulted}</span>
                                        <span title={`임포트 시점: ${fmtDateTime(c.created_at)}`} className="text-slate-300 ml-1">(상담일)</span>
                                      </>
                                    );
                                  }
                                  return (
                                    <>
                                      <span title={fmtDateTime(c.created_at)}>{relativeTime(c.created_at)}</span>
                                      <span className="mx-1">·</span>
                                      <span>{fmtDateTime(c.created_at)}</span>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap line-clamp-3">
                              {extractText(c.content) || <span className="text-slate-400">(내용 없음)</span>}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    if (item.kind === 'legacy') {
                      const l = item.data;
                      const li = (l.legacy_order_items || []).slice(0, 3).map((i: LegacyOrderItem) => i.item_text).filter(Boolean);
                      const liExtra = (l.legacy_order_items?.length || 0) - li.length;
                      return (
                        <div key={`l-${l.id}`} className="relative">
                          <span className="absolute -left-[21px] top-4 w-3 h-3 rounded-full ring-4 ring-white bg-amber-400"></span>
                          <div className="card border border-amber-100">
                            <div className="flex justify-between items-start gap-2 mb-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-block px-2 py-0.5 text-xs font-medium rounded border bg-amber-50 text-amber-700 border-amber-200">
                                  과거구매{l.legacy_order_no ? ` · ${l.legacy_order_no}` : ''}
                                </span>
                                {l.channel_text && <span className="text-xs text-slate-500">{l.channel_text}</span>}
                              </div>
                              <div className="text-xs text-slate-400 whitespace-nowrap" title={fmtDateTime(l.ordered_at)}>
                                {fmtDateTime(l.ordered_at)}
                              </div>
                            </div>
                            <div className="flex justify-between items-center gap-4">
                              <p className="text-sm text-slate-700 flex-1 truncate">
                                {li.join(', ')}
                                {liExtra > 0 && <span className="text-slate-400"> 외 {liExtra}종</span>}
                              </p>
                              <span className="font-semibold text-sm text-slate-800">
                                {Number(l.total_amount || 0).toLocaleString()}원
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    // order
                    const o = item.data;
                    const isRefunded = ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(o.status);
                    const isCancelled = o.status === 'CANCELLED';
                    const statusLabel: Record<string, string> = { COMPLETED: '완료', CANCELLED: '취소', REFUNDED: '환불', PARTIALLY_REFUNDED: '부분환불' };
                    const mainItems = (o.items || []).slice(0, 3).map((i: any) => i.product?.name || i.item_text).filter(Boolean);
                    const extraCount = (o.items?.length || 0) - mainItems.length;
                    return (
                      <div key={`o-${o.id}`} className="relative">
                        <span className="absolute -left-[21px] top-4 w-3 h-3 rounded-full ring-4 ring-white bg-blue-500"></span>
                        <div className={`card border border-blue-100 ${isCancelled || isRefunded ? 'opacity-60' : ''}`}>
                          <div className="flex justify-between items-start gap-2 mb-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-block px-2 py-0.5 text-xs font-medium rounded border bg-blue-50 text-blue-700 border-blue-200">
                                주문 · {o.order_number}
                              </span>
                              <span className="text-xs text-slate-500">{o.branch?.name}</span>
                              {o.status !== 'COMPLETED' && (
                                <span className="text-xs text-amber-600">{statusLabel[o.status] || o.status}</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 whitespace-nowrap">
                              <span title={fmtDateTime(o.ordered_at)}>{relativeTime(o.ordered_at)}</span>
                              <span className="mx-1">·</span>
                              <span>{fmtDateTime(o.ordered_at)}</span>
                            </div>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <p className="text-sm text-slate-700 flex-1 truncate">
                              {mainItems.join(', ')}
                              {extraCount > 0 && <span className="text-slate-400"> 외 {extraCount}종</span>}
                            </p>
                            <span className={`font-semibold text-sm ${isRefunded || isCancelled ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                              {(Number(o.total_amount || 0) - Number(o.discount_amount || 0)).toLocaleString()}원
                            </span>
                          </div>
                          <div className="flex gap-3 mt-1 text-xs text-slate-500">
                            {o.payment_method && <span>결제: {PAYMENT_LABELS[o.payment_method] || o.payment_method}</span>}
                            {o.payment_method === 'credit' && !o.credit_settled && (
                              <span className="text-orange-600 font-medium">수금 전</span>
                            )}
                            {o.points_earned > 0 && <span className="text-blue-600">+{o.points_earned.toLocaleString()}P</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 구매 이력 */}
          {activeTab === 'purchases' && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {PERIOD_PRESETS.map(p => (
                    <button key={p.months} onClick={() => handlePeriodPreset(p.months)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        activePeriod === p.months ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <input type="date" value={purchaseDateRange.start} onChange={(e) => handleDateFilterChange('purchase', 'start', e.target.value)} className="input w-36" />
                  <span className="text-slate-400">~</span>
                  <input type="date" value={purchaseDateRange.end} onChange={(e) => handleDateFilterChange('purchase', 'end', e.target.value)} className="input w-36" />
                  <input type="text" placeholder="제품명 검색" value={purchaseProductSearch}
                    onChange={(e) => setPurchaseProductSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchData()}
                    className="input w-36" />
                  <select value={purchaseBranchFilter} onChange={(e) => setPurchaseBranchFilter(e.target.value)} className="input w-36">
                    <option value="">전체 지점</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <button onClick={() => fetchData()} className="btn-secondary">조회</button>
                  <button onClick={() => {
                    setActivePeriod(1);
                    setPurchaseDateRange(getDateRange(1));
                    setPurchaseProductSearch('');
                    setPurchaseBranchFilter('');
                    setTimeout(() => fetchData(), 0);
                  }} className="text-sm text-slate-500 hover:text-slate-700">초기화</button>
                </div>
              </div>

              {productFrequency.length > 0 && (
                <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-500 font-medium self-center mr-1">구매 제품:</span>
                  {productFrequency.map(([name, count]) => (
                    <button key={name}
                      onClick={() => { setPurchaseProductSearch(name); setTimeout(() => fetchData(), 0); }}
                      className="px-2 py-1 text-xs rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-blue-50 hover:border-blue-300 transition-colors">
                      {name} <span className="text-blue-600 font-medium">({count})</span>
                    </button>
                  ))}
                </div>
              )}

              {purchaseOrders.length > 0 && (
                <div className="flex justify-end">
                  <button onClick={toggleExpandAll} className="text-xs text-slate-500 hover:text-slate-700">
                    {allExpanded ? '전체 접기' : '전체 펼치기'}
                  </button>
                </div>
              )}

              {purchaseOrders.length === 0 ? (
                <div className="card text-center text-slate-400 py-8">구매 이력이 없습니다</div>
              ) : (
                <div className="space-y-1">
                  {ordersWithMonthDividers.map((item) => {
                    if (item.type === 'divider') {
                      return (
                        <div key={`div-${item.month}`} className="flex items-center gap-3 py-2 mt-2 first:mt-0">
                          <div className="flex-1 h-px bg-slate-200" />
                          <span className="text-xs font-medium text-slate-400 whitespace-nowrap">{item.month}</span>
                          <div className="flex-1 h-px bg-slate-200" />
                        </div>
                      );
                    }

                    const order = item.order;
                    const isExpanded = expandedOrders.has(order.id);
                    const isRefunded = ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.status);
                    const isCancelled = order.status === 'CANCELLED';
                    const statusLabel: Record<string, string> = { COMPLETED: '완료', CANCELLED: '취소', REFUNDED: '환불', PARTIALLY_REFUNDED: '부분환불' };
                    const statusColor: Record<string, string> = { COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-slate-100 text-slate-500', REFUNDED: 'bg-red-100 text-red-600', PARTIALLY_REFUNDED: 'bg-amber-100 text-amber-700' };
                    const itemCount = (order.items || []).length;

                    return (
                      <div key={order.id} className={`border rounded-lg overflow-hidden ${isCancelled || isRefunded ? 'opacity-60' : ''}`}>
                        <button onClick={() => toggleOrder(order.id)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 text-left">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                            <div>
                              <p className="font-mono text-sm font-semibold text-blue-700">{order.order_number}</p>
                              <p className="text-xs text-slate-500">
                                {order.ordered_at?.slice(0, 16).replace('T', ' ')} · {order.branch?.name}
                                {itemCount > 0 && <span className="ml-2 text-slate-400">제품 {itemCount}종</span>}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {order.payment_method === 'credit' && !order.credit_settled && (
                              <span className="badge text-xs bg-orange-100 text-orange-700">수금 전</span>
                            )}
                            <span className={`badge text-xs ${statusColor[order.status] || ''}`}>
                              {statusLabel[order.status] || order.status}
                            </span>
                            <div className="text-right">
                              <p className={`font-semibold text-sm ${isRefunded || isCancelled ? 'line-through text-slate-400' : ''}`}>
                                {(order.total_amount || 0).toLocaleString()}원
                              </p>
                              {order.points_earned > 0 && (
                                <p className="text-xs text-blue-500">+{order.points_earned.toLocaleString()}P</p>
                              )}
                            </div>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="border-t bg-slate-50 px-4 py-3">
                            <div className="overflow-x-auto">
                            <table className="table text-sm min-w-[400px]">
                              <thead><tr><th>제품</th><th className="w-16 text-center">수량</th><th className="w-28 text-right">단가</th><th className="w-28 text-right">금액</th></tr></thead>
                              <tbody>
                                {(order.items || []).map((it: any) => (
                                  <tr key={it.id}>
                                    <td>
                                      <div>{it.product?.name || it.item_text || '-'}</div>
                                      {it.order_option && (
                                        <div className="text-xs text-pink-600 mt-0.5">🎀 {it.order_option}</div>
                                      )}
                                    </td>
                                    <td className="text-center">{it.quantity}</td>
                                    <td className="text-right">{it.unit_price.toLocaleString()}원</td>
                                    <td className="text-right font-medium">{it.total_price.toLocaleString()}원</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            </div>
                            <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                              {order.payment_method && <span>결제: {PAYMENT_LABELS[order.payment_method] || order.payment_method}</span>}
                              {order.payment_method === 'credit' && order.credit_settled && (
                                <span className="text-green-600">수금완료 ({PAYMENT_LABELS[order.credit_settled_method] || order.credit_settled_method})</span>
                              )}
                              {order.points_used > 0 && <span className="text-amber-600">포인트 사용: -{order.points_used.toLocaleString()}P</span>}
                              {order.points_earned > 0 && <span className="text-blue-600">포인트 적립: +{order.points_earned.toLocaleString()}P</span>}
                            </div>
                            {order.payment_method === 'credit' && !order.credit_settled && (
                              <div className="mt-3 pt-3 border-t border-slate-200">
                                <p className="text-xs text-slate-500 mb-2">수금 처리</p>
                                <div className="flex flex-wrap gap-2">
                                  {(['cash', 'card', 'card_keyin', 'kakao'] as const).map(m => (
                                    <button key={m} disabled={settlingOrderId === order.id} onClick={() => handleSettleCredit(order.id, m)}
                                      className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100 disabled:opacity-50">
                                      {settlingOrderId === order.id ? '처리 중...' : PAYMENT_LABELS[m]}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {!isCancelled && !isRefunded && (
                              <div className="mt-3 pt-3 border-t border-slate-200 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(`${order.order_number} 전표를 복사해 새 판매로 등록할까요?\n수령현황·일자·승인 상태는 초기화됩니다.`)) {
                                      router.push(`/pos?copy=${order.id}`);
                                    }
                                  }}
                                  className="text-xs px-3 py-1.5 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                  title="이 전표의 품목·배송·고객 정보를 복사해 새 판매 전표 생성"
                                >
                                  📋 이 전표 복사하여 새 판매 등록
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'legacy' && (
            <div className="space-y-3">
              <div className="card bg-amber-50/40 border-amber-200">
                <div className="flex items-start gap-2">
                  <span className="text-amber-700 text-lg">📦</span>
                  <div className="text-xs text-amber-900 leading-relaxed">
                    <b>과거 구매 (Legacy)</b> — 외부 시스템(엑셀)에서 임포트한 과거 거래.
                    품목은 원본 텍스트 그대로 표시되며 시스템 매출/재고/회계에는 반영되지 않습니다.
                    <span className="ml-2 text-amber-600">총 <b>{legacyOrders.length}</b>건(주문) · 합계 <b>{legacyOrders.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0).toLocaleString()}원</b></span>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="품목/매출처/지점 검색"
                    value={legacySearch}
                    onChange={e => setLegacySearch(e.target.value)}
                    className="input text-sm py-1.5 w-60"
                  />
                  {legacySearch && (
                    <button onClick={() => setLegacySearch('')} className="text-xs text-slate-500 underline">초기화</button>
                  )}
                </div>

                {legacyOrders.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 text-sm">과거 구매 이력이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {legacyOrders
                      .filter(o => {
                        if (!legacySearch) return true;
                        const q = legacySearch.toLowerCase();
                        return (
                          (o.channel_text || '').toLowerCase().includes(q) ||
                          (o.branch?.name || '').toLowerCase().includes(q) ||
                          (o.branch_code_raw || '').toLowerCase().includes(q) ||
                          (o.legacy_order_items || []).some(it => (it.item_text || '').toLowerCase().includes(q))
                        );
                      })
                      .map(o => {
                        const items = [...(o.legacy_order_items || [])].sort(
                          (a, b) => (a.line_seq ?? 0) - (b.line_seq ?? 0)
                        );
                        const isOpen = expandedLegacy.has(o.id);
                        const hasRecipient = !!(o.recipient_name || o.recipient_phone || o.recipient_address);
                        return (
                          <div key={o.id} className="border border-slate-200 rounded-lg overflow-hidden">
                            <button
                              onClick={() => toggleLegacy(o.id)}
                              className="w-full text-left px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
                            >
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="text-slate-400 text-xs">{isOpen ? '▾' : '▸'}</span>
                                <span className="text-sm font-medium text-slate-700 whitespace-nowrap">{o.ordered_at}</span>
                                {o.branch?.name ? (
                                  <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs">{o.branch.name}</span>
                                ) : (
                                  <span className="text-slate-400 font-mono text-[11px]">{o.branch_code_raw || '-'}</span>
                                )}
                                <span className="text-xs text-slate-500">{o.channel_text || '-'}</span>
                                {o.payment_status === '결제 완료' ? (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs">완료</span>
                                ) : o.payment_status === '미결' ? (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">미결</span>
                                ) : o.payment_status ? (
                                  <span className="text-slate-500 text-xs">{o.payment_status}</span>
                                ) : null}
                                <span className="ml-auto text-sm font-semibold text-slate-800 whitespace-nowrap">
                                  {o.total_amount ? `${Number(o.total_amount).toLocaleString()}원` : '-'}
                                </span>
                                <span className="text-[11px] text-slate-400 whitespace-nowrap">({items.length}품목)</span>
                              </div>
                              <div className="mt-1.5 ml-6 text-xs">
                                {hasRecipient ? (
                                  <span className="text-slate-600">
                                    🚚 발송지: {o.recipient_name || '-'} · {o.recipient_phone || '-'} · {o.recipient_address || '-'}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">🚚 발송지 정보 없음</span>
                                )}
                              </div>
                            </button>

                            {isOpen && (
                              <div className="divide-y divide-slate-100">
                                {items.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-slate-400">품목 정보가 없습니다.</p>
                                ) : (
                                  items.map((it, idx) => (
                                    <div key={idx} className="px-3 py-2 flex items-start gap-3">
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{it.item_text || '-'}</div>
                                        {it.option_text && (
                                          <div className="text-xs text-slate-400">{it.option_text}</div>
                                        )}
                                        {it.item_code && (
                                          <div className="font-mono text-[10px] text-slate-300">{it.item_code}</div>
                                        )}
                                      </div>
                                      <div className="text-center text-slate-600 text-sm whitespace-nowrap w-12">{it.quantity ?? '-'}</div>
                                      <div className="text-right font-medium text-slate-700 text-sm whitespace-nowrap w-24">
                                        {it.total_amount ? `${Number(it.total_amount).toLocaleString()}원` : '-'}
                                      </div>
                                    </div>
                                  ))
                                )}
                                <div className="px-3 py-1.5 flex items-center justify-between">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (confirm('이 과거 주문을 복사해 새 판매로 등록할까요?\n수령자·주소는 자동 채워지고, 매칭 안 된 품목은 POS 참고 패널에 표시됩니다.')) {
                                        router.push(`/pos?legacyCopy=${o.id}`);
                                      }
                                    }}
                                    className="text-xs px-3 py-1.5 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                    title="이 과거 주문을 복사해 새 판매 전표 생성"
                                  >
                                    📋 복사
                                  </button>
                                  <span className="font-mono text-[11px] text-slate-300">{o.legacy_order_no || ''}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'info' && (
            <div className="card">
              <h3 className="font-semibold mb-4">추가 정보</h3>
              <button onClick={() => setShowEditModal(true)} className="btn-secondary text-sm">기본 정보 수정</button>
            </div>
          )}
        </div>
      </div>

      {showAssignModal && <AssignModal currentUserId={customer.assigned_to?.id} users={users} onClose={() => setShowAssignModal(false)} onSubmit={handleUpdateAssignedTo} />}

      {showEditModal && (
        <CustomerModal
          customer={customer}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => { setShowEditModal(false); fetchData(); }}
        />
      )}

      {showMergeModal && (
        <MergeModal
          primary={{ id: customer.id, name: customer.name, phone: customer.phone, phone2: customer.phone2 }}
          onClose={() => setShowMergeModal(false)}
          onMerged={() => { setShowMergeModal(false); fetchData(); }}
        />
      )}
    </div>
  );
}

// ─── 고객 병합 모달 — 현재(대표) 고객에 다른(보조) 고객을 합침 ──────────────────
function MergeModal({
  primary, onClose, onMerged,
}: {
  primary: { id: string; name: string; phone: string; phone2: string | null };
  onClose: () => void;
  onMerged: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; phone: string; phone2: string | null }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string; phone: string; phone2: string | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const runSearch = async () => {
    const term = q.trim().replace(/[,()%*'"]/g, ' ').trim();
    if (!term) { setResults([]); return; }
    setSearching(true); setErr('');
    try {
      const sb = createClient();
      const { data } = await sb
        .from('customers')
        .select('id, name, phone, phone2')
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%,phone2.ilike.%${term}%`)
        .neq('id', primary.id)
        .limit(20);
      setResults((data as any) || []);
      setPicked(null);
    } finally {
      setSearching(false);
    }
  };

  const doMerge = async () => {
    if (!picked) return;
    // 양쪽 모두 포인트 이력이 있으면 병합 후 잔액(running balance)이 어긋날 수 있어 경고
    let pointsWarn = '';
    try {
      const sb = createClient();
      const [pri, sec] = await Promise.all([
        sb.from('point_history').select('id', { count: 'exact', head: true }).eq('customer_id', primary.id),
        sb.from('point_history').select('id', { count: 'exact', head: true }).eq('customer_id', picked.id),
      ]);
      if ((pri.count || 0) > 0 && (sec.count || 0) > 0) {
        pointsWarn = `⚠️ 두 고객 모두 포인트 이력이 있습니다. 병합 후 적립 잔액이 어긋날 수 있으니 병합 후 포인트를 확인/조정하세요.\n\n`;
      }
    } catch { /* 포인트 체크 실패는 병합을 막지 않음 */ }

    if (!confirm(
      pointsWarn +
      `'${picked.name}' (${formatPhone(picked.phone)}) 를\n'${primary.name}' (${formatPhone(primary.phone)}) 로 병합합니다.\n\n` +
      `· 선택 고객의 주문·구매·상담 이력이 모두 현재 고객으로 이전됩니다.\n` +
      `· 선택 고객(${formatPhone(picked.phone)})은 삭제되고, 그 번호는 현재 고객의 전화번호2에 보존됩니다.\n` +
      `· 되돌릴 수 없습니다. 계속할까요?`
    )) return;
    setBusy(true); setErr('');
    const res = await mergeCustomers(primary.id, picked.id);
    setBusy(false);
    if ((res as any).error) { setErr((res as any).error); return; }
    onMerged();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl p-4 sm:p-6">
        <div className="flex justify-between items-center mb-1">
          <h2 className="text-lg font-bold">고객 병합</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          <b className="text-slate-700">{primary.name}</b> ({formatPhone(primary.phone)}) 로 합칠 <b>같은 사람의 다른 레코드</b>를 찾아 선택하세요.
        </p>

        <div className="flex gap-2 mb-3">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
            placeholder="이름 또는 전화번호로 검색"
            className="input flex-1"
            autoFocus
          />
          <button onClick={runSearch} className="btn-secondary" disabled={searching}>
            {searching ? '검색…' : '검색'}
          </button>
        </div>

        <div className="space-y-1 max-h-64 overflow-y-auto mb-4">
          {results.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-6">검색 결과가 여기에 표시됩니다.</p>
          ) : results.map(r => (
            <label key={r.id}
              className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer ${picked?.id === r.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
              <input type="radio" name="mergeTarget" checked={picked?.id === r.id} onChange={() => setPicked(r)} />
              <div className="text-sm">
                <div className="font-medium">{r.name}</div>
                <div className="text-slate-400 text-xs">
                  {formatPhone(r.phone)}{r.phone2 && ` · ${formatPhone(r.phone2)}`}
                </div>
              </div>
            </label>
          ))}
        </div>

        {err && <p className="text-red-500 text-sm mb-2">{err}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">취소</button>
          <button onClick={doMerge} disabled={!picked || busy}
            className="btn-primary flex-1 disabled:opacity-50">
            {busy ? '병합 중…' : '현재 고객으로 병합'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ currentUserId, users, onClose, onSubmit }: { currentUserId?: string; users: User[]; onClose: () => void; onSubmit: (userId: string | null) => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl p-4 sm:p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">담당자 지정</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <div className="space-y-3">
          <button onClick={() => onSubmit(null)} className={`w-full text-left p-3 rounded-lg border ${!currentUserId ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
            <span className="font-medium">담당자 없음</span>
          </button>
          {users.map(user => (
            <button key={user.id} onClick={() => onSubmit(user.id)} className={`w-full text-left p-3 rounded-lg border ${currentUserId === user.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
              <span className="font-medium">{user.name}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="w-full mt-4 btn-secondary">취소</button>
      </div>
    </div>
  );
}
