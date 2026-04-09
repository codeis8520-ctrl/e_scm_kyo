'use client';

import { useState, useEffect } from 'react';
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
  todayTotal: number;
  todayCount: number;
  monthTotal: number;
  monthCount: number;
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

const CHANNEL_LABELS: Record<string, string> = {
  STORE: '한약국',
  DEPT_STORE: '백화점',
  ONLINE: '자사몰',
  EVENT: '이벤트',
};

const CHANNEL_COLORS: Record<string, string> = {
  STORE: 'bg-emerald-500',
  DEPT_STORE: 'bg-purple-500',
  ONLINE: 'bg-blue-500',
  EVENT: 'bg-amber-500',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  COMPLETED: '완료',
  CANCELLED: '취소',
  REFUNDED: '환불',
  PARTIALLY_REFUNDED: '부분환불',
  PENDING: '대기',
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

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'hq' | 'branch'>('hq');
  
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

  useEffect(() => {
    fetchDashboardData();
  }, [selectedChannel, selectedBranch]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedChannel !== 'ALL') params.set('channel', selectedChannel);
      if (selectedBranch !== 'ALL') params.set('branch_id', selectedBranch);

      const response = await fetch(`/api/dashboard?${params.toString()}`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">로딩 중...</div>
      </div>
    );
  }

  const channelSummary = data.channelSales.reduce(
    (acc, ch) => ({
      total: acc.total + ch.total,
      count: acc.count + ch.count,
    }),
    { total: 0, count: 0 }
  );

  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2">
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

        {!isBranchUser && (
          <div className="flex gap-2 flex-wrap">
            {['ALL', 'STORE', 'DEPT_STORE', 'ONLINE', 'EVENT'].map((ch) => (
              <button
                key={ch}
                onClick={() => setSelectedChannel(ch)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedChannel === ch
                    ? CHANNEL_COLORS[ch] || 'bg-slate-600' + ' text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {ch === 'ALL' ? '전체 채널' : CHANNEL_LABELS[ch] || ch}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="stat-card">
          <p className="text-sm text-slate-500">오늘 매출</p>
          <p className="text-2xl font-bold text-slate-800">
            {data.todayTotal.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">{data.todayCount}건</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">이번 달 매출</p>
          <p className="text-2xl font-bold text-slate-800">
            {data.monthTotal.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">{data.monthCount}건</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">이번 달 자사몰</p>
          <p className="text-2xl font-bold text-blue-600">
            {data.onlineAmount.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">{data.onlineOrders}건</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">안전재고 미달</p>
          <p className="text-2xl font-bold text-orange-600">
            {data.lowInventory.length}
          </p>
          <p className="text-xs text-slate-400">품목 (safety stock 기준)</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">이번달 매입</p>
          <p className="text-2xl font-bold text-amber-700">
            {data.monthPurchaseTotal.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">진행중 {data.pendingPOCount}건</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">이번달 환불</p>
          <p className="text-2xl font-bold text-red-600">
            {data.monthReturnTotal.toLocaleString()}원
          </p>
          <p className="text-xs text-slate-400">순매출 {(data.monthTotal - data.monthReturnTotal).toLocaleString()}원</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card">
          <h3 className="font-semibold text-slate-800 mb-4">채널별 매출</h3>
          <div className="space-y-3">
            {data.channelSales.map((ch) => (
              <div key={ch.channel} className="flex items-center gap-3">
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
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-slate-800 mb-4">지점별 재고 상태</h3>
          <div className="space-y-3">
            {data.branchInventory.map((branch) => (
              <div
                key={branch.branch_id}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-800">{branch.branch_name}</p>
                  <p className="text-xs text-slate-500">
                    총 {branch.total_products}개 품목
                  </p>
                </div>
                {branch.low_stock_items > 0 && (
                  <span className="px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded">
                    부족 {branch.low_stock_items}개
                  </span>
                )}
                {branch.low_stock_items === 0 && (
                  <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
                    정상
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-slate-800 mb-4">최근 주문</h3>
          <div className="space-y-2">
            {data.recentOrders.slice(0, 6).map((order) => {
              const productNames = order.items.map(i => i.product_name).join(', ');
              const shortNames = productNames.length > 20 ? productNames.substring(0, 20) + '...' : productNames;
              return (
                <div
                  key={order.id}
                  className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"
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
                    <p className={`text-xs ${
                      order.status === 'COMPLETED' ? 'text-green-600' :
                      order.status === 'CANCELLED' ? 'text-red-600' :
                      order.status === 'REFUNDED' ? 'text-red-500' :
                      'text-slate-500'
                    }`}>
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
              className="flex items-center justify-between p-3 bg-orange-50 rounded-lg"
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
    </div>
  );
}
