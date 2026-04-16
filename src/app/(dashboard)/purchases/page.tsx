'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { confirmPurchaseOrder, cancelPurchaseOrder } from '@/lib/purchase-actions';
import PurchaseOrderModal from './PurchaseOrderModal';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안',
  CONFIRMED: '확정',
  PARTIALLY_RECEIVED: '부분입고',
  RECEIVED: '입고완료',
  CANCELLED: '취소',
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
};

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

export default function PurchasesPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  const fetchData = async () => {
    setLoading(true);
    const sb = createClient() as any;

    let q = sb
      .from('purchase_orders')
      .select(`
        id, po_number, status, total_amount, expected_date, ordered_at, memo,
        supplier:suppliers(name),
        branch:branches(name),
        items:purchase_order_items(id, ordered_quantity, received_quantity)
      `)
      .order('ordered_at', { ascending: false })
      .limit(100);

    if (isBranchUser && userBranchId) q = q.eq('branch_id', userBranchId);
    if (statusFilter) q = q.eq('status', statusFilter);
    if (supplierFilter) q = q.eq('supplier_id', supplierFilter);
    if (startDate) q = q.gte('ordered_at', `${startDate}T00:00:00`);
    if (endDate) q = q.lte('ordered_at', `${endDate}T23:59:59`);

    const [{ data: ordersData }, { data: suppliersData }] = await Promise.all([
      q,
      sb.from('suppliers').select('id, name').eq('is_active', true).order('name'),
    ]);

    setOrders(ordersData || []);
    setSuppliers(suppliersData || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [statusFilter, supplierFilter, startDate, endDate]);

  const handleConfirm = async (id: string, poNumber: string) => {
    if (!confirm(`발주서 ${poNumber}를 확정하시겠습니까?`)) return;
    const result = await confirmPurchaseOrder(id);
    if (result.error) alert(result.error);
    else fetchData();
  };

  const handleCancel = async (id: string, poNumber: string) => {
    if (!confirm(`발주서 ${poNumber}를 취소하시겠습니까?`)) return;
    const result = await cancelPurchaseOrder(id);
    if (result.error) alert(result.error);
    else fetchData();
  };

  // 통계
  const stats = {
    total: orders.length,
    pending: orders.filter(o => ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED'].includes(o.status)).length,
    totalAmount: orders.filter(o => o.status !== 'CANCELLED').reduce((s: number, o: any) => s + (o.total_amount || 0), 0),
  };

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="flex flex-wrap gap-2">
          <Link href="/purchases/suppliers" className="btn-secondary py-2 px-4 text-sm">공급업체 관리</Link>
          <Link href="/purchases/prices" className="btn-secondary py-2 px-4 text-sm">매입 단가 관리</Link>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">+ 발주서 작성</button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="card text-center">
          <p className="text-sm text-slate-500">전체 발주</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{stats.total}건</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-slate-500">진행 중</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{stats.pending}건</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-slate-500">발주 금액 합계</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{stats.totalAmount.toLocaleString()}원</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap mb-4">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-36">
            <option value="">전체 상태</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="input w-48">
            <option value="">전체 공급업체</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input w-36" />
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input w-36" />
        </div>

        <div className="overflow-x-auto">
          <table className="table min-w-[700px]">
            <thead>
              <tr>
                <th>발주번호</th>
                <th>공급업체</th>
                <th>입고 지점</th>
                <th>발주금액</th>
                <th>납기예정일</th>
                <th>진행현황</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">로딩 중...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">발주서가 없습니다.</td></tr>
              ) : orders.map(order => {
                const totalItems = (order.items || []).reduce((s: number, i: any) => s + i.ordered_quantity, 0);
                const receivedItems = (order.items || []).reduce((s: number, i: any) => s + i.received_quantity, 0);
                const progress = totalItems > 0 ? Math.round(receivedItems / totalItems * 100) : 0;

                return (
                  <tr key={order.id}>
                    <td>
                      <Link href={`/purchases/${order.id}`} className="font-mono text-sm text-blue-600 hover:underline">
                        {order.po_number}
                      </Link>
                    </td>
                    <td className="font-medium">{order.supplier?.name || '-'}</td>
                    <td className="text-slate-500">{order.branch?.name || '-'}</td>
                    <td className="font-medium">{(order.total_amount || 0).toLocaleString()}원</td>
                    <td className="text-sm text-slate-500">{order.expected_date || '-'}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-1.5 min-w-16">
                          <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{receivedItems}/{totalItems}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[order.status] || ''}`}>
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <Link href={`/purchases/${order.id}`} className="text-xs text-blue-600 hover:underline">상세</Link>
                        {order.status === 'DRAFT' && (
                          <button onClick={() => handleConfirm(order.id, order.po_number)} className="text-xs text-green-600 hover:underline">확정</button>
                        )}
                        {['DRAFT', 'CONFIRMED'].includes(order.status) && (
                          <button onClick={() => handleCancel(order.id, order.po_number)} className="text-xs text-red-500 hover:underline">취소</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <PurchaseOrderModal
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); fetchData(); }}
        />
      )}
    </div>
  );
}
