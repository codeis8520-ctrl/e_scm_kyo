'use client';

import { useState } from 'react';
import { receivePurchaseOrder } from '@/lib/purchase-actions';

interface POItem {
  id: string;
  product_id: string;
  ordered_quantity: number;
  received_quantity: number;
  unit_price: number;
  product: { id: string; name: string; code: string; unit: string };
}

interface Props {
  purchaseOrderId: string;
  branchId: string;
  branchName: string;
  items: POItem[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReceiveModal({ purchaseOrderId, branchId, branchName, items, onClose, onSuccess }: Props) {
  const remaining = items.map(i => ({
    ...i,
    remaining: i.ordered_quantity - i.received_quantity,
  })).filter(i => i.remaining > 0);

  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>(
    Object.fromEntries(remaining.map(i => [i.id, i.remaining]))
  );
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setQty = (id: string, val: number, max: number) => {
    setReceiveQtys(prev => ({ ...prev, [id]: Math.min(Math.max(0, val), max) }));
  };

  const setAll = (full: boolean) => {
    setReceiveQtys(Object.fromEntries(remaining.map(i => [i.id, full ? i.remaining : 0])));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeItems = remaining
      .filter(i => receiveQtys[i.id] > 0)
      .map(i => ({
        purchase_order_item_id: i.id,
        product_id: i.product_id,
        quantity: receiveQtys[i.id],
      }));

    if (!activeItems.length) { setError('입고 수량을 1개 이상 입력하세요.'); return; }
    setLoading(true);
    setError('');

    const fd = new FormData();
    fd.append('purchase_order_id', purchaseOrderId);
    fd.append('branch_id', branchId);
    fd.append('memo', memo);
    fd.append('items', JSON.stringify(activeItems));

    const result = await receivePurchaseOrder(fd);
    if (result.error) { setError(result.error); setLoading(false); }
    else onSuccess();
  };

  const totalQty = remaining.reduce((s, i) => s + (receiveQtys[i.id] || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold">입고 처리</h2>
            <p className="text-sm text-slate-500 mt-0.5">입고 지점: <strong>{branchName}</strong></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {error && <div className="mx-6 mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-slate-600">입고 수량 입력</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAll(true)} className="text-xs text-blue-600 hover:underline">전체 입고</button>
              <span className="text-slate-300">|</span>
              <button type="button" onClick={() => setAll(false)} className="text-xs text-slate-400 hover:underline">모두 0으로</button>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>제품</th>
                  <th className="w-20 text-center">발주</th>
                  <th className="w-20 text-center">기입고</th>
                  <th className="w-20 text-center">잔량</th>
                  <th className="w-32 text-center">이번 입고</th>
                </tr>
              </thead>
              <tbody>
                {remaining.map(item => (
                  <tr key={item.id}>
                    <td>
                      <p className="font-medium text-sm">{item.product.name}</p>
                      <p className="text-xs text-slate-400">{item.product.code}</p>
                    </td>
                    <td className="text-center text-sm">{item.ordered_quantity}<span className="text-slate-400 text-xs ml-1">{item.product.unit}</span></td>
                    <td className="text-center text-sm text-slate-500">{item.received_quantity}</td>
                    <td className="text-center text-sm font-medium text-amber-600">{item.remaining}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={item.remaining}
                        value={receiveQtys[item.id] ?? 0}
                        onChange={e => setQty(item.id, parseInt(e.target.value) || 0, item.remaining)}
                        className="input text-center w-24 mx-auto block"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50">
                  <td colSpan={4} className="text-right font-semibold text-slate-700 pr-4">이번 입고 합계</td>
                  <td className="text-center font-bold text-blue-700">{totalQty}개</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">메모</label>
            <input value={memo} onChange={e => setMemo(e.target.value)} className="mt-1 input" placeholder="검수 내용, 특이사항 등" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading || totalQty === 0} className="flex-1 btn-primary py-2.5">
              {loading ? '처리 중...' : `입고 처리 (${totalQty}개)`}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary py-2.5">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
