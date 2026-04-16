'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { processPosCheckout, createCustomer } from '@/lib/actions';
import ReceiptModal from './ReceiptModal';

const SalesListTab = dynamic(() => import('./SalesListTab'), {
  ssr: false,
  loading: () => <div className="py-10 text-center text-slate-400">로딩 중...</div>,
});

type MainTab = 'checkout' | 'list';

declare global {
  interface Window {
    daum: any;
  }
}

type PaymentMethodId = 'cash' | 'card' | 'card_keyin' | 'kakao' | 'credit' | 'cod';
const PAYMENT_METHOD_LABEL: Record<PaymentMethodId, string> = {
  cash: '현금', card: '카드', card_keyin: '카드(키인)', kakao: '카카오',
  credit: '외상', cod: '수령시수금',
};

interface PaymentRow {
  method: PaymentMethodId;
  amount: number;
  approvalNo?: string;
  cardInfo?: string;
}

interface ShippingForm {
  enabled: boolean;
  recipient_name: string;
  recipient_phone: string;
  recipient_zipcode: string;
  recipient_address: string;        // 도로명/지번
  recipient_address_detail: string; // 상세
  delivery_message: string;
  senderSameAsBuyer: boolean;
  sender_name: string;
  sender_phone: string;
  sender_zipcode: string;
  sender_address: string;
  sender_address_detail: string;
}

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
  const [receiptData, setReceiptData] = useState<any>(null);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyVal, setEditingQtyVal] = useState('');
  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);
  const [editingDiscountVal, setEditingDiscountVal] = useState('');
  const [editingDiscountType, setEditingDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState('');
  // 고객 상세 추가 모달
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  // 고객 선택 시 로드되는 상담·구매 요약
  const [customerSummary, setCustomerSummary] = useState<{
    loading: boolean;
    consultations: any[];
    orders: any[];
    totalLtv: number;
  }>({ loading: false, consultations: [], orders: [], totalLtv: 0 });
  // 이력 접힘 상태 (고객 바뀌면 펼침으로 리셋)
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  // 주문 메모
  const [orderMemo, setOrderMemo] = useState('');
  // 택배
  const [shipping, setShipping] = useState<ShippingForm>({
    enabled: false,
    recipient_name: '', recipient_phone: '',
    recipient_zipcode: '', recipient_address: '', recipient_address_detail: '',
    delivery_message: '',
    senderSameAsBuyer: true,
    sender_name: '', sender_phone: '',
    sender_zipcode: '', sender_address: '', sender_address_detail: '',
  });
  // 출고 지점 (택배 활성 시. 기본 = 판매 지점)
  const [shipFromBranchId, setShipFromBranchId] = useState<string>('');

  // Daum postcode script (한 번 로드)
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.daum) {
      const script = document.createElement('script');
      script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      document.head.appendChild(script);
    }
  }, []);

  const openPostcode = (target: 'recipient' | 'sender') => {
    if (typeof window === 'undefined' || !window.daum) {
      alert('주소 검색 스크립트 로딩 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    new window.daum.Postcode({
      oncomplete: (data: any) => {
        const road = data.roadAddress || data.jibunAddress || '';
        const zip = data.zonecode || '';
        setShipping(prev => target === 'recipient'
          ? { ...prev, recipient_zipcode: zip, recipient_address: road, recipient_address_detail: '' }
          : { ...prev, sender_zipcode: zip, sender_address: road, sender_address_detail: '' });
      },
    }).open();
  };
  // 분할 결제
  const [splitMode, setSplitMode] = useState(false);
  const [extraPayments, setExtraPayments] = useState<PaymentRow[]>([]);

  const [cartOpen, setCartOpen] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>('checkout');

  const searchRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const editingQtyRef = useRef<HTMLInputElement>(null);
  const editingDiscountRef = useRef<HTMLInputElement>(null);

  const initialRole = getCookie('user_role');
  const initialBranchId = getCookie('user_branch_id');
  const [selectedBranch, setSelectedBranch] = useState<string>(initialBranchId || '');
  const [userRole] = useState<string | null>(initialRole);

  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  // 백화점 모드: 선택된 지점이 DEPT_STORE인 경우 결제 UI 최적화
  const selectedBranchData = branches.find(b => b.id === selectedBranch);
  const isDeptStore = selectedBranchData?.channel === 'DEPT_STORE';

  // 백화점 수기입력용 상태
  const [deptApprovalNo, setDeptApprovalNo] = useState('');
  const [deptCardCompany, setDeptCardCompany] = useState('');
  const [deptInstallment, setDeptInstallment] = useState('0');
  const [deptMemo, setDeptMemo] = useState('');
  const [deptShowDetail, setDeptShowDetail] = useState(false);

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

      // 출고 지점 기본 = 판매 지점 (사용자가 택배 활성 시 변경 가능)
      if (isBranchUser && initialBranchId) {
        setShipFromBranchId(initialBranchId);
      } else if (branchesData.length > 0) {
        setShipFromBranchId(branchesData[0].id);
      }

      setLoading(false);
    };
    fetchData();
    searchRef.current?.focus();
  }, [isBranchUser, initialBranchId]);

  // 택배 미활성 상태에서 판매 지점 변경 시 출고 지점도 동기화
  useEffect(() => {
    if (!shipping.enabled && selectedBranch) {
      setShipFromBranchId(selectedBranch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch]);

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
    const supabase = createClient() as any;
    const { data: lastHistory } = await supabase
      .from('point_history').select('balance')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    setSelectedCustomer({ ...customer, currentPoints: lastHistory?.balance || 0 });
    setCustomerSearch('');
    setCustomerResults([]);
    setShowCustomerDropdown(false);
    setUsePoints(false);
    setPointsToUse(0);
    setHistoryCollapsed(false);

    // 택배 sender가 "구매자와 동일"이면 구매자 정보로 프리필
    setShipping(prev => prev.senderSameAsBuyer
      ? { ...prev, sender_name: customer.name, sender_phone: customer.phone }
      : prev);

    // 상담·구매 이력 요약 로드
    setCustomerSummary(prev => ({ ...prev, loading: true }));
    try {
      const [consultRes, ordersRes] = await Promise.all([
        supabase
          .from('customer_consultations')
          .select('id, consultation_type, content, created_at')
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('sales_orders')
          .select('id, order_number, total_amount, ordered_at, status, branch:branches(name), items:sales_order_items(quantity, product:products(name))')
          .eq('customer_id', customer.id)
          .order('ordered_at', { ascending: false })
          .limit(3),
      ]);
      const orders = (ordersRes.data || []) as any[];
      const totalLtv = orders
        .filter(o => !['CANCELLED', 'REFUNDED'].includes(o.status))
        .reduce((s: number, o: any) => s + (o.total_amount || 0), 0);
      setCustomerSummary({
        loading: false,
        consultations: (consultRes.data as any[]) || [],
        orders,
        totalLtv,
      });
    } catch {
      setCustomerSummary({ loading: false, consultations: [], orders: [], totalLtv: 0 });
    }
  };

  // ── 상세 고객 추가 → 저장 후 자동 선택 ──────────────────────────────────────
  const handleCustomerCreated = async (phone: string) => {
    // 방금 만들어진 고객을 customers 리스트에 반영하고 자동 선택
    const supabase = createClient() as any;
    const { data: grades } = await supabase.from('customer_grades').select('code, point_rate');
    const gMap = new Map((grades || []).map((g: any) => [g.code, parseFloat(g.point_rate) || 1.0]));
    const normPhone = phone.replace(/-/g, '');
    const { data: newCust } = await supabase
      .from('customers')
      .select('id, name, phone, grade')
      .order('created_at', { ascending: false })
      .limit(50);
    const match = ((newCust as any[]) || []).find(c => (c.phone || '').replace(/-/g, '') === normPhone) || (newCust as any[])?.[0];
    if (match) {
      const enriched: Customer = { ...match, grade_point_rate: gMap.get(match.grade) || 1.0 };
      setCustomers(prev => [enriched, ...prev.filter(p => p.id !== enriched.id)]);
      await selectCustomer(enriched);
    }
    setShowAddCustomerModal(false);
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerSearch('');
    setCustomerResults([]);
    setShowCustomerDropdown(false);
    setUsePoints(false);
    setPointsToUse(0);
    setCustomerSummary({ loading: false, consultations: [], orders: [], totalLtv: 0 });
    customerInputRef.current?.focus();
  };

  // (구) 빠른 고객 등록은 CustomerAddModal(상세 입력)로 대체됨

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

    // 분할 결제 splits 구성
    let paymentSplits: PaymentRow[] = [];
    if (splitMode) {
      const extraSum = extraPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const primaryAmt = Math.max(0, finalAmount - extraSum);
      if (primaryAmt > 0) {
        paymentSplits.push({
          method: paymentMethod,
          amount: primaryAmt,
          approvalNo: isDeptStore && deptApprovalNo ? deptApprovalNo : undefined,
          cardInfo: isDeptStore
            ? [deptCardCompany, deptInstallment !== '0' ? `${deptInstallment}개월` : '일시불'].filter(Boolean).join(' · ')
            : undefined,
        });
      }
      paymentSplits.push(...extraPayments.filter(p => p.amount > 0));
    }

    // 택배 정보 유효성
    const useShipping =
      shipping.enabled &&
      shipping.recipient_name.trim() &&
      shipping.recipient_phone.trim() &&
      shipping.recipient_address.trim();
    if (shipping.enabled && !useShipping) {
      alert('택배 수령인 이름·연락처·주소(검색)를 모두 입력하세요.');
      setProcessing(false);
      return;
    }

    const memoCombined = [
      orderMemo.trim(),
      isDeptStore && deptMemo.trim() ? `[백화점] ${deptMemo.trim()}` : '',
    ].filter(Boolean).join(' · ') || undefined;

    try {
      const result = await processPosCheckout({
        branchId: selectedBranch,
        branchCode: selectedBranchData?.code || 'ETC',
        branchName: selectedBranchData?.name || '',
        branchChannel: selectedBranchData?.channel || 'STORE',
        customerId: selectedCustomer?.id || null,
        customerGrade: selectedCustomer?.grade || null,
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
        approvalNo: isDeptStore && deptApprovalNo ? deptApprovalNo : undefined,
        cardInfo: isDeptStore
          ? [deptCardCompany, deptInstallment !== '0' ? `${deptInstallment}개월` : '일시불'].filter(Boolean).join(' · ')
          : undefined,
        memo: memoCombined,
        paymentSplits: paymentSplits.length > 0 ? paymentSplits.map(p => ({ method: p.method, amount: p.amount, approvalNo: p.approvalNo, cardInfo: p.cardInfo })) : undefined,
        shipFromBranchId: useShipping ? (shipFromBranchId || selectedBranch) : undefined,
        shipping: useShipping ? {
          recipient_name: shipping.recipient_name.trim(),
          recipient_phone: shipping.recipient_phone.trim(),
          recipient_zipcode: shipping.recipient_zipcode.trim() || undefined,
          recipient_address: shipping.recipient_address.trim(),
          recipient_address_detail: shipping.recipient_address_detail.trim() || undefined,
          delivery_message: shipping.delivery_message.trim() || undefined,
          sender_name: shipping.senderSameAsBuyer ? (selectedCustomer?.name || '') : shipping.sender_name.trim(),
          sender_phone: shipping.senderSameAsBuyer ? (selectedCustomer?.phone || '') : shipping.sender_phone.trim(),
          sender_zipcode: shipping.senderSameAsBuyer ? undefined : (shipping.sender_zipcode.trim() || undefined),
          sender_address: shipping.senderSameAsBuyer ? undefined : (shipping.sender_address.trim() || undefined),
          sender_address_detail: shipping.senderSameAsBuyer ? undefined : (shipping.sender_address_detail.trim() || undefined),
        } : null,
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
        approvalNo: isDeptStore && deptApprovalNo ? deptApprovalNo : undefined,
        cardInfo: isDeptStore
          ? [deptCardCompany, deptInstallment !== '0' ? `${deptInstallment}개월` : '일시불'].filter(Boolean).join(' · ')
          : undefined,
        orderedAt: new Date().toISOString(),
      });

      setCart([]);
      setSelectedCustomer(null);
      setCustomerSearch('');
      setCustomerSummary({ loading: false, consultations: [], orders: [], totalLtv: 0 });
      setUsePoints(false);
      setPointsToUse(0);
      setDiscountInput('');
      setCashReceived('');
      setOrderMemo('');
      setShipping({
        enabled: false,
        recipient_name: '', recipient_phone: '',
        recipient_zipcode: '', recipient_address: '', recipient_address_detail: '',
        delivery_message: '',
        senderSameAsBuyer: true,
        sender_name: '', sender_phone: '',
        sender_zipcode: '', sender_address: '', sender_address_detail: '',
      });
      setShipFromBranchId(selectedBranch);
      setSplitMode(false);
      setExtraPayments([]);
      // 백화점 수기입력 초기화
      setDeptApprovalNo('');
      setDeptCardCompany('');
      setDeptInstallment('0');
      setDeptMemo('');

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
    <div className="space-y-4">
      {/* 판매관리 상단 탭 */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: 'checkout' as MainTab, label: '판매 등록' },
          { key: 'list' as MainTab, label: '판매 현황' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              mainTab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === 'list' && <SalesListTab />}

      {mainTab === 'checkout' && (
    <div className="flex flex-col sm:flex-row gap-4 sm:h-[calc(100vh-12rem)]">
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
        sm:w-[440px] sm:static sm:flex sm:flex-col sm:shrink-0
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
        <div className="flex-1 overflow-auto p-3 space-y-2 min-h-[220px]">
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
                    <p className="font-medium text-blue-800 text-sm">{selectedCustomer.name}
                      <span className="text-slate-400 text-xs ml-2">{selectedCustomer.phone}</span>
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`px-1.5 py-0.5 text-xs rounded ${GRADE_BADGE[selectedCustomer.grade]}`}>
                        {GRADE_LABELS[selectedCustomer.grade]}
                      </span>
                      <span className="text-xs text-green-600 font-medium">
                        {selectedCustomer.currentPoints?.toLocaleString() || 0}P 보유
                      </span>
                      {customerSummary.totalLtv > 0 && (
                        <span className="text-xs text-slate-500">LTV {customerSummary.totalLtv.toLocaleString()}원</span>
                      )}
                    </div>
                  </div>
                  <button onClick={clearCustomer} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
                </div>

                {/* 상담·구매 히스토리 요약 — 확인 후 접어서 장바구니 공간 확보 가능 */}
                {(customerSummary.consultations.length > 0 || customerSummary.orders.length > 0) && (
                  <div className="rounded-lg border border-slate-200 bg-white text-xs">
                    <button
                      type="button"
                      onClick={() => setHistoryCollapsed(v => !v)}
                      className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 rounded-t-lg"
                    >
                      <span className="text-[10px] font-semibold text-slate-500 uppercase">
                        이력 · 상담 {customerSummary.consultations.length} / 주문 {customerSummary.orders.length}
                      </span>
                      <span className="text-slate-400 text-[10px]">{historyCollapsed ? '▸ 펼치기' : '▾ 접기'}</span>
                    </button>
                    {!historyCollapsed && (
                    <div className="px-2 pb-2 space-y-1.5 max-h-[140px] overflow-y-auto border-t border-slate-100 pt-1.5">
                    {customerSummary.consultations.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5">최근 상담 {customerSummary.consultations.length}건</p>
                        <ul className="space-y-0.5">
                          {customerSummary.consultations.map((c: any) => (
                            <li key={c.id} className="flex gap-1.5 text-slate-600">
                              <span className="text-slate-400 whitespace-nowrap">{String(c.created_at).slice(0,10)}</span>
                              <span className="text-slate-500 whitespace-nowrap">[{c.consultation_type || '기타'}]</span>
                              <span className="truncate flex-1">
                                {typeof c.content === 'string' ? c.content : (c.content?.text || '-')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {customerSummary.orders.length > 0 && (
                      <div className="pt-1 border-t border-slate-100">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5">최근 주문 {customerSummary.orders.length}건</p>
                        <ul className="space-y-0.5">
                          {customerSummary.orders.map((o: any) => {
                            const items = (o.items || []) as any[];
                            const names = items.map((i: any) => i.product?.name).filter(Boolean) as string[];
                            const head = names.slice(0, 2).join(', ');
                            const extra = names.length > 2 ? ` 외 ${names.length - 2}종` : '';
                            const label = head || '-';
                            return (
                              <li key={o.id} className="flex justify-between gap-2 text-slate-600">
                                <span className="min-w-0 flex-1">
                                  <span className="text-slate-400 mr-1.5">{String(o.ordered_at).slice(0,10)}</span>
                                  <span className="truncate" title={names.join(', ')}>
                                    {label}{extra}
                                  </span>
                                </span>
                                <span className={['CANCELLED','REFUNDED'].includes(o.status) ? 'line-through text-slate-400 whitespace-nowrap' : 'font-medium whitespace-nowrap'}>
                                  {Number(o.total_amount || 0).toLocaleString()}원
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    </div>
                    )}
                  </div>
                )}
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
                <div className="flex gap-2">
                  <input
                    ref={customerInputRef}
                    type="text"
                    placeholder="고객 검색 (이름 / 전화번호)"
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                    onFocus={() => customerSearch.length >= 1 && setShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => { setShowCustomerDropdown(false); }, 200)}
                    className="input text-sm flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddCustomerModal(true)}
                    className="px-3 py-2 text-sm rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 whitespace-nowrap"
                  >
                    + 고객 추가
                  </button>
                </div>
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
                    {customerResults.length === 0 && (
                      <div className="p-3 text-center text-xs text-slate-400">
                        검색 결과 없음 · 우측 <span className="text-blue-600 font-medium">고객 추가</span> 버튼으로 등록
                      </div>
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

          {/* 주문 메모 (전 채널) */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">주문 메모 (특이사항)</label>
            <input
              type="text"
              value={orderMemo}
              onChange={e => setOrderMemo(e.target.value)}
              placeholder="예: 알러지 있음 / 다음주 픽업 / 이벤트 할인 등"
              className="input text-sm"
            />
          </div>

          {/* 택배 섹션 */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={shipping.enabled}
                onChange={e => setShipping(prev => ({ ...prev, enabled: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-slate-700">택배 배송</span>
              <span className="text-xs text-slate-400">수령인·발신인 정보 입력</span>
            </label>
            {shipping.enabled && (
              <div className="p-3 space-y-3">
                {/* 출고 지점 */}
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1">출고 지점</p>
                  <select
                    value={shipFromBranchId}
                    onChange={e => setShipFromBranchId(e.target.value)}
                    className="input text-sm"
                  >
                    {branches.map((b: any) => (
                      <option key={b.id} value={b.id}>
                        {b.name}{b.id === selectedBranch ? ' (판매 지점)' : ''}{b.is_headquarters ? ' · 본사' : ''}
                      </option>
                    ))}
                  </select>
                  {shipFromBranchId && shipFromBranchId !== selectedBranch && (
                    <p className="text-[11px] text-amber-600 mt-1">
                      판매 지점과 다릅니다. 재고는 출고 지점에서 차감됩니다.
                    </p>
                  )}
                </div>

                {/* 수령인 */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase">수령인 (받는 분)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="이름 *" value={shipping.recipient_name}
                      onChange={e => setShipping(p => ({ ...p, recipient_name: e.target.value }))}
                      className="input text-sm" />
                    <input type="text" placeholder="연락처 *" value={shipping.recipient_phone}
                      onChange={e => setShipping(p => ({ ...p, recipient_phone: e.target.value }))}
                      className="input text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <input type="text" readOnly value={shipping.recipient_zipcode}
                      onClick={() => openPostcode('recipient')}
                      placeholder="우편번호"
                      className="input text-sm w-24 bg-slate-50 cursor-pointer" />
                    <input type="text" readOnly value={shipping.recipient_address}
                      onClick={() => openPostcode('recipient')}
                      placeholder="주소 검색 버튼을 눌러주세요 *"
                      className="input text-sm flex-1 bg-slate-50 cursor-pointer" />
                    <button type="button" onClick={() => openPostcode('recipient')}
                      className="btn-secondary text-sm whitespace-nowrap">주소 검색</button>
                  </div>
                  <input type="text" placeholder="상세 주소 (동/호수 등)"
                    value={shipping.recipient_address_detail}
                    onChange={e => setShipping(p => ({ ...p, recipient_address_detail: e.target.value }))}
                    className="input text-sm" />
                  <input type="text" placeholder="배송 메시지 (선택)" value={shipping.delivery_message}
                    onChange={e => setShipping(p => ({ ...p, delivery_message: e.target.value }))}
                    className="input text-sm" />
                </div>

                {/* 발신인 */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-2">
                    <input type="checkbox" id="sender-same"
                      checked={shipping.senderSameAsBuyer}
                      onChange={e => {
                        const same = e.target.checked;
                        setShipping(prev => ({
                          ...prev,
                          senderSameAsBuyer: same,
                          sender_name: same ? (selectedCustomer?.name || '') : prev.sender_name,
                          sender_phone: same ? (selectedCustomer?.phone || '') : prev.sender_phone,
                        }));
                      }}
                      className="w-4 h-4" />
                    <label htmlFor="sender-same" className="text-sm text-slate-700 cursor-pointer">
                      보내는 분 = 구매자와 동일
                    </label>
                  </div>
                  {!shipping.senderSameAsBuyer && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase">보내는 분</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" placeholder="이름" value={shipping.sender_name}
                          onChange={e => setShipping(p => ({ ...p, sender_name: e.target.value }))}
                          className="input text-sm" />
                        <input type="text" placeholder="연락처" value={shipping.sender_phone}
                          onChange={e => setShipping(p => ({ ...p, sender_phone: e.target.value }))}
                          className="input text-sm" />
                      </div>
                      <div className="flex gap-2">
                        <input type="text" readOnly value={shipping.sender_zipcode}
                          onClick={() => openPostcode('sender')}
                          placeholder="우편번호"
                          className="input text-sm w-24 bg-slate-50 cursor-pointer" />
                        <input type="text" readOnly value={shipping.sender_address}
                          onClick={() => openPostcode('sender')}
                          placeholder="주소 검색 버튼을 눌러주세요"
                          className="input text-sm flex-1 bg-slate-50 cursor-pointer" />
                        <button type="button" onClick={() => openPostcode('sender')}
                          className="btn-secondary text-sm whitespace-nowrap">주소 검색</button>
                      </div>
                      <input type="text" placeholder="상세 주소 (동/호수 등)"
                        value={shipping.sender_address_detail}
                        onChange={e => setShipping(p => ({ ...p, sender_address_detail: e.target.value }))}
                        className="input text-sm" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 결제 수단 — 백화점이면 간소화 */}
          {isDeptStore && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-purple-50 rounded-lg border border-purple-200">
              <span className="text-xs text-purple-700 font-medium">🏬 백화점 모드</span>
              <span className="text-xs text-purple-500">카드 결제는 백화점 단말기에서 처리</span>
            </div>
          )}
          <div className={`grid gap-1.5 ${isDeptStore ? 'grid-cols-3' : 'grid-cols-3'}`}>
            {(isDeptStore
              ? [
                  { id: 'card' as const, label: '카드 (백화점)' },
                  { id: 'cash' as const, label: '현금' },
                  { id: 'credit' as const, label: '외상' },
                ]
              : [
                  { id: 'cash' as const, label: '현금' },
                  { id: 'card' as const, label: '카드' },
                  { id: 'card_keyin' as const, label: '카드(키인)' },
                  { id: 'kakao' as const, label: '카카오' },
                  { id: 'credit' as const, label: '외상' },
                  { id: 'cod' as const, label: '수령시수금' },
                ]
            ).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => {
                  setPaymentMethod(id as any);
                  setCashReceived('');
                }}
                className={`py-2 rounded-md text-sm font-medium transition-colors ${
                  paymentMethod === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 분할 결제 / 부분 결제 */}
          <div className="rounded-lg border border-slate-200">
            <label className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 cursor-pointer border-b border-slate-200">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={splitMode}
                  onChange={e => {
                    setSplitMode(e.target.checked);
                    if (!e.target.checked) setExtraPayments([]);
                  }}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium text-slate-700">분할 / 부분 결제</span>
              </div>
              <span className="text-[11px] text-slate-400">일부 현장 결제 + 나머지 외상/다른 방식</span>
            </label>
            {splitMode && (() => {
              const extraSum = extraPayments.reduce((s, p) => s + (p.amount || 0), 0);
              const primaryAmt = Math.max(0, finalAmount - extraSum);
              return (
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">주 결제: {PAYMENT_METHOD_LABEL[paymentMethod]}</span>
                    <span className="font-semibold text-slate-700">{primaryAmt.toLocaleString()}원</span>
                  </div>
                  {extraPayments.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={p.method}
                        onChange={e => {
                          const method = e.target.value as PaymentMethodId;
                          setExtraPayments(prev => prev.map((row, i) => i === idx ? { ...row, method } : row));
                        }}
                        className="input text-xs py-1 w-28"
                      >
                        {(['cash','card','card_keyin','kakao','credit','cod'] as PaymentMethodId[]).map(m => (
                          <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={p.amount ? p.amount.toLocaleString() : ''}
                        onChange={e => {
                          const raw = parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0;
                          setExtraPayments(prev => prev.map((row, i) => i === idx ? { ...row, amount: raw } : row));
                        }}
                        placeholder="금액"
                        className="input text-sm text-right flex-1"
                      />
                      <button
                        onClick={() => setExtraPayments(prev => prev.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-600 text-lg leading-none"
                      >✕</button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExtraPayments(prev => [...prev, { method: 'credit', amount: Math.max(0, finalAmount - primaryAmt - extraSum + (primaryAmt > 0 ? primaryAmt : 0)) }])}
                      className="text-xs text-blue-600 hover:underline"
                    >+ 결제 행 추가</button>
                    {primaryAmt > 0 && (
                      <button
                        type="button"
                        onClick={() => setExtraPayments(prev => [...prev, { method: 'credit', amount: primaryAmt }])}
                        className="text-xs text-amber-600 hover:underline"
                      >나머지 전액 외상</button>
                    )}
                  </div>
                  {primaryAmt + extraSum !== finalAmount && (
                    <p className="text-[11px] text-amber-600">
                      합계 {(primaryAmt + extraSum).toLocaleString()}원 / 결제금액 {finalAmount.toLocaleString()}원
                    </p>
                  )}
                </div>
              );
            })()}
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

          {/* 백화점 카드 결제 — 간편 입력 */}
          {isDeptStore && paymentMethod === 'card' && (
            <div className="space-y-2 p-3 bg-purple-50 rounded-lg border border-purple-200">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-purple-700">결제 정보</p>
                <button
                  type="button"
                  onClick={() => setDeptShowDetail(prev => !prev)}
                  className="text-xs text-purple-500 hover:underline"
                >
                  {deptShowDetail ? '간편 입력' : '상세 입력'}
                </button>
              </div>
              {/* 기본: 카드사 + 할부만 (가장 빈번한 입력) */}
              <div className="flex gap-2">
                <div className="flex gap-1 flex-wrap flex-1">
                  {['삼성', '현대', 'KB', '신한', '롯데', '하나', '우리', 'NH', 'BC'].map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDeptCardCompany(c)}
                      className={`px-2 py-1 rounded text-xs transition-colors ${
                        deptCardCompany === c ? 'bg-purple-600 text-white' : 'bg-white border border-purple-200 text-purple-700 hover:bg-purple-100'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <select value={deptInstallment} onChange={e => setDeptInstallment(e.target.value)} className="input text-xs py-1 w-20">
                  <option value="0">일시불</option>
                  <option value="2">2개월</option>
                  <option value="3">3개월</option>
                  <option value="6">6개월</option>
                  <option value="10">10개월</option>
                  <option value="12">12개월</option>
                </select>
              </div>
              {/* 상세: 승인번호 + 메모 (토글) */}
              {deptShowDetail && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-purple-200">
                  <div>
                    <label className="text-xs text-slate-500">승인번호 (선택)</label>
                    <input
                      type="text"
                      value={deptApprovalNo}
                      onChange={e => setDeptApprovalNo(e.target.value)}
                      placeholder="미입력 가능"
                      className="input text-sm py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">메모 (선택)</label>
                    <input
                      type="text"
                      value={deptMemo}
                      onChange={e => setDeptMemo(e.target.value)}
                      placeholder="이벤트명 등"
                      className="input text-sm py-1.5"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 결제 버튼 — 단말기 연동 없음(추후 적용). 클릭 시 즉시 완료 처리. */}
          <button
            onClick={handlePayment}
            disabled={cart.length === 0 || !selectedBranch || processing || (paymentMethod === 'cash' && cashReceivedNum > 0 && change < 0)}
            className="w-full btn-primary py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? '처리 중...' : `결제 (${finalAmount.toLocaleString()}원)`}
          </button>
        </div>
      </div>

      {receiptData && (
        <ReceiptModal
          {...receiptData}
          onClose={() => {
            setReceiptData(null);
            searchRef.current?.focus();
          }}
        />
      )}

      {showAddCustomerModal && (
        <CustomerAddModal
          defaultBranchId={selectedBranch}
          onClose={() => setShowAddCustomerModal(false)}
          onCreated={handleCustomerCreated}
        />
      )}
    </div>
      )}
    </div>
  );
}

// ── 고객 상세 추가 모달 ────────────────────────────────────────────────────────
function CustomerAddModal({ defaultBranchId, onClose, onCreated }: {
  defaultBranchId: string;
  onClose: () => void;
  onCreated: (phone: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [grade, setGrade] = useState('NORMAL');
  const [healthNote, setHealthNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Daum 우편번호 스크립트 로드 (1회)
    if (typeof window !== 'undefined' && !window.daum) {
      const script = document.createElement('script');
      script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      document.head.appendChild(script);
    }
  }, []);

  const openPostcode = () => {
    if (typeof window === 'undefined' || !window.daum) {
      alert('주소 검색 스크립트 로딩 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    new window.daum.Postcode({
      oncomplete: (data: any) => {
        const road = data.roadAddress || data.jibunAddress;
        setAddress1(road);
        setAddress2('');
      },
    }).open();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !phone.trim()) { setError('이름·연락처는 필수입니다.'); return; }
    setSaving(true);
    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('phone', phone.trim());
    if (email.trim()) fd.append('email', email.trim());
    const combined = address2.trim()
      ? `${address1.trim()}\n${address2.trim()}`
      : address1.trim();
    if (combined) fd.append('address', combined);
    fd.append('grade', grade);
    if (defaultBranchId) fd.append('primary_branch_id', defaultBranchId);
    if (healthNote.trim()) fd.append('health_note', healthNote.trim());
    const res = await createCustomer(fd);
    setSaving(false);
    if ((res as any)?.error) { setError((res as any).error); return; }
    onCreated(phone.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-5 py-3 border-b">
          <div>
            <h2 className="font-bold">고객 추가</h2>
            <p className="text-xs text-slate-500 mt-0.5">등록 후 바로 이번 주문에 배정됩니다.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">이름 *</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus required className="input text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">연락처 *</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} required placeholder="010-XXXX-XXXX" className="input text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">이메일</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">주소</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={address1}
                readOnly
                onClick={openPostcode}
                placeholder="주소 검색 버튼을 눌러주세요"
                className="input text-sm flex-1 bg-slate-50 cursor-pointer"
              />
              <button
                type="button"
                onClick={openPostcode}
                className="btn-secondary text-sm whitespace-nowrap"
              >
                주소 검색
              </button>
            </div>
            <input
              type="text"
              value={address2}
              onChange={e => setAddress2(e.target.value)}
              placeholder="상세 주소 (동/호수 등)"
              className="input text-sm mt-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">등급</label>
            <select value={grade} onChange={e => setGrade(e.target.value)} className="input text-sm">
              <option value="NORMAL">일반</option>
              <option value="VIP">VIP</option>
              <option value="VVIP">VVIP</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">건강 메모 (선택)</label>
            <textarea value={healthNote} onChange={e => setHealthNote(e.target.value)} rows={2}
              placeholder="알러지·복용 중 약 등" className="input text-sm resize-none" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="flex-1 btn-primary disabled:opacity-50">
              {saving ? '저장 중...' : '등록 후 선택'}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
