'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface ChannelSales {
  channel: string;
  total: number;
  count: number;
}

interface BranchInventory {
  branch_id: string;
  branch_name: string;
  total_products: number;
  low_stock_items: number;
}

interface RecentOrder {
  id: string;
  order_number: string;
  channel: string;
  branch_name: string;
  total_amount: number;
  status: string;
  created_at: string;
  cafe24_order_id: string | null;
  items: { product_name: string; quantity: number }[];
}

interface LowInventoryItem {
  id: string;
  quantity: number;
  safety_stock: number;
  product_name: string;
  branch_name: string;
}

interface DashboardData {
  periodTotal: number;
  periodCount: number;
  periodStart: string;
  periodEnd: string;
  channelSales: ChannelSales[];
  branchInventory: BranchInventory[];
  recentOrders: RecentOrder[];
  lowInventory: LowInventoryItem[];
  onlineOrders: number;
  onlineAmount: number;
  monthPurchaseTotal: number;
  monthReturnTotal: number;
  pendingPOCount: number;
}

interface DetailOrder {
  id: string;
  order_number: string;
  channel: string;
  branch_name: string;
  customer_name: string;
  total_amount: number;
  status: string;
  ordered_at: string;
  cafe24_order_id?: string | null;
  payment_method?: string;
  items: { product_name: string; quantity: number; unit_price: number; subtotal?: number }[];
}

interface DetailInventoryItem {
  id: string;
  product_name: string;
  sku: string;
  branch_name: string;
  branch_id: string;
  quantity: number;
  safety_stock: number;
  is_low: boolean;
}

type ModalType = 'channel_sales' | 'branch_inventory' | 'recent_orders' | null;

const CHANNEL_LABELS: Record<string, string> = {
  STORE: '한약국',
  DEPT_STORE: '백화점',
  ONLINE: '자사몰',
  EVENT: '이벤트',
  B2B: 'B2B',
};

const CHANNEL_COLORS: Record<string, string> = {
  STORE: 'bg-emerald-500',
  DEPT_STORE: 'bg-purple-500',
  ONLINE: 'bg-blue-500',
  EVENT: 'bg-amber-500',
  B2B: 'bg-orange-500',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  COMPLETED: '완료',
  CANCELLED: '취소',
  REFUNDED: '환불',
  PARTIALLY_REFUNDED: '부분환불',
  PENDING: '대기',
  DELIVERED: '납품완료',
  PARTIALLY_SETTLED: '부분정산',
  SETTLED: '정산완료',
};

const PERIOD_LABELS: Record<string, string> = {
  daily: '일별',
  weekly: '주별',
  monthly: '월별',
};

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'hq' | 'branch'>('hq');
  const [period, setPeriod] = useState<string>('monthly');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Detail modal state
  const [modalType, setModalType] = useState<ModalType>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalChannel, setModalChannel] = useState<string | null>(null);
  const [modalBranchId, setModalBranchId] = useState<string | null>(null);
  const [detailOrders, setDetailOrders] = useState<DetailOrder[]>([]);
  const [detailInventory, setDetailInventory] = useState<DetailInventoryItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const initialBranch = (() => {
    const role = getCookie('user_role');
    const branchId = getCookie('user_branch_id');
    if (role === 'BRANCH_STAFF' || role === 'PHARMACY_STAFF') {
      return branchId || 'ALL';
    }
    return 'ALL';
  })();

  const [selectedBranch] = useState<string>(initialBranch);
  const [userRole] = useState<string | null>(getCookie('user_role'));

  useEffect(() => {
    const role = getCookie('user_role');
    if (role === 'BRANCH_STAFF' || role === 'PHARMACY_STAFF') {
      setViewMode('branch');
    } else {
      setViewMode('hq');
    }
  }, []);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedChannel !== 'ALL') params.set('channel', selectedChannel);
      if (selectedBranch !== 'ALL') params.set('branch_id', selectedBranch);
      params.set('period', period);
      params.set('date', selectedDate);

      const response = await fetch(`/api/dashboard?${params.toString()}`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedChannel, selectedBranch, period, selectedDate]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const openDetail = async (type: ModalType, title: string, channel?: string, branchId?: string) => {
    setModalType(type);
    setModalTitle(title);
    setModalChannel(channel || null);
    setModalBranchId(branchId || null);
    setDetailLoading(true);
    setDetailOrders([]);
    setDetailInventory([]);

    try {
      const params = new URLSearchParams();
      params.set('type', type!);
      if (channel) params.set('channel', channel);
      if (branchId) params.set('branch_id', branchId);
      if (data?.periodStart) params.set('start', data.periodStart);
      if (data?.periodEnd) params.set('end', data.periodEnd);

      const res = await fetch(`/api/dashboard/details?${params.toString()}`);
      const result = await res.json();

      if (type === 'branch_inventory') {
        setDetailInventory(result.items || []);
      } else {
        setDetailOrders(result.orders || []);
      }
    } catch (err) {
      console.error('Failed to fetch details:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setModalType(null);
    setDetailOrders([]);
    setDetailInventory([]);
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">로딩 중...</div>
      </div>
    );
  }

  const channelSummary = data.channelSales.reduce(
    (acc, ch) => ({ total: acc.total + ch.total, count: acc.count + ch.count }),
    { total: 0, count: 0 }
  );

  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  const periodLabel = period === 'daily' ? '당일' : period === 'weekly' ? '금주' : '이번 달';

  return (
    <div className="space-y-6">
      {/* 상단 필터 영역 */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setViewMode('hq')}
            disabled={isBranchUser}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'hq'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            } ${isBranchUser ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            본사 뷰
          </button>
          <button
            onClick={() => setViewMode('branch')}
            disabled={isBranchUser}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'branch'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            } ${isBranchUser ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            지점 뷰
          </button>
        </div>

        {/* 기간 필터 */}
        <div className="flex gap-2 items-center flex-wrap">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-xs text-slate-400">
            {data.periodStart} ~ {data.periodEnd}
          </span>
        </div>

        {!isBranchUser && (
          <div className="flex gap-2 flex-wrap">
            {['ALL', 'STORE', 'DEPT_STORE', 'ONLINE', 'EVENT'].map((ch) => (
              <button
                key={ch}
                onClick={() => setSelectedChannel(ch)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedChannel === ch
                    ? (CHANNEL_COLORS[ch] || 'bg-slate-600') + ' text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {ch === 'ALL' ? '전체 채널' : CHANNEL_LABELS[ch] || ch}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="stat-card cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-all"
             onClick={() => openDetail('channel_sales', `${periodLabel} 매출 내역`)}>
          <p className="text-sm text-slate-500">{periodLabel} 매출</p>
          <p className="text-2xl font-bold text-slate-800">
            {data.periodTotal.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">{data.periodCount}건</p>
        </div>

        <div className="stat-card cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all"
             onClick={() => openDetail('channel_sales', `${periodLabel} 자사몰 매출`, 'ONLINE')}>
          <p className="text-sm text-slate-500">{periodLabel} 자사몰</p>
          <p className="text-2xl font-bold text-blue-600">
            {data.onlineAmount.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">{data.onlineOrders}건</p>
        </div>

        <div className="stat-card cursor-pointer hover:ring-2 hover:ring-orange-300 transition-all"
             onClick={() => openDetail('branch_inventory', '안전재고 미달 품목')}>
          <p className="text-sm text-slate-500">안전재고 미달</p>
          <p className="text-2xl font-bold text-orange-600">
            {data.lowInventory.length}
          </p>
          <p className="text-xs text-slate-400">품목 (safety stock 기준)</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">{periodLabel} 매입</p>
          <p className="text-2xl font-bold text-amber-700">
            {data.monthPurchaseTotal.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">진행중 {data.pendingPOCount}건</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">{periodLabel} 환불</p>
          <p className="text-2xl font-bold text-red-600">
            {data.monthReturnTotal.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">
            순매출 {(data.periodTotal - data.monthReturnTotal).toLocaleString()}원
          </p>
        </div>
      </div>

      {/* 채널별 매출 / 지점별 재고 / 최근 주문 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 채널별 매출 */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-slate-800">채널별 매출</h3>
            <button
              onClick={() => openDetail('channel_sales', '전체 채널 매출 상세')}
              className="text-xs text-blue-600 hover:underline"
            >
              전체보기 →
            </button>
          </div>
          <div className="space-y-3">
            {data.channelSales.map((ch) => (
              <div
                key={ch.channel}
                className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() =>
                  openDetail(
                    'channel_sales',
                    `${CHANNEL_LABELS[ch.channel] || ch.channel} 매출 상세`,
                    ch.channel
                  )
                }
              >
                <div className={`w-3 h-3 rounded-full ${CHANNEL_COLORS[ch.channel]}`} />
                <span className="flex-1 text-sm text-slate-600">
                  {CHANNEL_LABELS[ch.channel] || ch.channel}
                </span>
                <span className="text-sm font-medium text-slate-800">
                  {ch.total.toLocaleString()}원
                </span>
                <span className="text-xs text-slate-400 w-12 text-right">
                  {ch.count}건
                </span>
              </div>
            ))}
            {data.channelSales.length > 0 && (
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <div className="w-3 h-3" />
                <span className="flex-1 text-sm font-semibold text-slate-700">합계</span>
                <span className="text-sm font-bold text-slate-800">
                  {channelSummary.total.toLocaleString()}원
                </span>
                <span className="text-xs text-slate-500 w-12 text-right">
                  {channelSummary.count}건
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 지점별 재고 상태 */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-slate-800">지점별 재고 상태</h3>
          </div>
          <div className="space-y-3">
            {data.branchInventory.map((branch) => (
              <div
                key={branch.branch_id}
                className="flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() =>
                  openDetail(
                    'branch_inventory',
                    `${branch.branch_name} 재고 상세`,
                    undefined,
                    branch.branch_id
                  )
                }
              >
                <div>
                  <p className="font-medium text-slate-800">{branch.branch_name}</p>
                  <p className="text-xs text-slate-500">
                    총 {branch.total_products}개 품목
                  </p>
                </div>
                {branch.low_stock_items > 0 ? (
                  <span className="px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded">
                    부족 {branch.low_stock_items}개
                  </span>
                ) : (
                  <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
                    정상
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 최근 주문 */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-slate-800">최근 주문</h3>
            <button
              onClick={() => openDetail('recent_orders', '주문 내역 상세')}
              className="text-xs text-blue-600 hover:underline"
            >
              전체보기 →
            </button>
          </div>
          <div className="space-y-2">
            {data.recentOrders.slice(0, 6).map((order) => {
              const productNames = order.items.map((i) => i.product_name).join(', ');
              const shortNames =
                productNames.length > 20
                  ? productNames.substring(0, 20) + '...'
                  : productNames;
              return (
                <div
                  key={order.id}
                  className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 rounded px-1 transition-colors"
                  onClick={() => openDetail('recent_orders', '주문 내역 상세')}
                >
                  <div className="flex items-center gap-2">
                    {order.cafe24_order_id && (
                      <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                        온라인
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {shortNames || '제품명 없음'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {order.branch_name} · {CHANNEL_LABELS[order.channel] || order.channel}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {order.total_amount.toLocaleString()}원
                    </p>
                    <p
                      className={`text-xs ${
                        order.status === 'COMPLETED'
                          ? 'text-green-600'
                          : order.status === 'CANCELLED'
                            ? 'text-red-600'
                            : order.status === 'REFUNDED'
                              ? 'text-red-500'
                              : 'text-slate-500'
                      }`}
                    >
                      {ORDER_STATUS_LABELS[order.status] || order.status}
                    </p>
                  </div>
                </div>
              );
            })}
            {data.recentOrders.length === 0 && (
              <p className="text-center text-slate-400 py-4">주문 내역이 없습니다</p>
            )}
          </div>
        </div>
      </div>

      {/* 재고 부족 품목 */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-slate-800">재고 부족 품목</h3>
          <Link href="/inventory" className="text-sm text-blue-600 hover:underline">
            재고 관리 →
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.lowInventory.slice(0, 9).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 bg-orange-50 rounded-lg cursor-pointer hover:bg-orange-100 transition-colors"
              onClick={() =>
                openDetail('branch_inventory', `${item.branch_name} 재고 상세`)
              }
            >
              <div>
                <p className="font-medium text-slate-800">{item.product_name}</p>
                <p className="text-xs text-slate-500">{item.branch_name}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-orange-600">{item.quantity}개</p>
                <p className="text-xs text-slate-400">기준: {item.safety_stock}개</p>
              </div>
            </div>
          ))}
          {data.lowInventory.length === 0 && (
            <p className="col-span-full text-center text-slate-400 py-4">
              재고 부족 품목이 없습니다
            </p>
          )}
        </div>
      </div>

      {/* 디테일 모달 */}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-800">{modalTitle}</h2>
                <p className="text-sm text-slate-500">
                  {data.periodStart} ~ {data.periodEnd}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 모달 내용 */}
            <div className="flex-1 overflow-auto p-6">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-slate-500">로딩 중...</div>
                </div>
              ) : modalType === 'branch_inventory' ? (
                <InventoryDetail items={detailInventory} />
              ) : (
                <OrdersDetail orders={detailOrders} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrdersDetail({ orders }: { orders: DetailOrder[] }) {
  if (orders.length === 0) {
    return <p className="text-center text-slate-400 py-8">데이터가 없습니다</p>;
  }

  const totalAmount = orders.reduce((s, o) => s + o.total_amount, 0);

  return (
    <div>
      <div className="mb-4 flex items-center gap-4 text-sm text-slate-600">
        <span>총 <strong>{orders.length}</strong>건</span>
        <span>합계 <strong className="text-slate-800">{totalAmount.toLocaleString()}원</strong></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="pb-3 pr-4 font-medium text-slate-500">주문번호</th>
              <th className="pb-3 pr-4 font-medium text-slate-500">채널</th>
              <th className="pb-3 pr-4 font-medium text-slate-500">지점</th>
              <th className="pb-3 pr-4 font-medium text-slate-500">고객</th>
              <th className="pb-3 pr-4 font-medium text-slate-500">제품</th>
              <th className="pb-3 pr-4 font-medium text-slate-500 text-right">금액</th>
              <th className="pb-3 pr-4 font-medium text-slate-500">상태</th>
              <th className="pb-3 font-medium text-slate-500">일시</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const itemNames = order.items.map((i) => `${i.product_name} x${i.quantity}`).join(', ');
              const shortItems = itemNames.length > 30 ? itemNames.substring(0, 30) + '...' : itemNames;
              return (
                <tr key={order.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 pr-4">
                    <span className="font-mono text-xs">{order.order_number}</span>
                    {order.cafe24_order_id && (
                      <span className="ml-1 px-1 py-0.5 text-xs bg-blue-50 text-blue-600 rounded">온라인</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`inline-block w-2 h-2 rounded-full mr-1 ${CHANNEL_COLORS[order.channel] || 'bg-slate-400'}`} />
                    {CHANNEL_LABELS[order.channel] || order.channel}
                  </td>
                  <td className="py-3 pr-4">{order.branch_name}</td>
                  <td className="py-3 pr-4">{order.customer_name}</td>
                  <td className="py-3 pr-4 text-slate-600" title={itemNames}>{shortItems}</td>
                  <td className="py-3 pr-4 text-right font-medium">{order.total_amount.toLocaleString()}원</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      order.status === 'COMPLETED' || order.status === 'DELIVERED' || order.status === 'SETTLED'
                        ? 'bg-green-100 text-green-700'
                        : order.status === 'REFUNDED' || order.status === 'CANCELLED'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}>
                      {ORDER_STATUS_LABELS[order.status] || order.status}
                    </span>
                  </td>
                  <td className="py-3 text-xs text-slate-500">{formatDate(order.ordered_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryDetail({ items }: { items: DetailInventoryItem[] }) {
  if (items.length === 0) {
    return <p className="text-center text-slate-400 py-8">데이터가 없습니다</p>;
  }

  const lowCount = items.filter((i) => i.is_low).length;

  return (
    <div>
      <div className="mb-4 flex items-center gap-4 text-sm text-slate-600">
        <span>총 <strong>{items.length}</strong>개 품목</span>
        {lowCount > 0 && (
          <span className="text-orange-600">안전재고 미달 <strong>{lowCount}</strong>개</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="pb-3 pr-4 font-medium text-slate-500">제품명</th>
              <th className="pb-3 pr-4 font-medium text-slate-500">SKU</th>
              <th className="pb-3 pr-4 font-medium text-slate-500">지점</th>
              <th className="pb-3 pr-4 font-medium text-slate-500 text-right">현재 재고</th>
              <th className="pb-3 pr-4 font-medium text-slate-500 text-right">안전재고</th>
              <th className="pb-3 font-medium text-slate-500">상태</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={`border-b border-slate-50 ${item.is_low ? 'bg-orange-50/50' : 'hover:bg-slate-50'}`}>
                <td className="py-3 pr-4 font-medium">{item.product_name}</td>
                <td className="py-3 pr-4 text-xs font-mono text-slate-500">{item.sku}</td>
                <td className="py-3 pr-4">{item.branch_name}</td>
                <td className={`py-3 pr-4 text-right font-medium ${item.is_low ? 'text-orange-600' : 'text-slate-800'}`}>
                  {item.quantity}개
                </td>
                <td className="py-3 pr-4 text-right text-slate-500">{item.safety_stock}개</td>
                <td className="py-3">
                  {item.is_low ? (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700">부족</span>
                  ) : (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">정상</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
