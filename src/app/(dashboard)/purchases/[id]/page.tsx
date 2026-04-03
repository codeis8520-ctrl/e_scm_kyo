'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { confirmPurchaseOrder, cancelPurchaseOrder } from '@/lib/purchase-actions';
import ReceiveModal from '../ReceiveModal';

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

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<any>(null);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReceive, setShowReceive] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const sb = createClient() as any;

    const [{ data: orderData }, { data: receiptsData }] = await Promise.all([
      sb.from('purchase_orders').select(`
        *,
        supplier:suppliers(id, name, code, phone, email),
        branch:branches(id, name),
        items:purchase_order_items(
          id, ordered_quantity, received_quantity, unit_price,
          product:products(id, name, code, unit)
        )
      `).eq('id', id).single(),
      sb.from('purchase_receipts').select(`
        *,
        items:purchase_receipt_items(
          id, quantity, unit_price,
          product:products(name, code, unit)
        )
      `).eq('purchase_order_id', id).order('received_at', { ascending: false }),
    ]);

    setOrder(orderData);
    setReceipts(receiptsData || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const handleConfirm = async () => {
    if (!confirm(`발주서 ${order.po_number}를 확정하시겠습니까?`)) return;
    setActionLoading(true);
    const result = await confirmPurchaseOrder(id);
    if (result.error) alert(result.error);
    else fetchData();
    setActionLoading(false);
  };

  const handleCancel = async () => {
    if (!confirm(`발주서 ${order.po_number}를 취소하시겠습니까?`)) return;
    setActionLoading(true);
    const result = await cancelPurchaseOrder(id);
    if (result.error) alert(result.error);
    else fetchData();
    setActionLoading(false);
  };

  if (loading) return <div className="text-center py-20 text-slate-400">로딩 중...</div>;
  if (!order) return <div className="text-center py-20 text-slate-400">발주서를 찾을 수 없습니다.</div>;

  const totalOrdered = (order.items || []).reduce((s: number, i: any) => s + i.ordered_quantity, 0);
  const totalReceived = (order.items || []).reduce((s: number, i: any) => s + i.received_quantity, 0);
  const progress = totalOrdered > 0 ? Math.round(totalReceived / totalOrdered * 100) : 0;
  const canReceive = ['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(order.status);

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/purchases" className="text-sm text-slate-500 hover:text-slate-700">← 발주 목록</Link>
          <h1 className="text-lg font-bold text-slate-800 font-mono">{order.po_number}</h1>
          <span className={`badge ${STATUS_BADGE[order.status] || ''}`}>{STATUS_LABELS[order.status] || order.status}</span>
        </div>
        <div className="flex gap-2">
          {order.status === 'DRAFT' && (
            <button onClick={handleConfirm} disabled={actionLoading} className="btn-primary py-2 px-4 text-sm">발주 확정</button>
          )}
          {canReceive && (
            <button onClick={() => setShowReceive(true)} className="btn-primary py-2 px-4 text-sm">입고 처리</button>
          )}
          {['DRAFT', 'CONFIRMED'].includes(order.status) && (
            <button onClick={handleCancel} disabled={actionLoading} className="btn-secondary py-2 px-4 text-sm text-red-500">발주 취소</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 발주 정보 */}
        <div className="lg:col-span-2 space-y-5">
          {/* 기본 정보 */}
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">발주 정보</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div>
                <span className="text-slate-500">공급업체</span>
                <p className="font-medium mt-0.5">{order.supplier?.name || '-'}</p>
              </div>
              <div>
                <span className="text-slate-500">입고 지점</span>
                <p className="font-medium mt-0.5">{order.branch?.name || '-'}</p>
              </div>
              <div>
                <span className="text-slate-500">발주일</span>
                <p className="font-medium mt-0.5">{order.ordered_at ? order.ordered_at.slice(0, 10) : '-'}</p>
              </div>
              <div>
                <span className="text-slate-500">납기 예정일</span>
                <p className="font-medium mt-0.5">{order.expected_date || '-'}</p>
              </div>
              {order.confirmed_at && (
                <div>
                  <span className="text-slate-500">확정일시</span>
                  <p className="font-medium mt-0.5">{order.confirmed_at.slice(0, 16).replace('T', ' ')}</p>
                </div>
              )}
              {order.memo && (
                <div className="col-span-2">
                  <span className="text-slate-500">메모</span>
                  <p className="font-medium mt-0.5">{order.memo}</p>
                </div>
              )}
            </div>
          </div>

          {/* 발주 항목 */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">발주 항목</h2>
              <div className="flex items-center gap-3">
                <div className="w-32 bg-slate-200 rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-sm text-slate-500">{totalReceived}/{totalOrdered}개 ({progress}%)</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>제품</th>
                    <th className="w-20 text-center">단위</th>
                    <th className="w-24 text-right">단가</th>
                    <th className="w-20 text-center">발주</th>
                    <th className="w-20 text-center">입고</th>
                    <th className="w-20 text-center">잔량</th>
                    <th className="w-32 text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items || []).map((item: any) => {
                    const remaining = item.ordered_quantity - item.received_quantity;
                    return (
                      <tr key={item.id}>
                        <td>
                          <p className="font-medium text-sm">{item.product?.name}</p>
                          <p className="text-xs text-slate-400">{item.product?.code}</p>
                        </td>
                        <td className="text-center text-sm text-slate-500">{item.product?.unit || '개'}</td>
                        <td className="text-right text-sm">{(item.unit_price || 0).toLocaleString()}원</td>
                        <td className="text-center text-sm">{item.ordered_quantity}</td>
                        <td className="text-center text-sm text-blue-600 font-medium">{item.received_quantity}</td>
                        <td className="text-center text-sm">
                          {remaining > 0 ? (
                            <span className="text-amber-600 font-medium">{remaining}</span>
                          ) : (
                            <span className="text-green-600">완료</span>
                          )}
                        </td>
                        <td className="text-right text-sm font-medium">
                          {(item.ordered_quantity * (item.unit_price || 0)).toLocaleString()}원
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="text-right font-semibold text-slate-700 pr-4">총 발주금액</td>
                    <td className="text-right font-bold text-blue-700">{(order.total_amount || 0).toLocaleString()}원</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* 사이드바: 공급업체 정보 + 입고 이력 */}
        <div className="space-y-5">
          {/* 공급업체 정보 */}
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">공급업체</h2>
            <div className="space-y-2 text-sm">
              <p className="font-semibold">{order.supplier?.name}</p>
              <p className="text-slate-500 font-mono text-xs">{order.supplier?.code}</p>
              {order.supplier?.phone && <p className="text-slate-600">📞 {order.supplier.phone}</p>}
              {order.supplier?.email && <p className="text-slate-600">✉ {order.supplier.email}</p>}
            </div>
          </div>

          {/* 입고 이력 */}
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
              입고 이력 <span className="text-slate-400 font-normal">({receipts.length}건)</span>
            </h2>
            {receipts.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">입고 이력 없음</p>
            ) : (
              <div className="space-y-3">
                {receipts.map(r => {
                  const qty = (r.items || []).reduce((s: number, i: any) => s + i.quantity, 0);
                  return (
                    <div key={r.id} className="border border-slate-100 rounded-lg p-3">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-mono text-xs font-medium text-blue-700">{r.receipt_number}</span>
                        <span className="text-xs text-slate-400">{r.received_at?.slice(0, 10)}</span>
                      </div>
                      <div className="space-y-1">
                        {(r.items || []).map((ri: any) => (
                          <div key={ri.id} className="flex justify-between text-xs text-slate-600">
                            <span>{ri.product?.name}</span>
                            <span className="font-medium">{ri.quantity}{ri.product?.unit || '개'}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-xs">
                        <span className="text-slate-500">합계</span>
                        <span className="font-semibold">{qty}개</span>
                      </div>
                      {r.memo && <p className="text-xs text-slate-400 mt-1">{r.memo}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showReceive && order && (
        <ReceiveModal
          purchaseOrderId={order.id}
          branchId={order.branch?.id}
          branchName={order.branch?.name || ''}
          items={order.items || []}
          onClose={() => setShowReceive(false)}
          onSuccess={() => { setShowReceive(false); fetchData(); }}
        />
      )}
    </div>
  );
}
