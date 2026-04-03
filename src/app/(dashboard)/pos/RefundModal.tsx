'use client';

import { useState } from 'react';
import { getSalesOrderForRefund, processRefund } from '@/lib/return-actions';

const REFUND_REASONS = [
  { value: 'DEFECTIVE', label: '불량/하자' },
  { value: 'WRONG_ITEM', label: '오배송/오선택' },
  { value: 'CHANGE_OF_MIND', label: '단순 변심' },
  { value: 'DUPLICATE', label: '중복 구매' },
  { value: 'OTHER', label: '기타' },
];

const REFUND_METHODS = [
  { value: 'cash', label: '현금 반환' },
  { value: 'card', label: '카드 취소' },
  { value: 'point', label: '포인트 전환' },
];

interface Props {
  branchId: string;
  onClose: () => void;
  onSuccess: (returnNumber: string) => void;
}

export default function RefundModal({ branchId, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<'search' | 'select'>('search');
  const [orderNumber, setOrderNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [searchError, setSearchError] = useState('');
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderNumber.trim()) return;
    setSearching(true);
    setSearchError('');
    const result = await getSalesOrderForRefund(orderNumber.trim().toUpperCase());
    if (result.error || !result.data) {
      setSearchError(result.error || '주문을 찾을 수 없습니다.');
      setSearching(false);
      return;
    }

    const o = result.data;
    if (o.status === 'CANCELLED') {
      setSearchError('취소된 주문입니다.');
      setSearching(false);
      return;
    }
    if (o.status === 'REFUNDED') {
      setSearchError('이미 전액 환불된 주문입니다.');
      setSearching(false);
      return;
    }

    setOrder(o);
    // 기본값: 전체 수량으로 초기화
    const defaults: Record<string, number> = {};
    for (const item of (o.items || [])) {
      defaults[item.id] = item.quantity;
    }
    setSelectedItems(defaults);
    setStep('select');
    setSearching(false);
  };

  const updateQty = (itemId: string, val: number, max: number) => {
    setSelectedItems(prev => ({ ...prev, [itemId]: Math.min(Math.max(0, val), max) }));
  };

  const activeItems = order
    ? (order.items || []).filter((i: any) => selectedItems[i.id] > 0)
    : [];

  const refundAmount = activeItems.reduce(
    (sum: number, i: any) => sum + selectedItems[i.id] * i.unit_price, 0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) { setError('환불 사유를 선택하세요.'); return; }
    if (activeItems.length === 0) { setError('환불 수량을 1개 이상 입력하세요.'); return; }

    setProcessing(true);
    setError('');

    const result = await processRefund({
      originalOrderId: order.id,
      branchId: order.branch?.id || branchId,
      reason,
      reasonDetail,
      refundMethod,
      items: activeItems.map((i: any) => ({
        sales_order_item_id: i.id,
        product_id: i.product.id,
        quantity: selectedItems[i.id],
        unit_price: i.unit_price,
      })),
    });

    if (result.error) {
      setError(result.error);
      setProcessing(false);
    } else {
      onSuccess(result.returnNumber!);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold">환불 처리</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {step === 'search' && (
          <div className="p-6">
            <p className="text-sm text-slate-500 mb-4">환불할 주문의 전표번호를 입력하세요.</p>
            <form onSubmit={handleSearch} className="flex gap-3">
              <input
                type="text"
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                placeholder="SA-BRANCH-YYYYMMDD-XXXX"
                className="input flex-1 font-mono"
                autoFocus
              />
              <button type="submit" disabled={searching || !orderNumber.trim()} className="btn-primary px-5">
                {searching ? '조회 중...' : '조회'}
              </button>
            </form>
            {searchError && (
              <div className="mt-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{searchError}</div>
            )}
          </div>
        )}

        {step === 'select' && order && (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* 원본 주문 정보 */}
            <div className="bg-slate-50 rounded-lg p-4 text-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono font-semibold text-blue-700">{order.order_number}</p>
                  <p className="text-slate-500 mt-0.5">
                    {order.ordered_at?.slice(0, 16).replace('T', ' ')} · {order.branch?.name}
                  </p>
                  {order.customer && (
                    <p className="text-slate-600 mt-1">{order.customer.name} ({order.customer.phone})</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold">{(order.total_amount || 0).toLocaleString()}원</p>
                  <p className="text-xs text-slate-400">{order.payment_method}</p>
                </div>
              </div>
            </div>

            {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

            {/* 환불 항목 선택 */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-medium text-slate-700">환불 수량 선택</span>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => {
                    const all: Record<string, number> = {};
                    (order.items || []).forEach((i: any) => { all[i.id] = i.quantity; });
                    setSelectedItems(all);
                  }} className="text-blue-600 hover:underline">전체 선택</button>
                  <span className="text-slate-300">|</span>
                  <button type="button" onClick={() => {
                    const none: Record<string, number> = {};
                    (order.items || []).forEach((i: any) => { none[i.id] = 0; });
                    setSelectedItems(none);
                  }} className="text-slate-400 hover:underline">전체 0</button>
                </div>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="table">
                  <thead>
                    <tr>
                      <th>제품</th>
                      <th className="w-20 text-center">구매수량</th>
                      <th className="w-20 text-right">단가</th>
                      <th className="w-28 text-center">환불수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.items || []).map((item: any) => (
                      <tr key={item.id}>
                        <td>
                          <p className="font-medium text-sm">{item.product.name}</p>
                          <p className="text-xs text-slate-400">{item.product.code}</p>
                        </td>
                        <td className="text-center text-sm">{item.quantity}</td>
                        <td className="text-right text-sm">{item.unit_price.toLocaleString()}원</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={item.quantity}
                            value={selectedItems[item.id] ?? 0}
                            onChange={e => updateQty(item.id, parseInt(e.target.value) || 0, item.quantity)}
                            className="input text-center w-20 mx-auto block"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td colSpan={3} className="text-right font-semibold pr-4">환불 금액</td>
                      <td className="text-center font-bold text-red-600">{refundAmount.toLocaleString()}원</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* 환불 사유 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">환불 사유 *</label>
                <select value={reason} onChange={e => setReason(e.target.value)} required className="input">
                  <option value="">선택</option>
                  {REFUND_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">환불 방법 *</label>
                <select value={refundMethod} onChange={e => setRefundMethod(e.target.value)} className="input">
                  {REFUND_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">상세 사유</label>
                <input value={reasonDetail} onChange={e => setReasonDetail(e.target.value)} className="input" placeholder="선택 사항" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={processing || activeItems.length === 0 || !reason}
                className="flex-1 btn-primary py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-50"
              >
                {processing ? '처리 중...' : `환불 처리 (${refundAmount.toLocaleString()}원)`}
              </button>
              <button type="button" onClick={() => setStep('search')} className="flex-1 btn-secondary py-2.5">
                다시 검색
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
