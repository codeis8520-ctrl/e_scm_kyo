'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatPhone } from '@/lib/validators';
import { settleCreditOrder } from '@/lib/accounting-actions';

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
  consulted_by?: { name: string };
  created_at: string;
}

interface Tag { id: string; name: string; color: string; }
interface Branch { id: string; name: string; }
interface User { id: string; name: string; }

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

function fmtDate(date: Date): string { return date.toISOString().slice(0, 10); }

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

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'purchases' | 'consultations'>('info');
  const [showConsultModal, setShowConsultModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const [activePeriod, setActivePeriod] = useState(1); // months (default 1개월)
  const [purchaseDateRange, setPurchaseDateRange] = useState(() => getDateRange(1));
  const [consultDateRange, setConsultDateRange] = useState(() => getDateRange(1));
  const [settlingOrderId, setSettlingOrderId] = useState<string | null>(null);
  const [purchaseProductSearch, setPurchaseProductSearch] = useState('');
  const [purchaseBranchFilter, setPurchaseBranchFilter] = useState('');

  useEffect(() => { fetchData(); }, [customerId]);

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();

    const [customerRes, purchasesRes, consultationsRes, tagsRes, branchesRes, usersRes, pointRes] = await Promise.all([
      supabase
        .from('customers')
        .select(`*, primary_branch:branches(*), tags:customer_tag_map(tag:customer_tags(*)), assigned_to:users!customers_assigned_to_fkey(*)`)
        .eq('id', customerId)
        .single(),
      supabase
        .from('sales_orders')
        .select(`id, order_number, ordered_at, status, total_amount, payment_method, credit_settled, credit_settled_method, points_earned, points_used, branch_id, branch:branches(name, id), items:sales_order_items(id, quantity, unit_price, total_price, product:products(name))`)
        .eq('customer_id', customerId)
        .gte('ordered_at', `${purchaseDateRange.start}T00:00:00`)
        .lte('ordered_at', `${purchaseDateRange.end}T23:59:59`)
        .order('ordered_at', { ascending: false }),
      supabase
        .from('customer_consultations')
        .select('*, consulted_by:users(name)')
        .eq('customer_id', customerId)
        .gte('created_at', `${consultDateRange.start}T00:00:00`)
        .lte('created_at', `${consultDateRange.end}T23:59:59`)
        .order('created_at', { ascending: false }),
      supabase.from('customer_tags').select('*').order('name'),
      supabase.from('branches').select('id, name').eq('is_active', true),
      supabase.from('users').select('id, name').eq('is_active', true),
      supabase.from('point_history').select('balance').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
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
        const match = (order.items || []).some((i: any) => i.product?.name?.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
    setPurchaseOrders(filteredOrders);
    setConsultations((consultationsRes.data || []) as Consultation[]);
    setAllTags((tagsRes.data || []) as Tag[]);
    setBranches((branchesRes.data || []) as Branch[]);
    setUsers((usersRes.data || []) as User[]);
    setLoading(false);
  };

  // 기간 퀵 프리셋
  const handlePeriodPreset = (months: number) => {
    setActivePeriod(months);
    const range = getDateRange(months);
    setPurchaseDateRange(range);
    // fetchData will be triggered after state update
    setTimeout(() => fetchData(), 0);
  };

  // 전체 펼치기/접기
  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedOrders(new Set());
      setAllExpanded(false);
    } else {
      setExpandedOrders(new Set(purchaseOrders.map((o: any) => o.id)));
      setAllExpanded(true);
    }
  };

  // 제품 구매 빈도
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

  // 월별 그룹핑
  const ordersWithMonthDividers = useMemo(() => {
    const result: { type: 'divider' | 'order'; month?: string; order?: any }[] = [];
    let lastMonth = '';
    for (const order of purchaseOrders) {
      const d = new Date(order.ordered_at);
      const month = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
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
    const totalAmount = validOrders.reduce((s: number, o: any) => s + (o.total_amount || 0), 0);
    const orderCount = validOrders.length;
    const lastDate = purchaseOrders.length > 0 ? purchaseOrders[0].ordered_at?.slice(0, 10) : null;

    // 평균 주문 간격
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

  const handleAddConsultation = async (type: string, content: string) => {
    const supabase = createClient() as any;
    const userId = getCookie('user_id');
    await supabase.from('customer_consultations').insert({
      customer_id: customerId, consultation_type: type, content: { text: content }, consulted_by: userId || null,
    });
    fetchData();
    setShowConsultModal(false);
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

  const handleDateFilterChange = (type: 'purchase' | 'consult', field: 'start' | 'end', value: string) => {
    if (type === 'purchase') {
      setActivePeriod(-1); // 수동 선택 → 프리셋 해제
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-4">
          <Link href="/customers" className="text-slate-400 hover:text-slate-600">← 목록</Link>
          <div>
            <h1 className="text-2xl font-bold">{customer.name}</h1>
            <p className="text-slate-500">{formatPhone(customer.phone)}</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${GRADE_COLORS[customer.grade] || ''}`}>
          {GRADE_LABELS[customer.grade] || customer.grade}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 사이드바 */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card">
            <h3 className="font-semibold mb-4">기본 정보</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">이메일</dt><dd>{customer.email || '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">주소</dt><dd className="text-right max-w-[180px] truncate" title={customer.address || ''}>{customer.address || '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">담당 지점</dt><dd>{customer.primary_branch?.name || '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">적립 포인트</dt><dd className="font-medium text-blue-600">{customer.total_points?.toLocaleString() || 0}P</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">고객 등급</dt><dd>{GRADE_LABELS[customer.grade] || customer.grade}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">자사몰 ID</dt><dd className="font-mono text-xs">{customer.cafe24_member_id || '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">등록일</dt><dd>{new Date(customer.created_at).toLocaleDateString('ko-KR')}</dd></div>
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
              { key: 'info' as const, label: '기본 정보' },
              { key: 'purchases' as const, label: `구매 이력 (${purchaseOrders.length})` },
              { key: 'consultations' as const, label: `상담 기록 (${consultations.length})` },
            ]).map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-4 py-2 font-medium border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* 구매 이력 */}
          {activeTab === 'purchases' && (
            <div className="space-y-4">
              {/* 기간 퀵버튼 + 필터 */}
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

              {/* 제품 구매 빈도 */}
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

              {/* 전체 펼치기 + 주문 목록 */}
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
                  {ordersWithMonthDividers.map((item, idx) => {
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
                                    <td>{it.product?.name || '-'}</td>
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
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 상담 기록 */}
          {activeTab === 'consultations' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 items-center">
                <input type="date" value={consultDateRange.start} onChange={(e) => handleDateFilterChange('consult', 'start', e.target.value)} className="input w-36" />
                <span className="text-slate-400">~</span>
                <input type="date" value={consultDateRange.end} onChange={(e) => handleDateFilterChange('consult', 'end', e.target.value)} className="input w-36" />
                <button onClick={() => fetchData()} className="btn-secondary">조회</button>
                <button onClick={() => { setConsultDateRange(getDateRange(1)); setTimeout(() => fetchData(), 0); }} className="text-sm text-slate-500 hover:text-slate-700">초기화</button>
              </div>
              <button onClick={() => setShowConsultModal(true)} className="btn-primary">+ 상담 기록 추가</button>
              {consultations.length > 0 ? (
                <div className="space-y-3">
                  {consultations.map(consult => (
                    <div key={consult.id} className="card">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-medium">{consult.consultation_type}</span>
                          <span className="text-slate-400 mx-2">·</span>
                          <span className="text-sm text-slate-500">{consult.consulted_by?.name || '시스템'}</span>
                        </div>
                        <span className="text-xs text-slate-400">{new Date(consult.created_at).toLocaleDateString('ko-KR')}</span>
                      </div>
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">{consult.content?.text || JSON.stringify(consult.content)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card text-center text-slate-400 py-8">상담 기록이 없습니다</div>
              )}
            </div>
          )}

          {activeTab === 'info' && (
            <div className="card">
              <h3 className="font-semibold mb-4">추가 정보</h3>
              <p className="text-slate-500 text-sm">기본 정보 수정은 고객 목록의 "수정" 버튼을 이용하세요.</p>
            </div>
          )}
        </div>
      </div>

      {showConsultModal && <ConsultModal onClose={() => setShowConsultModal(false)} onSubmit={handleAddConsultation} />}
      {showAssignModal && <AssignModal currentUserId={customer.assigned_to?.id} users={users} onClose={() => setShowAssignModal(false)} onSubmit={handleUpdateAssignedTo} />}
    </div>
  );
}

function ConsultModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (type: string, content: string) => void }) {
  const [type, setType] = useState('전화 상담');
  const [content, setContent] = useState('');
  const types = ['전화 상담', '방문 상담', '구매 상담', '민원 처리', '기타'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl p-4 sm:p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">상담 기록 추가</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">상담 유형</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="input">
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">내용</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} className="input" placeholder="상담 내용을 입력하세요..." />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (content.trim()) onSubmit(type, content); }} className="flex-1 btn-primary">저장</button>
            <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
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
