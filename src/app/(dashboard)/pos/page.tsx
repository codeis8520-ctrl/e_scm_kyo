'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  inventory?: any;
}

export default function POSPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'kakao'>('cash');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      
      const [productsRes, branchesRes, customersRes] = await Promise.all([
        supabase.from('products').select('*, inventories(*)').eq('is_active', true).order('name'),
        supabase.from('branches').select('*').eq('is_active', true).order('created_at'),
        supabase.from('customers').select('*').eq('is_active', true).order('name').limit(100),
      ]);

      const branchesData = (branchesRes.data || []) as any[];
      setProducts((productsRes.data || []) as any[]);
      setBranches(branchesData);
      setCustomers((customersRes.data || []) as any[]);
      
      if (branchesData.length > 0) {
        setSelectedBranch(branchesData[0].id);
      }
      
      setLoading(false);
    };
    fetchData();
  }, []);

  const filteredProducts = products.filter(p =>
    p.name.includes(search) || p.code.includes(search)
  );

  const addToCart = (product: any) => {
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
        inventory: product.inventories,
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

  const handlePayment = async () => {
    if (cart.length === 0) return;
    if (!selectedBranch) {
      alert('지점을 선택해주세요.');
      return;
    }

    setProcessing(true);
    const supabase = createClient();
    const db = supabase as any;

    try {
      // 1. 재고 확인 및 차감
      for (const item of cart) {
        const { data: inventory } = await supabase
          .from('inventories')
          .select('id, quantity')
          .eq('branch_id', selectedBranch)
          .eq('product_id', item.productId)
          .single();

        const inv = inventory as any;
        if (!inv || inv.quantity < item.quantity) {
          alert(`"${item.name}" 재고가 부족합니다.`);
          setProcessing(false);
          return;
        }

        await db.from('inventories').update({
          quantity: inv.quantity - item.quantity,
        }).eq('id', inv.id);

        await db.from('inventory_movements').insert({
          branch_id: selectedBranch,
          product_id: item.productId,
          movement_type: 'OUT',
          quantity: item.quantity,
          reference_type: 'POS_SALE',
          memo: null,
        });
      }

      // 2. 판매 전표 생성
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const branchCode = branches.find(b => b.id === selectedBranch)?.code || 'ETC';
      const orderNumber = `SA-${branchCode}-${today}-${Date.now().toString().slice(-4)}`;

      const { data: { user } } = await supabase.auth.getUser();

      const { data: saleOrder, error: saleError } = await db.from('sales_orders').insert({
        order_number: orderNumber,
        channel: branches.find(b => b.id === selectedBranch)?.channel || 'STORE',
        branch_id: selectedBranch,
        customer_id: selectedCustomer || null,
        ordered_by: user?.id,
        total_amount: total,
        discount_amount: 0,
        status: 'COMPLETED',
        payment_method: paymentMethod,
        points_earned: Math.floor(total / 100),
        ordered_at: new Date().toISOString(),
      }).select().single();

      if (saleError) throw saleError;

      // 3. 판매 항목 저장
      for (const item of cart) {
        await db.from('sales_order_items').insert({
          sales_order_id: (saleOrder as any).id,
          product_id: item.productId,
          quantity: item.quantity,
          unit_price: item.price,
          discount_amount: 0,
          total_price: item.price * item.quantity,
        });
      }

      // 4. 포인트 적립 (고객 선택 시)
      if (selectedCustomer) {
        const pointsEarned = Math.floor(total / 100);
        await db.from('point_history').insert({
          customer_id: selectedCustomer,
          sales_order_id: (saleOrder as any).id,
          type: 'earn',
          points: pointsEarned,
          balance: 0,
          description: `구매 적립 (${orderNumber})`,
        });

        await db.from('customers').update({
          total_points: db.sql`total_points + ${pointsEarned}`,
          total_purchase: db.sql`total_purchase + ${total}`,
        }).eq('id', selectedCustomer);
      }

      alert(`결제가 완료되었습니다.\n전표번호: ${orderNumber}`);
      setCart([]);
    } catch (err: any) {
      console.error(err);
      alert('결제 처리 중 오류가 발생했습니다.');
    }

    setProcessing(false);
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {/* 제품 목록 */}
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
          {loading ? (
            <p className="text-center text-slate-400 py-8">로딩 중...</p>
          ) : (
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
                  {product.inventories?.quantity !== undefined && (
                    <p className="text-xs text-slate-500 mt-1">
                      재고: {product.inventories.quantity}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 장바구니 */}
      <div className="w-[420px] bg-white rounded-lg shadow flex flex-col">
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

          {/* 지점 선택 */}
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="input"
          >
            <option value="">지점 선택</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          {/* 고객 선택 */}
          <select
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
            className="input"
          >
            <option value="">비회원</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
            ))}
          </select>

          {/* 결제 수단 */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`py-2 rounded-md ${
                paymentMethod === 'cash'
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              현금
            </button>
            <button
              onClick={() => setPaymentMethod('card')}
              className={`py-2 rounded-md ${
                paymentMethod === 'card'
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              카드
            </button>
            <button
              onClick={() => setPaymentMethod('kakao')}
              className={`py-2 rounded-md ${
                paymentMethod === 'kakao'
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              카카오
            </button>
          </div>

          <button
            onClick={handlePayment}
            disabled={cart.length === 0 || !selectedBranch || processing}
            className="w-full btn-primary py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? '처리 중...' : '결제하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
