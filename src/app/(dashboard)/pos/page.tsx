'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  inventory?: any;
  barcode?: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  grade: string;
}

export default function POSPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [productMap, setProductMap] = useState<Map<string, any>>(new Map());
  const [branches, setBranches] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'kakao'>('cash');
  const [processing, setProcessing] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const productSearchRef = useRef<HTMLInputElement>(null);

  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      
      const [productsRes, branchesRes, customersRes] = await Promise.all([
        supabase.from('products').select('*, inventories(*)').eq('is_active', true).order('name'),
        supabase.from('branches').select('*').eq('is_active', true).order('created_at'),
        supabase.from('customers').select('id, name, phone, grade').eq('is_active', true).order('name'),
      ]);

      const branchesData = (branchesRes.data || []) as any[];
      const productsData = (productsRes.data || []) as any[];
      const customersData = (customersRes.data || []) as any[];

      setProducts(productsData);
      setBranches(branchesData);
      setCustomers(customersData);

      const map = new Map<string, any>();
      productsData.forEach(p => {
        if (p.barcode) map.set(p.barcode, p);
        map.set(p.code, p);
      });
      setProductMap(map);

      const role = getCookie('user_role');
      const userBranchId = getCookie('user_branch_id');
      setUserRole(role);
      
      if (role === 'BRANCH_STAFF' || role === 'PHARMACY_STAFF') {
        if (userBranchId) {
          setSelectedBranch(userBranchId);
        }
      } else if (branchesData.length > 0) {
        setSelectedBranch(branchesData[0].id);
      }
      
      setLoading(false);
    };
    fetchData();

    barcodeInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (customerSearch.length >= 1) {
      const q = customerSearch.toLowerCase();
      const results = customers.filter(c => 
        c.name.toLowerCase().includes(q) ||
        c.phone.replace(/-/g, '').includes(q.replace(/-/g, ''))
      );
      setCustomerResults(results.slice(0, 10));
      setShowCustomerDropdown(true);
    } else {
      setCustomerResults([]);
      setShowCustomerDropdown(false);
    }
  }, [customerSearch, customers]);

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
        barcode: product.barcode,
      }];
    });
    setSearch('');
    productSearchRef.current?.focus();
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

  const handleBarcodeScan = (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    
    const product = productMap.get(trimmed);
    if (product) {
      addToCart(product);
      setLastScannedBarcode(trimmed);
    } else {
      alert(`바코드 "${trimmed}" 해당 제품이 없습니다.`);
    }
    setSearch('');
  };

  const selectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerSearch('');
    setCustomerResults([]);
    setShowCustomerDropdown(false);
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerSearch('');
    setCustomerResults([]);
    setShowCustomerDropdown(false);
    customerInputRef.current?.focus();
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

    let saleOrderId = null;
    let orderNumber = '';

    try {
      // 1. 먼저 판매 전표 생성 (재고 차감 전에)
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const branchCode = branches.find(b => b.id === selectedBranch)?.code || 'ETC';
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      orderNumber = `SA-${branchCode}-${today}-${randomSuffix}`;

      const { data: { user } } = await supabase.auth.getUser();
      
      // ordered_by가 users 테이블에 있는지 확인
      let orderedByUserId = user?.id;
      if (user?.id) {
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('id', user.id)
          .single();
        
        if (!userData) {
          // users 테이블에 없으면 생성 (trigger가 안된 경우)
          const { error: userError } = await db.from('users').insert({
            id: user.id,
            email: user.email || 'unknown@pos.com',
            name: user.email?.split('@')[0] || 'POS 사용자',
            password_hash: '',
            role: 'PHARMACY_STAFF',
          });
          if (userError) {
            console.error('사용자 생성 실패:', userError);
          }
        }
      }

      const { data: saleOrder, error: saleError } = await db.from('sales_orders').insert({
        order_number: orderNumber,
        channel: branches.find(b => b.id === selectedBranch)?.channel || 'STORE',
        branch_id: selectedBranch,
        customer_id: selectedCustomer?.id || null,
        ordered_by: orderedByUserId,
        total_amount: total,
        discount_amount: 0,
        status: 'COMPLETED',
        payment_method: paymentMethod,
        points_earned: Math.floor(total / 100),
        ordered_at: new Date().toISOString(),
      }).select().single();

      if (saleError) throw saleError;
      saleOrderId = (saleOrder as any).id;

      // 2. 판매 항목 저장
      for (const item of cart) {
        await db.from('sales_order_items').insert({
          sales_order_id: saleOrderId,
          product_id: item.productId,
          quantity: item.quantity,
          unit_price: item.price,
          discount_amount: 0,
          total_price: item.price * item.quantity,
        });
      }

      // 3. 재고 확인 및 차감 (판매 전표 생성 후에)
      for (const item of cart) {
        const { data: inventory } = await supabase
          .from('inventories')
          .select('id, quantity')
          .eq('branch_id', selectedBranch)
          .eq('product_id', item.productId)
          .single();

        const inv = inventory as any;
        if (!inv || inv.quantity < item.quantity) {
          // 재고 부족 -刚才创建的销售记录需要删除
          await db.from('sales_orders').delete().eq('id', saleOrderId);
          alert(`"${item.name}" 재고가 부족합니다. 결제가 취소되었습니다.`);
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
          reference_id: saleOrderId,
          reference_type: 'POS_SALE',
          memo: null,
        });
      }

      // 4. 포인트 적립
      if (selectedCustomer) {
        const pointsEarned = Math.floor(total / 100);
        await db.from('point_history').insert({
          customer_id: selectedCustomer.id,
          sales_order_id: saleOrderId,
          type: 'earn',
          points: pointsEarned,
          balance: 0,
          description: `구매 적립 (${orderNumber})`,
        });
      }

      alert(`결제가 완료되었습니다.\n전표번호: ${orderNumber}`);
      setCart([]);
      setSelectedCustomer(null);
      setCustomerSearch('');
      barcodeInputRef.current?.focus();
    } catch (err: any) {
      console.error('결제 오류:', err);
      // 에러 발생 시刚才创建的销售记录也删除
      if (saleOrderId) {
        try {
          await db.from('sales_orders').delete().eq('id', saleOrderId);
        } catch (e) {
          console.error('판매 전표 삭제 실패:', e);
        }
      }
      const errorMsg = err?.message || err?.details || JSON.stringify(err);
      alert(`결제 처리 중 오류가 발생했습니다.\n\n${errorMsg}\n\n브라우저 콘솔(F12)을 확인해주세요.`);
    }

    setProcessing(false);
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      <div className="flex-1 flex flex-col">
        <div className="mb-3">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                ref={productSearchRef}
                type="text"
                placeholder="제품검색 (이름/코드)... 또는 바코드 스캔"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && search.trim()) {
                    const product = products.find(p => p.code === search.trim() || p.barcode === search.trim());
                    if (product) {
                      addToCart(product);
                    }
                  }
                }}
                className="input"
              />
            </div>
          </div>
          <div className="mt-2 relative">
            <input
              ref={barcodeInputRef}
              type="text"
              placeholder="📷 바코드 리더기:条码扫描器 (Enter 자동 인식)"
              className="input text-sm border-2 border-blue-200 focus:border-blue-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const target = e.target as HTMLInputElement;
                  handleBarcodeScan(target.value);
                  target.value = '';
                }
              }}
              onFocus={() => {
                if (lastScannedBarcode) setLastScannedBarcode('');
              }}
            />
            {lastScannedBarcode && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                ✓ {lastScannedBarcode}
              </span>
            )}
          </div>
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
                  className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow text-left border border-slate-100 hover:border-blue-300"
                >
                  {product.barcode && (
                    <p className="text-xs text-slate-400 font-mono mb-1">{product.barcode}</p>
                  )}
                  <p className="font-medium text-slate-800">{product.name}</p>
                  <p className="text-xs text-slate-400 mb-2">{product.code}</p>
                  <p className="text-lg font-bold text-blue-600">
                    {product.price.toLocaleString()}원
                  </p>
                  {product.inventories?.quantity !== undefined && (
                    <p className={`text-xs mt-1 ${product.inventories.quantity < 10 ? 'text-red-500' : 'text-slate-500'}`}>
                      재고: {product.inventories.quantity}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

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

          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            disabled={isBranchUser}
            className={`input ${isBranchUser ? 'bg-slate-100 cursor-not-allowed' : ''}`}
          >
            <option value="">지점 선택</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          <div className="relative">
            {selectedCustomer ? (
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div>
                  <p className="font-medium text-blue-800">{selectedCustomer.name}</p>
                  <p className="text-sm text-blue-600">{selectedCustomer.phone}</p>
                  <span className={`inline-block px-2 py-0.5 text-xs rounded ${
                    selectedCustomer.grade === 'VVIP' ? 'bg-red-100 text-red-700' :
                    selectedCustomer.grade === 'VIP' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {selectedCustomer.grade}
                  </span>
                </div>
                <button onClick={clearCustomer} className="text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  ref={customerInputRef}
                  type="text"
                  placeholder="고객 검색 (이름/휴대폰 뒷자리)"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  onFocus={() => customerSearch.length >= 1 && setShowCustomerDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                  className="input"
                />
                {showCustomerDropdown && customerResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {customerResults.map(c => (
                      <button
                        key={c.id}
                        onMouseDown={() => selectCustomer(c)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-slate-100 last:border-b-0"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{c.name}</p>
                            <p className="text-sm text-slate-500">{c.phone}</p>
                          </div>
                          <span className={`px-2 py-0.5 text-xs rounded ${
                            c.grade === 'VVIP' ? 'bg-red-100 text-red-700' :
                            c.grade === 'VIP' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {c.grade}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showCustomerDropdown && customerSearch.length >= 1 && customerResults.length === 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg p-4 text-center text-slate-400">
                    검색 결과 없음
                  </div>
                )}
              </div>
            )}
          </div>

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
