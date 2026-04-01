'use client';

import { useState } from 'react';

interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export default function ManualPOSPage() {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');

  const addItem = () => {
    if (!productName || !price) return;

    const newItem: OrderItem = {
      productId: Date.now().toString(),
      name: productName,
      price: parseInt(price),
      quantity: parseInt(quantity) || 1,
    };

    setItems(prev => [...prev, newItem]);
    setProductName('');
    setPrice('');
    setQuantity('1');
  };

  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(item => item.productId !== productId));
  };

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleSubmit = () => {
    if (items.length === 0) return;
    alert('수기 거래가 등록되었습니다.');
    setItems([]);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <h3 className="font-semibold text-lg mb-6">수기 거래 입력</h3>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              제품명
            </label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="input"
              placeholder="제품명을 입력하세요"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                단가
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="input"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                수량
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="input"
                placeholder="1"
                min="1"
              />
            </div>
          </div>
          <button onClick={addItem} className="btn-secondary w-full">
            + 항목 추가
          </button>
        </div>

        {items.length > 0 && (
          <>
            <div className="border-t pt-4 mb-4">
              <table className="table">
                <thead>
                  <tr>
                    <th>제품명</th>
                    <th>단가</th>
                    <th>수량</th>
                    <th>합계</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.productId}>
                      <td>{item.name}</td>
                      <td>{item.price.toLocaleString()}원</td>
                      <td>{item.quantity}</td>
                      <td>{(item.price * item.quantity).toLocaleString()}원</td>
                      <td>
                        <button
                          onClick={() => removeItem(item.productId)}
                          className="text-red-600 hover:underline"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center text-lg font-bold mb-4">
              <span>합계</span>
              <span>{total.toLocaleString()}원</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <select className="input">
                <option value="cash">현금</option>
                <option value="card">카드</option>
                <option value="kakao">카카오</option>
              </select>
              <select className="input">
                <option value="">지점 선택</option>
                <option value="HQ">본사</option>
                <option value="PHA">한약국</option>
                <option value="DS-GN">백화점 강남점</option>
                <option value="DS-HD">백화점 홍대점</option>
              </select>
              <input type="text" className="input" placeholder="고객 연락처 (선택)" />
            </div>

            <button onClick={handleSubmit} className="btn-primary w-full py-3">
              거래 등록
            </button>
          </>
        )}
      </div>
    </div>
  );
}
