'use client';

import { useState } from 'react';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export default function POSPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');

  const products = [
    { id: '1', name: '경옥고', price: 50000, code: 'KOG-001' },
    { id: '2', name: '한방건강차', price: 15000, code: 'HHC-001' },
    { id: '3', name: '삼계탕세트', price: 35000, code: 'SGT-001' },
    { id: '4', name: '황기차', price: 12000, code: 'HGC-001' },
    { id: '5', name: '약선죽', price: 20000, code: 'YSJ-001' },
  ];

  const filteredProducts = products.filter(p =>
    p.name.includes(search) || p.code.includes(search)
  );

  const addToCart = (product: typeof products[0]) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: 1,
      }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart(prev =>
      prev.map(item =>
        item.productId === productId ? { ...item, quantity } : item
      )
    );
  };

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handlePayment = () => {
    if (cart.length === 0) return;
    alert('결제가 완료되었습니다.');
    setCart([]);
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      <div className="flex-1 flex flex-col">
        <div className="mb-4">
          <input
            type="text"
            placeholder="제품명 또는 코드 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
        </div>

        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredProducts.map(product => (
              <button
                key={product.id}
                onClick={() => addToCart(product)}
                className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow text-left"
              >
                <p className="font-medium text-slate-800">{product.name}</p>
                <p className="text-xs text-slate-400 mb-2">{product.code}</p>
                <p className="text-lg font-bold text-blue-600">
                  {product.price.toLocaleString()}원
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-96 bg-white rounded-lg shadow flex flex-col">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-lg">장바구니</h3>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {cart.map(item => (
            <div key={item.productId} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
              <div className="flex-1">
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-slate-500">
                  {item.price.toLocaleString()}원
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                  className="w-8 h-8 bg-slate-200 rounded hover:bg-slate-300"
                >
                  -
                </button>
                <span className="w-8 text-center">{item.quantity}</span>
                <button
                  onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                  className="w-8 h-8 bg-slate-200 rounded hover:bg-slate-300"
                >
                  +
                </button>
                <button
                  onClick={() => removeFromCart(item.productId)}
                  className="w-8 h-8 bg-red-100 text-red-600 rounded hover:bg-red-200"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {cart.length === 0 && (
            <p className="text-center text-slate-400 py-8">
              장바구니가 비어있습니다
            </p>
          )}
        </div>

        <div className="p-4 border-t space-y-4">
          <div className="flex justify-between text-lg font-bold">
            <span>합계</span>
            <span>{total.toLocaleString()}원</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button className="btn-secondary py-3">현금</button>
            <button className="btn-secondary py-3">카드</button>
            <button className="btn-secondary py-3">카카오</button>
          </div>
          <button
            onClick={handlePayment}
            disabled={cart.length === 0}
            className="w-full btn-primary py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            결제하기
          </button>
        </div>
      </div>
    </div>
  );
}
