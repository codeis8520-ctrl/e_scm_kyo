'use client';

import { useRef } from 'react';

interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface Props {
  orderNumber: string;
  branchName: string;
  customerName?: string;
  items: ReceiptItem[];
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
  pointsUsed: number;
  pointsEarned: number;
  paymentMethod: string;
  orderedAt: string;
  onClose: () => void;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: '현금',
  card: '카드',
  kakao: '카카오페이',
};

export default function ReceiptModal({
  orderNumber, branchName, customerName,
  items, totalAmount, discountAmount, finalAmount,
  pointsUsed, pointsEarned, paymentMethod, orderedAt,
  onClose,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current?.innerHTML;
    if (!content) return;

    const win = window.open('', '_blank', 'width=380,height=700');
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>영수증 - ${orderNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Courier New', monospace; font-size: 12px; width: 320px; padding: 10px; }
            .center { text-align: center; }
            .right { text-align: right; }
            .bold { font-weight: bold; }
            .divider { border-top: 1px dashed #000; margin: 6px 0; }
            .row { display: flex; justify-content: space-between; margin: 3px 0; }
            .item-name { flex: 1; }
            .item-qty { width: 30px; text-align: center; }
            .item-price { width: 70px; text-align: right; }
            h1 { font-size: 16px; font-weight: bold; margin: 6px 0; }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 300);
  };

  const date = new Date(orderedAt);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const timeStr = `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-sm shadow-xl">
        <div className="flex justify-between items-center px-5 py-3 border-b">
          <h2 className="font-bold text-slate-800">영수증</h2>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="btn-secondary py-1.5 px-3 text-sm">🖨 인쇄</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
          </div>
        </div>

        {/* 영수증 본문 — 인쇄 대상 */}
        <div ref={printRef} className="p-5 font-mono text-sm">
          <div className="text-center mb-3">
            <h1 className="text-lg font-bold">경옥채</h1>
            <p className="text-xs text-slate-500">{branchName}</p>
          </div>

          <div className="border-t border-dashed border-slate-300 my-3" />

          <div className="space-y-0.5 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>전표번호</span>
              <span className="font-mono">{orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>일시</span>
              <span>{dateStr} {timeStr}</span>
            </div>
            {customerName && (
              <div className="flex justify-between">
                <span>고객</span>
                <span>{customerName}</span>
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-slate-300 my-3" />

          {/* 품목 */}
          <div className="space-y-1">
            <div className="flex text-xs text-slate-400 mb-1">
              <span className="flex-1">품목</span>
              <span className="w-8 text-center">수량</span>
              <span className="w-20 text-right">금액</span>
            </div>
            {items.map((item, i) => (
              <div key={i}>
                <div className="flex text-sm">
                  <span className="flex-1 truncate">{item.name}</span>
                  <span className="w-8 text-center text-slate-500">{item.quantity}</span>
                  <span className="w-20 text-right">{item.totalPrice.toLocaleString()}</span>
                </div>
                {item.quantity > 1 && (
                  <div className="text-xs text-slate-400 pl-1">
                    @{item.unitPrice.toLocaleString()}원 × {item.quantity}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-slate-300 my-3" />

          {/* 합계 */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">소계</span>
              <span>{totalAmount.toLocaleString()}원</span>
            </div>
            {pointsUsed > 0 && (
              <div className="flex justify-between text-green-600">
                <span>포인트 사용</span>
                <span>-{pointsUsed.toLocaleString()}P</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-red-500">
                <span>할인</span>
                <span>-{discountAmount.toLocaleString()}원</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-1 mt-1">
              <span>합계</span>
              <span>{finalAmount.toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-slate-500 text-xs">
              <span>결제수단</span>
              <span>{PAYMENT_LABELS[paymentMethod] || paymentMethod}</span>
            </div>
          </div>

          {pointsEarned > 0 && (
            <>
              <div className="border-t border-dashed border-slate-300 my-3" />
              <div className="flex justify-between text-xs text-blue-600">
                <span>이번 적립 포인트</span>
                <span>+{pointsEarned.toLocaleString()}P</span>
              </div>
            </>
          )}

          <div className="border-t border-dashed border-slate-300 my-3" />
          <p className="text-center text-xs text-slate-400">감사합니다 · 경옥채</p>
        </div>
      </div>
    </div>
  );
}
