'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { processPosCheckout } from '@/lib/actions';
import { requestCardApproval, isUsingMock } from '@/lib/card-terminal';
import RefundModal from './RefundModal';
import ReceiptModal from './ReceiptModal';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}

const GRADE_LABELS: Record<string, string> = { VVIP: 'VVIP', VIP: 'VIP', NORMAL: '일반' };
const GRADE_BADGE: Record<string, string> = {
  VVIP: 'bg-red-100 text-red-700',
  VIP: 'bg-amber-100 text-amber-700',
  NORMAL: 'bg-slate-100 text-slate-600',
};

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  discount: number;
  barcode?: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  grade: string;
  grade_point_rate?: number;
  currentPoints?: number;
}

export default function POSPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [productMap, setProductMap] = useState<Map<string, any>>(new Map());
  // inventory map: `${branchId}_${productId}` → quantity
  const [inventoryMap, setInventoryMap] = useState<Map<string, number>>(new Map());
  const [branches, setBranches] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'kakao' | 'card_keyin' | 'credit'>('card');
  const [cashReceived, setCashReceived] = useState('');
  const [processing, setProcessing] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyVal, setEditingQtyVal] = useState('');
  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);
  const [editingDiscountVal, setEditingDiscountVal] = useState('');
  const [editingDiscountType, setEditingDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState('');
  const [cardApprovalState, setCardApprovalState] = useState<'idle' | 'waiting' | 'approved' | 'error'>('idle');
  const [cardApprovalResult, setCardApprovalResult] = useState<{ approvalNo?: string; cardInfo?: string } | null>(null);
  const [cardApprovalError, setCardApprovalError] = useState('');
  // quick register
  const [showQuickReg, setShowQuickReg] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickRegLoading, setQuickRegLoading] = useState(false);

  const [cartOpen, setCartOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const editingQtyRef = useRef<HTMLInputElement>(null);
  const editingDiscountRef = useRef<HTMLInputElement>(null);

  const initialRole = getCookie('user_role');
  const initialBranchId = getCookie('user_branch_id');
  const [selectedBranch, setSelectedBranch] = useState<string>(initialBranchId || '');
  const [userRole] = useState<string | null>(initialRole);

  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  // ── 초기 데이터 로드 ───────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const [productsRes, branchesRes, customersRes, gradesRes, invRes] = await Promise.all([
        supabase.from('products').select('id, name, code, barcode, price, unit').eq('is_active', true).order('name'),
        supabase.from('branches').select('*').eq('is_active', true).order('created_at'),
        supabase.from('customers').select('id, name, phone, grade').eq('is_active', true).order('name'),
        supabase.from('customer_grades').select('code, point_rate'),
        supabase.from('inventories').select('product_id, branch_id, quantity'),
      ]);

      const gradesMap = new Map((gradesRes.data || []).map((g: any) => [g.code, parseFloat(g.point_rate) || 1.0]));
      const branchesData = (branchesRes.data || []) as any[];
      const productsData = (productsRes.data || []) as any[];

      // 재고 맵 구성
      const invMap = new Map<string, number>();
      for (const inv of (invRes.data || []) as any[]) {
        invMap.set(`${inv.branch_id}_${inv.product_id}`, inv.quantity);
      }

      setProducts(productsData);
      setBranches(branchesData);
      setInventoryMap(invMap);
      setCustomers((customersRes.data || []).map((c: any) => ({
        ...c,
        grade_point_rate: gradesMap.get(c.grade) || 1.0,
      })));

      const pMap = new Map<string, any>();
      productsData.forEach(p => {
        if (p.barcode) pMap.set(p.barcode, p);
        pMap.set(p.code, p);
      });
      setProductMap(pMap);

      if (isBranchUser && initialBranchId) {
        setSelectedBranch(initialBranchId);
      } else if (branchesData.length > 0) {
        setSelectedBranch(branchesData[0].id);
      }

      setLoading(false);
    };
    fetchData();
    searchRef.current?.focus();
  }, [isBranchUser, initialBranchId]);

  // ── 고객 검색 ─────────────────────────────────────────────────────────────
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
      setShowQuickReg(false);
    }
  }, [customerSearch, customers]);

  // ── 수량 편집 포커스 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (editingQtyId) editingQtyRef.current?.focus();
  }, [editingQtyId]);

  // ── 할인 편집 포커스 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (editingDiscountId) editingDiscountRef.current?.focus();
  }, [editingDiscountId]);

  // ── 제품 필터 ─────────────────────────────────────────────────────────────
  const filteredProducts = products.filter(p =>
    p.name.includes(search) || p.code.includes(search)
  );

  const getStock = useCallback((productId: string) =>
    inventoryMap.get(`${selectedBranch}_${productId}`) ?? null,
  [inventoryMap, selectedBranch]);

  // ── 장바구니 ──────────────────────────────────────────────────────────────
  const addToCart = (product: any) => {
    const stock = getStock(product.id);
    const inCartQty = cart.find(i => i.productId === product.id)?.quantity ?? 0;
    if (stock !== null && inCartQty + 1 > stock) {
      alert(`"${product.name}" 재고 부족 (현재 ${stock}개)`);
      return;
    }
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { productId: product.id, name: product.name, price: product.price, quantity: 1, discount: 0, barcode: product.barcode }];
    });
    setSearch('');
    searchRef.current?.focus();
  };

  const removeFromCart = (productId: string) => setCart(prev => prev.filter(i => i.productId !== productId));

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) { removeFromCart(productId); return; }
    const stock = getStock(productId);
    if (stock !== null && quantity > stock) {
      alert(`재고 부족 (현재 ${stock}개)`);
      return;
    }
    setCart(prev => prev.map(item => item.productId === productId ? { ...item, quantity } : item));
  };

  // ── 통합 검색 (바코드 + 이름/코드) ────────────────────────────────────────
  const handleSearchEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !search.trim()) return;
    const trimmed = search.trim();
    // 정확히 일치하면 즉시 담기 (바코드 스캔)
    const exact = productMap.get(trimmed);
    if (exact) { addToCart(exact); return; }
    // 검색 결과가 1개면 담기
    if (filteredProducts.length === 1) { addToCart(filteredProducts[0]); return; }
    if (filteredProducts.length === 0) alert(`"${trimmed}" 해당 제품이 없습니다.`);
  };

  // ── 고객 선택 ─────────────────────────────────────────────────────────────
  const selectCustomer = async (customer: Customer) => {
    const supabase = createClient();
    const { data: lastHistory } = await supabase
      .from('point_history').select('balance')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle() as any;

    setSelectedCustomer({ ...customer, currentPoints: lastHistory?.balance || 0 });
    setCustomerSearch('');
    setCustomerResults([]);
    setShowCustomerDropdown(false);
    setShowQuickReg(false);
    setUsePoints(false);
    setPointsToUse(0);
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerSearch('');
    setCustomerResults([]);
    setShowCustomerDropdown(false);
    setShowQuickReg(false);
    setUsePoints(false);
    setPointsToUse(0);
    customerInputRef.current?.focus();
  };

  // ── 빠른 고객 등록 ─────────────────────────────────────────────────────────
  const handleQuickRegister = async () => {
    if (!quickName.trim() || !quickPhone.trim()) return;
    setQuickRegLoading(true);
    const supabase = createClient();
    const { data, error } = await (supabase as any).from('customers').insert({
      name: quickName.trim(),
      phone: quickPhone.trim(),
      grade: 'NORMAL',
      is_active: true,
      primary_branch_id: selectedBranch || null,
    }).select('id, name, phone, grade').single();

    if (error) {
      alert(`등록 실패: ${error.message}`);
      setQuickRegLoading(false);
      return;
    }
    // 고객 목록에 추가
    const newCustomer = { ...(data as any), grade_point_rate: 1.0 };
    setCustomers(prev => [...prev, newCustomer]);
    await selectCustomer(newCustomer);
    setQuickName('');
    setQuickPhone('');
    setQuickRegLoading(false);
  };

  // ── 품목 할인 ──────────────────────────────────────────────────────────────
  const updateDiscount = (productId: string, discount: number) => {
    setCart(prev => prev.map(item =>
      item.productId === productId ? { ...item, discount: Math.max(0, Math.min(discount, item.price * item.quantity)) } : item
    ));
  };

  const commitDiscountEdit = (productId: string) => {
    const raw = parseInt(editingDiscountVal.replace(/,/g, '')) || 0;
    const item = cart.find(i => i.productId === productId);
    const itemTotal = item ? item.price * item.quantity : 0;
    const val = editingDiscountType === 'percent'
      ? Math.round(itemTotal * Math.min(raw, 100) / 100)
      : raw;
    updateDiscount(productId, val);
    setEditingDiscountId(null);
    setEditingDiscountVal('');
    setEditingDiscountType('amount');
  };

  // ── 금액 계산 ──────────────────────────────────────────────────────────────
  const itemDiscountTotal = cart.reduce((sum, item) => sum + (item.discount || 0), 0);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const subtotal = total - itemDiscountTotal;
  const discountRaw = parseInt(discountInput.replace(/,/g, '')) || 0;
  const discountAmount = discountType === 'percent'
    ? Math.round(subtotal * Math.min(discountRaw, 100) / 100)
    : Math.min(discountRaw, subtotal);
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const finalAmount = usePoints && selectedCustomer
    ? Math.max(0, afterDiscount - pointsToUse)
    : afterDiscount;
  const cashReceivedNum = parseInt(cashReceived.replace(/,/g, '')) || 0;
  const change = paymentMethod === 'cash' && cashReceivedNum > 0 ? cashReceivedNum - finalAmount : 0;

  // ── 카드 단말기 승인 요청 ──────────────────────────────────────────────────
  const handleCardApproval = async () => {
    if (cart.length === 0 || !selectedBranch) return;
    setCardApprovalState('waiting');
    setCardApprovalError('');

    const taxAmount = Math.round(finalAmount * 10 / 110);
    const result = await requestCardApproval(finalAmount, taxAmount);

    if (!result.success) {
      setCardApprovalState('error');
      setCardApprovalError(result.errorMessage || '승인 실패');
      return;
    }

    const cardInfo = [
      result.cardName,
      result.cardLast4 ? `*${result.cardLast4}` : undefined,
      result.installment && result.installment !== '00' ? `${parseInt(result.installment)}개월` : '일시불',
    ].filter(Boolean).join(' ');

    setCardApprovalResult({ approvalNo: result.approvalNo, cardInfo });
    setCardApprovalState('approved');
  };

  // ── 결제 처리 ─────────────────────────────────────────────────────────────
  const handlePayment = async () => {
    if (cart.length === 0) return;
    if (!selectedBranch) { alert('지점을 선택해주세요.'); return; }
    if (paymentMethod === 'credit' && !selectedCustomer) {
      alert('외상 결제는 고객을 먼저 선택해야 합니다.\n누가 외상했는지 기록되어야 합니다.');
      return;
    }
    if (paymentMethod === 'cash' && cashReceivedNum > 0 && cashReceivedNum < finalAmount) {
      alert(`받은 금액(${cashReceivedNum.toLocaleString()}원)이 결제 금액(${finalAmount.toLocaleString()}원)보다 적습니다.`);
      return;
    }

    setProcessing(true);
    const selectedBranchData = branches.find(b => b.id === selectedBranch);

    try {
      const result = await processPosCheckout({
        branchId: selectedBranch,
        branchCode: selectedBranchData?.code || 'ETC',
        branchName: selectedBranchData?.name || '',
        branchChannel: selectedBranchData?.channel || 'STORE',
        customerId: selectedCustomer?.id || null,
        gradePointRate: selectedCustomer?.grade_point_rate || 1.0,
        cart,
        totalAmount: total,
        discountAmount: itemDiscountTotal + discountAmount + (usePoints ? pointsToUse : 0),
        finalAmount,
        paymentMethod,
        usePoints,
        pointsToUse,
        cashReceived: cashReceivedNum > 0 ? cashReceivedNum : undefined,
        userId: getCookie('user_id'),
        approvalNo: cardApprovalResult?.approvalNo,
        cardInfo: cardApprovalResult?.cardInfo,
      });

      if (result.error) {
        alert(result.error);
        setProcessing(false);
        return;
      }

      const { orderNumber, pointsEarned, stockUpdates } = result;

      // 로컬 재고 맵 즉시 업데이트
      if (stockUpdates) {
        for (const [productId, newQty] of Object.entries(stockUpdates)) {
          const key = `${selectedBranch}_${productId}`;
          setInventoryMap(prev => new Map(prev).set(key, newQty));
        }
      }

      // 영수증 표시
      setReceiptData({
        orderNumber: orderNumber!, branchName: selectedBranchData?.name || '',
        customerName: selectedCustomer?.name,
        items: cart.map(item => ({ name: item.name, quantity: item.quantity, unitPrice: item.price, totalPrice: item.price * item.quantity - (item.discount || 0), discount: item.discount || 0 })),
        totalAmount: total, discountAmount: itemDiscountTotal + discountAmount + (usePoints ? pointsToUse : 0),
        finalAmount, pointsUsed: usePoints ? pointsToUse : 0, pointsEarned: pointsEarned || 0,
        paymentMethod, cashReceived: paymentMethod === 'cash' && cashReceivedNum > 0 ? cashReceivedNum : undefined,
        change: paymentMethod === 'cash' && change > 0 ? change : undefined,
        approvalNo: cardApprovalResult?.approvalNo,
        cardInfo: cardApprovalResult?.cardInfo,
        orderedAt: new Date().toISOString(),
      });

      setCart([]);
      setSelectedCustomer(null);
      setCustomerSearch('');
      setUsePoints(false);
      setPointsToUse(0);
      setDiscountInput('');
      setCashReceived('');
      setCardApprovalState('idle');
      setCardApprovalResult(null);
      setCardApprovalError('');

    } catch (err: any) {
      console.error('결제 오류:', err);
      alert(`결제 처리 중 오류가 발생했습니다.\n\n${err?.message || JSON.stringify(err)}`);
    }

    setProcessing(false);
  };

  // ── 수량 직접 입력 커밋 ────────────────────────────────────────────────────
  const commitQtyEdit = (productId: string) => {
    const val = parseInt(editingQtyVal);
    if (!isNaN(val)) updateQuantity(productId, val);
    setEditingQtyId(null);
    setEditingQtyVal('');
  };

  // ── 렌더링 ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col sm:flex-row gap-4 sm:h-[calc(100vh-8rem)]">
      {/* 왼쪽: 제품 검색 + 그리드 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 통합 검색 */}
        <div className="mb-3">
          <input
            ref={searchRef}
            type="text"
            placeholder="제품명, 코드 검색 또는 바코드 스캔 후 Enter"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchEnter}
            className="input w-full text-sm"
            autoComplete="off"
          />
          {search && (
            <p className="text-xs text-slate-400 mt-1 pl-1">
              {filteredProducts.length}개 · Enter키로 첫 번째 항목 담기
            </p>
          )}
        </div>

        {/* 제품 그리드 */}
        <div className="flex-1 overflow-auto pb-24 sm:pb-0">
          {loading ? (
            <p className="text-center text-slate-400 py-8">로딩 중...</p>
          ) : filteredProducts.length === 0 && search ? (
            <p className="text-center text-slate-400 py-8">검색 결과가 없습니다</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredProducts.map(product => {
                const stock = getStock(product.id);
                const inCart = cart.find(i => i.productId === product.id)?.quantity ?? 0;
                const isOutOfStock = stock !== null && stock === 0;
                const isLow = stock !== null && stock > 0 && stock < 10;
                return (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    disabled={isOutOfStock}
                    className={`bg-white p-3 rounded-lg shadow-sm text-left border transition-all ${
                      isOutOfStock
                        ? 'border-slate-100 opacity-40 cursor-not-allowed'
                        : 'border-slate-100 hover:border-blue-300 hover:shadow-md active:scale-95'
                    } ${inCart > 0 ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
                  >
                    {product.barcode && (
                      <p className="text-xs text-slate-400 font-mono mb-0.5 truncate">{product.barcode}</p>
                    )}
                    <p className="font-medium text-slate-800 text-sm leading-tight">{product.name}</p>
                    <p className="text-xs text-slate-400 mb-1.5">{product.code}</p>
                    <p className="text-base font-bold text-blue-600">{product.price.toLocaleString()}원</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-xs ${
                        isOutOfStock ? 'text-red-500 font-semibold' :
                        isLow ? 'text-orange-500' : 'text-slate-400'
                      }`}>
                        {stock === null ? '' : isOutOfStock ? '품절' : `재고 ${stock}`}
                      </span>
                      {inCart > 0 && (
                        <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{inCart}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 모바일 장바구니 토글 버튼 (하단 고정) */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-30 p-3 bg-white border-t shadow-lg">
        <button
          onClick={() => setCartOpen(prev => !prev)}
          className="w-full btn-primary min-h-12 text-base font-semibold flex items-center justify-between px-4"
        >
          <span>🛒 장바구니 {cart.length > 0 ? `(${cart.length}종)` : ''}</span>
          <span>{cart.length > 0 ? `${total.toLocaleString()}원 →` : '비어있음'}</span>
        </button>
      </div>

      {/* 모바일 장바구니 드로어 backdrop */}
      {cartOpen && (
        <div
          className="sm:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setCartOpen(false)}
        />
      )}

      {/* 오른쪽: 장바구니 + 결제 */}
      <div className={`
        sm:w-[400px] sm:static sm:flex sm:flex-col sm:shrink-0
        fixed bottom-0 left-0 right-0 z-50 flex flex-col
        bg-white rounded-t-2xl sm:rounded-lg shadow
        transition-transform duration-300 ease-in-out
        ${cartOpen ? 'translate-y-0' : 'translate-y-full sm:translate-y-0'}
        max-h-[90vh] sm:max-h-none sm:h-full
      `}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold">장바구니 {cart.length > 0 && <span className="text-sm font-normal text-slate-500">({cart.length}종)</span>}</h3>
          <div className="flex items-center gap-3">
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-red-400 hover:text-red-600">전체 삭제</button>
            )}
            <button onClick={() => setCartOpen(false)} className="sm:hidden text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* 장바구니 목록 */}
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {cart.map(item => (
            <div key={item.productId} className="p-2.5 bg-slate-50 rounded-lg space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {item.price.toLocaleString()}원 × {item.quantity}
                    {item.discount > 0 && <span className="text-orange-500"> -할인 {item.discount.toLocaleString()}원</span>}
                    {' = '}<strong className={item.discount > 0 ? 'text-orange-600' : ''}>{(item.price * item.quantity - item.discount).toLocaleString()}원</strong>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => updateQuantity(item.productId, item.quantity - 1)} className="w-7 h-7 bg-slate-200 rounded text-sm hover:bg-slate-300">-</button>
                  {editingQtyId === item.productId ? (
                    <input
                      ref={editingQtyRef}
                      type="number"
                      value={editingQtyVal}
                      onChange={e => setEditingQtyVal(e.target.value)}
                      onBlur={() => commitQtyEdit(item.productId)}
                      onKeyDown={e => { if (e.key === 'Enter') commitQtyEdit(item.productId); if (e.key === 'Escape') { setEditingQtyId(null); setEditingQtyVal(''); } }}
                      className="w-12 text-center border border-blue-400 rounded text-sm px-1 py-0.5"
                      min="1"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingQtyId(item.productId); setEditingQtyVal(String(item.quantity)); }}
                      title="클릭하여 수량 직접 입력"
                      className="w-8 text-center font-semibold text-sm hover:bg-blue-50 rounded py-0.5"
                    >
                      {item.quantity}
                    </button>
                  )}
                  <button onClick={() => updateQuantity(item.productId, item.quantity + 1)} className="w-7 h-7 bg-slate-200 rounded text-sm hover:bg-slate-300">+</button>
                  <button onClick={() => removeFromCart(item.productId)} className="w-7 h-7 bg-red-100 text-red-500 rounded text-xs hover:bg-red-200">✕</button>
                </div>
              </div>
              {/* 품목 할인 */}
              <div className="flex items-center gap-1.5">
                {editingDiscountId === item.productId ? (
                  <>
                    <div className="flex rounded overflow-hidden border border-orange-300 shrink-0">
                      <button
                        onMouseDown={e => { e.preventDefault(); setEditingDiscountType('amount'); setEditingDiscountVal(''); }}
                        className={`px-2 py-0.5 text-xs font-medium transition-colors ${editingDiscountType === 'amount' ? 'bg-orange-500 text-white' : 'bg-white text-slate-500 hover:bg-orange-50'}`}
                      >원</button>
                      <button
                        onMouseDown={e => { e.preventDefault(); setEditingDiscountType('percent'); setEditingDiscountVal(''); }}
                        className={`px-2 py-0.5 text-xs font-medium transition-colors ${editingDiscountType === 'percent' ? 'bg-orange-500 text-white' : 'bg-white text-slate-500 hover:bg-orange-50'}`}
                      >%</button>
                    </div>
                    <input
                      ref={editingDiscountRef}
                      type="text"
                      inputMode="numeric"
                      value={editingDiscountVal}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        if (editingDiscountType === 'percent') {
                          setEditingDiscountVal(raw ? String(Math.min(parseInt(raw), 100)) : '');
                        } else {
                          setEditingDiscountVal(raw ? parseInt(raw).toLocaleString() : '');
                        }
                      }}
                      onBlur={() => commitDiscountEdit(item.productId)}
                      onKeyDown={e => { if (e.key === 'Enter') commitDiscountEdit(item.productId); if (e.key === 'Escape') { setEditingDiscountId(null); setEditingDiscountVal(''); setEditingDiscountType('amount'); } }}
                      placeholder={editingDiscountType === 'percent' ? '0%' : '0원'}
                      className="flex-1 border border-orange-400 rounded text-xs px-2 py-1 text-right min-w-0"
                    />
                    {editingDiscountType === 'percent' && editingDiscountVal && (
                      <span className="text-xs text-orange-500 whitespace-nowrap">
                        -{Math.round(item.price * item.quantity * Math.min(parseInt(editingDiscountVal) || 0, 100) / 100).toLocaleString()}원
                      </span>
                    )}
                    <button onMouseDown={e => { e.preventDefault(); setEditingDiscountId(null); setEditingDiscountVal(''); setEditingDiscountType('amount'); }} className="text-xs text-slate-400 hover:text-slate-600 shrink-0">취소</button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setEditingQtyId(null);
                      setEditingDiscountId(item.productId);
                      setEditingDiscountVal(item.discount > 0 ? item.discount.toLocaleString() : '');
                    }}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      item.discount > 0
                        ? 'border-orange-300 bg-orange-50 text-orange-600 hover:bg-orange-100'
                        : 'border-slate-200 text-slate-400 hover:border-orange-300 hover:text-orange-500'
                    }`}
                  >
                    {item.discount > 0 ? `할인 -${item.discount.toLocaleString()}원 ✎` : '할인 적용'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {cart.length === 0 && (
            <p className="text-center text-slate-400 py-8 text-sm">제품을 선택해주세요</p>
          )}
        </div>

        {/* 결제 영역 */}
        <div className="p-4 border-t space-y-3">
          {/* 지점 선택 */}
          <select
            value={selectedBranch}
            onChange={e => setSelectedBranch(e.target.value)}
            disabled={isBranchUser}
            className={`input text-sm ${isBranchUser ? 'bg-slate-100 cursor-not-allowed' : ''}`}
          >
            <option value="">지점 선택</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          {/* 할인 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 whitespace-nowrap">할인</span>
            <div className="flex rounded-md overflow-hidden border border-slate-200 shrink-0">
              <button
                onClick={() => { setDiscountType('amount'); setDiscountInput(''); }}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${discountType === 'amount' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >원</button>
              <button
                onClick={() => { setDiscountType('percent'); setDiscountInput(''); }}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${discountType === 'percent' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >%</button>
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={discountInput}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9]/g, '');
                if (discountType === 'percent') {
                  setDiscountInput(raw ? String(Math.min(parseInt(raw), 100)) : '');
                } else {
                  setDiscountInput(raw ? parseInt(raw).toLocaleString() : '');
                }
              }}
              onFocus={e => e.target.select()}
              placeholder={discountType === 'percent' ? '0%' : '0원'}
              className="input text-right text-sm flex-1 min-w-0"
            />
            {discountInput && (
              <button onClick={() => setDiscountInput('')} className="text-slate-400 hover:text-slate-600 text-sm shrink-0">✕</button>
            )}
          </div>

          {/* 고객 */}
          <div className="relative">
            {selectedCustomer ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 bg-blue-50 rounded-lg border border-blue-200">
                  <div>
                    <p className="font-medium text-blue-800 text-sm">{selectedCustomer.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`px-1.5 py-0.5 text-xs rounded ${GRADE_BADGE[selectedCustomer.grade]}`}>
                        {GRADE_LABELS[selectedCustomer.grade]}
                      </span>
                      <span className="text-xs text-green-600 font-medium">
                        {selectedCustomer.currentPoints?.toLocaleString() || 0}P 보유
                      </span>
                    </div>
                  </div>
                  <button onClick={clearCustomer} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
                </div>
                {selectedCustomer.currentPoints && selectedCustomer.currentPoints > 0 && (
                  <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-200">
                    <input
                      type="checkbox" id="usePoints" checked={usePoints}
                      onChange={e => {
                        setUsePoints(e.target.checked);
                        setPointsToUse(e.target.checked ? Math.min(selectedCustomer.currentPoints || 0, afterDiscount) : 0);
                      }}
                      className="w-4 h-4"
                    />
                    <label htmlFor="usePoints" className="text-xs text-green-700 flex-1 cursor-pointer">
                      포인트 사용 (보유 {selectedCustomer.currentPoints.toLocaleString()}P)
                    </label>
                    {usePoints && (
                      <input
                        type="number"
                        value={pointsToUse}
                        onChange={e => setPointsToUse(Math.min(parseInt(e.target.value) || 0, Math.min(selectedCustomer.currentPoints || 0, afterDiscount)))}
                        onFocus={e => e.target.select()}
                        className="input w-20 text-right text-xs py-1"
                        min="0" max={Math.min(selectedCustomer.currentPoints || 0, afterDiscount)}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <input
                  ref={customerInputRef}
                  type="text"
                  placeholder="고객 검색 (이름 / 전화번호)"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  onFocus={() => customerSearch.length >= 1 && setShowCustomerDropdown(true)}
                  onBlur={() => setTimeout(() => { setShowCustomerDropdown(false); setShowQuickReg(false); }, 200)}
                  className="input text-sm"
                />
                {showCustomerDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-auto">
                    {customerResults.map(c => (
                      <button
                        key={c.id} onMouseDown={() => selectCustomer(c)}
                        className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-b-0"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm">{c.name}</p>
                            <p className="text-xs text-slate-500">{c.phone}</p>
                          </div>
                          <span className={`px-1.5 py-0.5 text-xs rounded ${GRADE_BADGE[c.grade]}`}>
                            {GRADE_LABELS[c.grade]}
                          </span>
                        </div>
                      </button>
                    ))}
                    {/* 신규 등록 */}
                    {!showQuickReg ? (
                      <button
                        onMouseDown={e => { e.preventDefault(); setShowQuickReg(true); }}
                        className="w-full text-left px-3 py-2.5 text-blue-600 hover:bg-blue-50 text-sm border-t border-slate-100 font-medium"
                      >
                        + 신규 고객 등록
                      </button>
                    ) : (
                      <div className="p-3 border-t border-slate-100 space-y-2">
                        <p className="text-xs font-semibold text-slate-600">빠른 고객 등록</p>
                        <input
                          type="text" placeholder="이름 *" value={quickName}
                          onChange={e => setQuickName(e.target.value)}
                          onMouseDown={e => e.stopPropagation()}
                          className="input text-sm"
                          autoFocus
                        />
                        <input
                          type="text" placeholder="전화번호 * (010-XXXX-XXXX)" value={quickPhone}
                          onChange={e => setQuickPhone(e.target.value)}
                          onMouseDown={e => e.stopPropagation()}
                          onKeyDown={e => e.key === 'Enter' && handleQuickRegister()}
                          className="input text-sm"
                        />
                        <div className="flex gap-2">
                          <button
                            onMouseDown={e => { e.preventDefault(); handleQuickRegister(); }}
                            disabled={!quickName.trim() || !quickPhone.trim() || quickRegLoading}
                            className="flex-1 btn-primary py-1.5 text-sm disabled:opacity-50"
                          >
                            {quickRegLoading ? '등록 중...' : '등록 후 선택'}
                          </button>
                          <button
                            onMouseDown={e => { e.preventDefault(); setShowQuickReg(false); }}
                            className="flex-1 btn-secondary py-1.5 text-sm"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}
                    {customerResults.length === 0 && !showQuickReg && (
                      <p className="px-3 py-2 text-xs text-slate-400 text-center">검색 결과 없음</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 금액 요약 */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>소계</span><span>{total.toLocaleString()}원</span>
            </div>
            {itemDiscountTotal > 0 && (
              <div className="flex justify-between text-orange-500">
                <span>품목 할인</span>
                <span>-{itemDiscountTotal.toLocaleString()}원</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-red-500">
                <span>추가 할인 {discountType === 'percent' ? `(${Math.min(parseInt(discountInput) || 0, 100)}%)` : ''}</span>
                <span>-{discountAmount.toLocaleString()}원</span>
              </div>
            )}
            {usePoints && pointsToUse > 0 && (
              <div className="flex justify-between text-green-600">
                <span>포인트 할인</span><span>-{pointsToUse.toLocaleString()}P</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-1 border-t">
              <span>결제 금액</span>
              <span className={(discountAmount > 0 || (usePoints && pointsToUse > 0)) ? 'text-red-600' : ''}>{finalAmount.toLocaleString()}원</span>
            </div>
          </div>

          {/* 결제 수단 */}
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { id: 'cash', label: '현금' },
              { id: 'card', label: '카드' },
              { id: 'card_keyin', label: '카드(키인)' },
              { id: 'kakao', label: '카카오' },
              { id: 'credit', label: '외상' },
            ] as const).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => { setPaymentMethod(id); setCashReceived(''); setCardApprovalState('idle'); setCardApprovalResult(null); setCardApprovalError(''); }}
                className={`py-2 rounded-md text-sm font-medium transition-colors ${
                  paymentMethod === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 현금 거스름돈 */}
          {paymentMethod === 'cash' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 whitespace-nowrap w-16">받은 금액</label>
                <input
                  type="text"
                  placeholder="0"
                  value={cashReceived}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setCashReceived(raw ? parseInt(raw).toLocaleString() : '');
                  }}
                  className="input text-right text-sm flex-1"
                />
                <span className="text-xs text-slate-400">원</span>
              </div>
              {/* 빠른 입력 버튼 */}
              <div className="flex gap-1 flex-wrap">
                {[10000, 50000, 100000].map(v => (
                  <button
                    key={v}
                    onClick={() => setCashReceived(v.toLocaleString())}
                    className="px-2 py-1 text-xs bg-slate-100 rounded hover:bg-blue-50 hover:text-blue-700"
                  >
                    {(v / 10000)}만
                  </button>
                ))}
                <button
                  onClick={() => setCashReceived(Math.ceil(finalAmount / 10000) * 10000 === finalAmount ? finalAmount.toLocaleString() : (Math.ceil(finalAmount / 10000) * 10000).toLocaleString())}
                  className="px-2 py-1 text-xs bg-slate-100 rounded hover:bg-blue-50 hover:text-blue-700"
                >
                  딱맞게
                </button>
              </div>
              {cashReceivedNum > 0 && (
                <div className={`flex justify-between text-sm font-semibold px-1 ${change >= 0 ? 'text-blue-700' : 'text-red-500'}`}>
                  <span>거스름돈</span>
                  <span>{change >= 0 ? change.toLocaleString() : `부족 ${Math.abs(change).toLocaleString()}`}원</span>
                </div>
              )}
            </div>
          )}

          {/* 결제 버튼 — 카드(단말기): 승인 → 결제완료 2단계 / 나머지: 즉시 결제 */}
          {paymentMethod === 'card' ? (
            <div className="space-y-2">
              {/* 카드 승인 상태 표시 */}
              {cardApprovalState === 'waiting' && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm text-blue-700">
                  <span className="animate-spin">⏳</span>
                  <span>단말기에서 카드를 읽어주세요...</span>
                </div>
              )}
              {cardApprovalState === 'approved' && cardApprovalResult && (
                <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-sm space-y-0.5">
                  <p className="font-semibold text-green-700">승인 완료</p>
                  {cardApprovalResult.cardInfo && <p className="text-green-600">{cardApprovalResult.cardInfo}</p>}
                  {cardApprovalResult.approvalNo && <p className="text-xs text-slate-500">승인번호: {cardApprovalResult.approvalNo}</p>}
                </div>
              )}
              {cardApprovalState === 'error' && (
                <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-600">
                  {cardApprovalError}
                </div>
              )}

              {cardApprovalState !== 'approved' ? (
                <div className="space-y-1">
                  {isUsingMock() && (
                    <p className="text-center text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded py-1">
                      테스트 모드 — 가상 단말기 응답 (2초 후 자동 승인)
                    </p>
                  )}
                  <button
                    onClick={handleCardApproval}
                    disabled={cart.length === 0 || !selectedBranch || cardApprovalState === 'waiting'}
                    className="w-full btn-primary py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cardApprovalState === 'waiting' ? '승인 대기 중...' : `카드 승인 요청 (${finalAmount.toLocaleString()}원)`}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handlePayment}
                  disabled={processing}
                  className="w-full py-3 text-base font-semibold rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                >
                  {processing ? '처리 중...' : '결제 완료'}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handlePayment}
              disabled={cart.length === 0 || !selectedBranch || processing || (paymentMethod === 'cash' && cashReceivedNum > 0 && change < 0)}
              className="w-full btn-primary py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? '처리 중...' : `결제 (${finalAmount.toLocaleString()}원)`}
            </button>
          )}
          <button
            onClick={() => setShowRefundModal(true)}
            className="w-full py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50"
          >
            환불 처리
          </button>
        </div>
      </div>

      {showRefundModal && (
        <RefundModal
          branchId={selectedBranch}
          onClose={() => setShowRefundModal(false)}
          onSuccess={(returnNumber) => {
            setShowRefundModal(false);
            alert(`환불 완료\n환불번호: ${returnNumber}`);
          }}
        />
      )}

      {receiptData && (
        <ReceiptModal
          {...receiptData}
          onClose={() => {
            setReceiptData(null);
            searchRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
