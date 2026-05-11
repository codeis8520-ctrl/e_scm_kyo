'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { processPosCheckout, createCustomer } from '@/lib/actions';
import { saveDraft, listDrafts, getDraft, deleteDraft, type DraftRow } from '@/lib/sales-draft-actions';
import ReceiptModal from './ReceiptModal';
import { kstTodayString } from '@/lib/date';

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

type PaymentMethodId = 'cash' | 'card' | 'credit' | 'cod';
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: '현금', card: '카드', credit: '외상', cod: '수령시수금',
  // legacy display (선택 불가, 기존 데이터 표시용)
  card_keyin: '카드(키인)', kakao: '카카오', mixed: '복합',
};

interface PaymentRow {
  method: PaymentMethodId;
  amount: number;
  approvalNo?: string;
  cardInfo?: string;
}

type DeliveryType = 'NONE' | 'PARCEL' | 'QUICK';

interface ShippingForm {
  type: DeliveryType;
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

const CONSULT_TYPES = ['전화 상담', '방문 상담', '온라인 상담', '건강 상담', '불만 접수', '기타'];

type ReceiptStatus = 'RECEIVED' | 'PICKUP_PLANNED' | 'QUICK_PLANNED' | 'PARCEL_PLANNED';
const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  RECEIVED: '수령완료',
  PICKUP_PLANNED: '방문예정',
  QUICK_PLANNED: '퀵예정',
  PARCEL_PLANNED: '택배예정',
};

type ApprovalStatus = 'COMPLETED' | 'CARD_PENDING' | 'UNSETTLED';
const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  COMPLETED: '결제 완료',
  CARD_PENDING: '미승인(카드)',
  UNSETTLED: '미결',
};

// 자주 사용하는 주문 옵션 프리셋
const ORDER_OPTION_PRESETS = ['보자기 포장', '쇼핑백 증정', '서비스 지급', '수령 완료', '택배 예정', '퀵 예정', '방문 예정'];

type ItemDeliveryType = 'PICKUP' | 'PARCEL' | 'QUICK';
const ITEM_DELIVERY_LABEL: Record<ItemDeliveryType, string> = {
  PICKUP: '🏠 현장', PARCEL: '📦 택배', QUICK: '🛵 퀵',
};

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  discount: number;
  barcode?: string;
  orderOption?: string;
  deliveryType: ItemDeliveryType;  // 품목별 배송방식 (기본 PICKUP)
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  grade: string;
  grade_point_rate?: number;
  currentPoints?: number;
}

interface StaffUser {
  id: string;
  name: string;
  role: string;
  branch_id: string | null;
}

export default function POSPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-slate-400">로딩 중...</div>}>
      <POSPageInner />
    </Suspense>
  );
}

function POSPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const copyOrderId = searchParams?.get('copy') || null;

  const [copyBanner, setCopyBanner] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [productMap, setProductMap] = useState<Map<string, any>>(new Map());
  const [inventoryMap, setInventoryMap] = useState<Map<string, number>>(new Map());
  const [branches, setBranches] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>('card');
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
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);

  // 고객 이력 (상담·주문) — 좌측 상단 패널에 표시
  const [history, setHistory] = useState<{
    loading: boolean;
    consultations: any[];
    orders: any[];
    totalLtv: number;
  }>({ loading: false, consultations: [], orders: [], totalLtv: 0 });
  const [historyTab, setHistoryTab] = useState<'consult' | 'orders'>('consult');

  // 상담 작성
  const [consultType, setConsultType] = useState<string>('방문 상담');
  const [consultText, setConsultText] = useState('');
  const [savingConsult, setSavingConsult] = useState(false);

  // 주문 메모
  const [orderMemo, setOrderMemo] = useState('');

  // 판매 메타 (PDF 스펙) — KST 오늘
  const todayStr = kstTodayString();
  const [saleDate, setSaleDate] = useState<string>(todayStr);
  const [receiptStatus, setReceiptStatus] = useState<ReceiptStatus>('RECEIVED');
  const [receiptDate, setReceiptDate] = useState<string>(todayStr);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('COMPLETED');
  // 매출처 검색형 콤보
  const [branchSearch, setBranchSearch] = useState<string>('');
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  // 품목별 주문 옵션 편집
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editingOptionVal, setEditingOptionVal] = useState<string>('');

  // 배송 (택배/퀵)
  const [shipping, setShipping] = useState<ShippingForm>({
    type: 'NONE',
    recipient_name: '', recipient_phone: '',
    recipient_zipcode: '', recipient_address: '', recipient_address_detail: '',
    delivery_message: '',
    senderSameAsBuyer: true,
    sender_name: '', sender_phone: '',
    sender_zipcode: '', sender_address: '', sender_address_detail: '',
  });
  const [shipFromBranchId, setShipFromBranchId] = useState<string>('');

  // 분할 결제
  const [splitMode, setSplitMode] = useState(false);
  const [extraPayments, setExtraPayments] = useState<PaymentRow[]>([]);

  const [cartOpen, setCartOpen] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>('checkout');

  // ── 임시저장 (결제 직전 상태를 통째로 저장 → 나중에 다시 불러오기) ────────
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [draftBanner, setDraftBanner] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const editingQtyRef = useRef<HTMLInputElement>(null);
  const editingDiscountRef = useRef<HTMLInputElement>(null);

  const initialRole = getCookie('user_role');
  const initialBranchId = getCookie('user_branch_id');
  const initialUserId = getCookie('user_id');
  const initialUserName = getCookie('user_name');

  // 판매 지점: 로그인 사용자의 지점으로 고정 (콤보 제거)
  const [selectedBranch, setSelectedBranch] = useState<string>(initialBranchId || '');
  const [userRole] = useState<string | null>(initialRole);

  // 판매 담당자 (기본 = 로그인 사용자, 변경 가능)
  const [handlerId, setHandlerId] = useState<string>(initialUserId || '');

  const selectedBranchData = branches.find(b => b.id === selectedBranch);
  const isDeptStore = selectedBranchData?.channel === 'DEPT_STORE';

  // 백화점 수기입력용 상태
  const [deptApprovalNo, setDeptApprovalNo] = useState('');
  const [deptCardCompany, setDeptCardCompany] = useState('');
  const [deptInstallment, setDeptInstallment] = useState('0');
  const [deptMemo, setDeptMemo] = useState('');
  const [deptShowDetail, setDeptShowDetail] = useState(false);

  // Daum postcode script
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

  // ── 초기 데이터 로드 ───────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      // product_type 포함 시도 → 마이그 042 미적용 DB 폴백
      let productsRes: any = await supabase
        .from('products')
        .select('id, name, code, barcode, price, unit, product_type')
        .eq('is_active', true)
        .order('name');
      if (productsRes.error) {
        productsRes = await supabase
          .from('products')
          .select('id, name, code, barcode, price, unit')
          .eq('is_active', true)
          .order('name');
      }

      const [branchesRes, customersRes, gradesRes, invRes, usersRes] = await Promise.all([
        supabase.from('branches').select('*').eq('is_active', true).order('created_at'),
        supabase.from('customers').select('id, name, phone, grade').eq('is_active', true).order('name'),
        supabase.from('customer_grades').select('code, point_rate'),
        supabase.from('inventories').select('product_id, branch_id, quantity'),
        supabase.from('users').select('id, name, role, branch_id').eq('is_active', true).order('name'),
      ]);

      const gradesMap = new Map((gradesRes.data || []).map((g: any) => [g.code, parseFloat(g.point_rate) || 1.0]));
      const branchesData = (branchesRes.data || []) as any[];
      // POS 판매 대상은 완제품만 — RAW/SUB 제외 (null은 레거시 FINISHED 취급)
      const productsData = ((productsRes.data || []) as any[]).filter(
        (p: any) => p.product_type !== 'RAW' && p.product_type !== 'SUB'
      );

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
      setStaff(((usersRes.data as any[]) || []) as StaffUser[]);

      const pMap = new Map<string, any>();
      productsData.forEach(p => {
        if (p.barcode) pMap.set(p.barcode, p);
        pMap.set(p.code, p);
      });
      setProductMap(pMap);

      // 판매 지점 확정: 쿠키 branch_id → 본사 → STORE(한약국) 채널 → 첫 번째 지점
      //   ※ 담당지점 미지정 관리자(SUPER_ADMIN/HQ_OPERATOR)는 created_at 첫 행이
      //     자사몰(ONLINE)일 수 있어 의외의 매출처가 기본 선택되는 문제가 있었음.
      //     본사 → 한약국 채널 → 그래도 없으면 첫 번째 순으로 폴백.
      if (initialBranchId) {
        setSelectedBranch(initialBranchId);
        setShipFromBranchId(initialBranchId);
      } else if (branchesData.length > 0) {
        const hq = branchesData.find((b: any) => b.is_headquarters);
        const storeBranch = branchesData.find((b: any) => b.channel === 'STORE');
        const defaultBranch = hq || storeBranch || branchesData[0];
        setSelectedBranch(defaultBranch.id);
        setShipFromBranchId(defaultBranch.id);
      }

      setLoading(false);
    };
    fetchData();
    searchRef.current?.focus();
  }, [initialBranchId]);

  // ── 전표 복사 함수 — 버튼 onClick에서 직접 호출 가능 (URL 경유 없이)
  const applyCopy = useCallback(async (orderId: string) => {
    const sb = createClient() as any;
    const full = await sb.from('sales_orders')
      .select(`
        id, order_number, branch_id, customer_id, memo,
        items:sales_order_items(product_id, quantity, unit_price, discount_amount, order_option, delivery_type),
        shipment:shipments(
          branch_id, delivery_type, recipient_name, recipient_phone,
          recipient_zipcode, recipient_address, recipient_address_detail,
          delivery_message, sender_name, sender_phone,
          sender_zipcode, sender_address, sender_address_detail
        )
      `)
      .eq('id', orderId).maybeSingle();
    let src: any = full.data;
    if (full.error) {
      const retry = await sb.from('sales_orders')
        .select(`
          id, order_number, branch_id, customer_id, memo,
          items:sales_order_items(product_id, quantity, unit_price, discount_amount),
          shipment:shipments(
            branch_id, recipient_name, recipient_phone,
            recipient_zipcode, recipient_address, recipient_address_detail,
            delivery_message
          )
        `)
        .eq('id', orderId).maybeSingle();
      src = retry.data;
    }
    if (!src) return;

    // 매출처
    if (src.branch_id) {
      setSelectedBranch(src.branch_id);
      setShipFromBranchId(src.branch_id);
    }
    // 고객
    if (src.customer_id) {
      const cust = customers.find(c => c.id === src.customer_id);
      if (cust) await selectCustomer(cust);
    }
    // 카트 — 원본의 deliveryType 유지
    const newCart: CartItem[] = ((src.items as any[]) || []).map((it: any) => {
      const prod = products.find(p => p.id === it.product_id);
      return {
        productId: it.product_id,
        name: prod?.name || '(삭제된 품목)',
        price: Number(it.unit_price ?? prod?.price ?? 0),
        quantity: Number(it.quantity || 1),
        discount: Number(it.discount_amount || 0),
        barcode: prod?.barcode,
        orderOption: it.order_option || undefined,
        deliveryType: (it.delivery_type as ItemDeliveryType) || 'PICKUP',
      };
    }).filter((c: CartItem) => !!c.productId);
    setCart(newCart);
    // 배송 복사 — 주소/수령인 유지, type은 cart 집계에 맡김
    const shipRow = Array.isArray(src.shipment) ? src.shipment[0] : src.shipment;
    if (shipRow && shipRow.recipient_name) {
      const dtype: DeliveryType = (shipRow.delivery_type === 'QUICK') ? 'QUICK' : 'PARCEL';
      setShipping(prev => ({
        ...prev,
        type: dtype,
        recipient_name: shipRow.recipient_name || '',
        recipient_phone: shipRow.recipient_phone || '',
        recipient_zipcode: shipRow.recipient_zipcode || '',
        recipient_address: shipRow.recipient_address || '',
        recipient_address_detail: shipRow.recipient_address_detail || '',
        delivery_message: shipRow.delivery_message || '',
        senderSameAsBuyer: !(shipRow.sender_name && shipRow.sender_name !== prev.sender_name),
        sender_name: shipRow.sender_name || prev.sender_name,
        sender_phone: shipRow.sender_phone || prev.sender_phone,
        sender_zipcode: shipRow.sender_zipcode || '',
        sender_address: shipRow.sender_address || '',
        sender_address_detail: shipRow.sender_address_detail || '',
      }));
      if (shipRow.branch_id) setShipFromBranchId(shipRow.branch_id);
    } else {
      // 배송 정보 없으면 type=NONE으로
      setShipping(prev => ({ ...prev, type: 'NONE' }));
    }
    // 초기화: 날짜·승인. 수령현황은 cart 집계가 계산(effect E).
    const today = kstTodayString();
    setOrderMemo(src.memo || '');
    setReceiptDate(today);
    setSaleDate(today);
    setApprovalStatus('COMPLETED');
    setMainTab('checkout');

    setCopyBanner(`📋 ${src.order_number} 복사 중 — 일자·승인은 초기화, 품목 배송방식은 유지됨`);
  }, [customers, products]);

  // ── URL ?copy=<id>로 진입 시 1회 적용 ───────────────────────────────────
  useEffect(() => {
    if (!copyOrderId || loading) return;
    let aborted = false;
    (async () => {
      await applyCopy(copyOrderId);
      if (!aborted) router.replace('/pos');
    })();
    return () => { aborted = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyOrderId, loading]);

  // 배송 미활성 시 출고 지점을 판매 지점에 동기화
  useEffect(() => {
    if (shipping.type === 'NONE' && selectedBranch) {
      setShipFromBranchId(selectedBranch);
    }
  }, [shipping.type, selectedBranch]);

  // ── cart가 source of truth — shipping.type과 receiptStatus를 자동 집계
  //   (shipping↔receiptStatus 상호 effect는 깜빡임 유발하여 제거함)
  //   cart가 빈 상태에서는 탭/콤보 사용자 선택을 보존하기 위해 동기화 생략
  useEffect(() => {
    if (cart.length === 0) return;
    const hasParcel = cart.some(c => c.deliveryType === 'PARCEL');
    const hasQuick = cart.some(c => c.deliveryType === 'QUICK');
    const shipTarget: DeliveryType = hasParcel ? 'PARCEL' : hasQuick ? 'QUICK' : 'NONE';
    setShipping(prev => prev.type === shipTarget ? prev : { ...prev, type: shipTarget });
    // receiptStatus 집계: 품목에 배송건이 있으면 해당 *_PLANNED, 아니면 사용자의 RECEIVED/PICKUP_PLANNED 보존
    if (hasParcel) {
      setReceiptStatus(prev => prev === 'PARCEL_PLANNED' ? prev : 'PARCEL_PLANNED');
    } else if (hasQuick) {
      setReceiptStatus(prev => prev === 'QUICK_PLANNED' ? prev : 'QUICK_PLANNED');
    } else {
      // 모두 PICKUP — 이전에 _PLANNED였으면 RECEIVED로 복귀, PICKUP_PLANNED/RECEIVED는 보존
      setReceiptStatus(prev =>
        (prev === 'PARCEL_PLANNED' || prev === 'QUICK_PLANNED') ? 'RECEIVED' : prev);
    }
  }, [cart]);

  // 결제수단에 맞춰 승인상태 기본값 추천 (사용자 변경값은 보존)
  useEffect(() => {
    setApprovalStatus(prev => {
      // 사용자가 명시적으로 건드린 흔적이 없는 경우에만 자동 보정
      if (paymentMethod === 'credit') return prev === 'COMPLETED' ? 'UNSETTLED' : prev;
      if (paymentMethod === 'cod') return prev === 'COMPLETED' ? 'UNSETTLED' : prev;
      return prev;
    });
  }, [paymentMethod]);

  // 고객 검색 (로컬 필터)
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

  useEffect(() => {
    if (editingQtyId) editingQtyRef.current?.focus();
  }, [editingQtyId]);
  useEffect(() => {
    if (editingDiscountId) editingDiscountRef.current?.focus();
  }, [editingDiscountId]);

  const filteredProducts = products.filter(p =>
    p.name.includes(search) || p.code.includes(search)
  );

  // 매출처 검색 결과
  const isBranchLocked = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';
  const filteredBranches = useMemo(() => {
    if (isBranchLocked) return branches;
    const q = branchSearch.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b: any) =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.code || '').toLowerCase().includes(q)
    );
  }, [branches, branchSearch, isBranchLocked]);

  const getStock = useCallback((productId: string) =>
    inventoryMap.get(`${selectedBranch}_${productId}`) ?? null,
  [inventoryMap, selectedBranch]);

  // ── 장바구니 ──────────────────────────────────────────────────────────────
  // 정책: 재고 부족/품절이어도 판매 허용 (음수 재고 정책 — schema.ts 참조).
  //       UI 카드에 이미 "품절" 배지가 보이므로 별도 차단 없음.
  const addToCart = (product: any) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      // 새 품목은 현재 배송 탭 기반으로 deliveryType 초기값 설정
      const initialDeliveryType: ItemDeliveryType =
        shipping.type === 'PARCEL' ? 'PARCEL'
        : shipping.type === 'QUICK' ? 'QUICK'
        : 'PICKUP';
      return [...prev, {
        productId: product.id, name: product.name, price: product.price,
        quantity: 1, discount: 0, barcode: product.barcode,
        deliveryType: initialDeliveryType,
      }];
    });
    setSearch('');
    searchRef.current?.focus();
  };

  const removeFromCart = (productId: string) => setCart(prev => prev.filter(i => i.productId !== productId));

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) { removeFromCart(productId); return; }
    // 재고 부족/음수여도 판매 허용 (음수 재고 정책)
    setCart(prev => prev.map(item => item.productId === productId ? { ...item, quantity } : item));
  };

  const handleSearchEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !search.trim()) return;
    const trimmed = search.trim();
    const exact = productMap.get(trimmed);
    if (exact) { addToCart(exact); return; }
    if (filteredProducts.length === 1) { addToCart(filteredProducts[0]); return; }
    if (filteredProducts.length === 0) alert(`"${trimmed}" 해당 제품이 없습니다.`);
  };

  // ── 고객 선택 + 이력 로드 ──────────────────────────────────────────────────
  const loadCustomerHistory = async (customerId: string) => {
    const supabase = createClient() as any;
    setHistory(prev => ({ ...prev, loading: true }));
    try {
      const [consultRes, ordersRes] = await Promise.all([
        supabase
          .from('customer_consultations')
          .select('id, consultation_type, content, created_at, consulted_by')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('sales_orders')
          .select('id, order_number, total_amount, ordered_at, status, branch:branches(name), items:sales_order_items(quantity, product:products(name))')
          .eq('customer_id', customerId)
          .order('ordered_at', { ascending: false })
          .limit(20),
      ]);
      const orders = (ordersRes.data || []) as any[];
      const totalLtv = orders
        .filter(o => !['CANCELLED', 'REFUNDED'].includes(o.status))
        .reduce((s: number, o: any) => s + (o.total_amount || 0), 0);
      setHistory({
        loading: false,
        consultations: (consultRes.data as any[]) || [],
        orders,
        totalLtv,
      });
    } catch {
      setHistory({ loading: false, consultations: [], orders: [], totalLtv: 0 });
    }
  };

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
    setHistoryTab('consult');

    setShipping(prev => prev.senderSameAsBuyer
      ? { ...prev, sender_name: customer.name, sender_phone: customer.phone }
      : prev);

    loadCustomerHistory(customer.id);
  };

  const handleCustomerCreated = async (phone: string) => {
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
    setHistory({ loading: false, consultations: [], orders: [], totalLtv: 0 });
    setConsultText('');
    customerInputRef.current?.focus();
  };

  // ── 상담 저장 ─────────────────────────────────────────────────────────────
  const saveConsultation = async () => {
    if (!selectedCustomer) { alert('고객을 먼저 선택하세요.'); return; }
    const trimmed = consultText.trim();
    if (!trimmed) return;
    setSavingConsult(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from('customer_consultations').insert({
        customer_id: selectedCustomer.id,
        consultation_type: consultType,
        content: { text: trimmed },
        consulted_by: handlerId || initialUserId || null,
      });
      if (error) {
        alert('상담 저장 실패: ' + error.message);
      } else {
        setConsultText('');
        await loadCustomerHistory(selectedCustomer.id);
        setHistoryTab('consult');
      }
    } finally {
      setSavingConsult(false);
    }
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

  // 담당자 목록 (같은 지점 우선, 나머지 뒤로)
  const orderedStaff = useMemo(() => {
    const sameBranch = staff.filter(u => u.branch_id === selectedBranch);
    const otherBranch = staff.filter(u => u.branch_id !== selectedBranch);
    return [...sameBranch, ...otherBranch];
  }, [staff, selectedBranch]);

  const handlerName = useMemo(
    () => staff.find(s => s.id === handlerId)?.name || initialUserName || '미지정',
    [staff, handlerId, initialUserName]
  );

  // ── 결제 처리 ─────────────────────────────────────────────────────────────
  const handlePayment = async () => {
    if (cart.length === 0) return;
    if (!selectedBranch) { alert('지점 정보가 없습니다. 다시 로그인해주세요.'); return; }
    if (!handlerId) { alert('담당자를 지정해주세요.'); return; }
    if (paymentMethod === 'credit' && !selectedCustomer) {
      alert('외상 결제는 고객을 먼저 선택해야 합니다.\n누가 외상했는지 기록되어야 합니다.');
      return;
    }
    if (paymentMethod === 'cash' && cashReceivedNum > 0 && cashReceivedNum < finalAmount) {
      alert(`받은 금액(${cashReceivedNum.toLocaleString()}원)이 결제 금액(${finalAmount.toLocaleString()}원)보다 적습니다.`);
      return;
    }

    setProcessing(true);
    const branchData = branches.find(b => b.id === selectedBranch);

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

    const useShipping =
      shipping.type !== 'NONE' &&
      shipping.recipient_name.trim() &&
      shipping.recipient_phone.trim() &&
      shipping.recipient_address.trim();
    if (shipping.type !== 'NONE' && !useShipping) {
      alert(`${shipping.type === 'QUICK' ? '퀵배송' : '택배'} 수령인 이름·연락처·주소(검색)를 모두 입력하세요.`);
      setProcessing(false);
      return;
    }

    const memoCombined = [
      orderMemo.trim(),
      isDeptStore && deptMemo.trim() ? `[백화점] ${deptMemo.trim()}` : '',
    ].filter(Boolean).join(' · ') || undefined;

    try {
      // 판매 일자 → ISO timestamp (시각은 현재 시각 사용)
      const saleIso = (() => {
        if (!saleDate) return new Date().toISOString();
        const now = new Date();
        const d = new Date(`${saleDate}T00:00:00`);
        d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
        return d.toISOString();
      })();

      const result = await processPosCheckout({
        branchId: selectedBranch,
        branchCode: branchData?.code || 'ETC',
        branchName: branchData?.name || '',
        branchChannel: branchData?.channel || 'STORE',
        customerId: selectedCustomer?.id || null,
        customerGrade: selectedCustomer?.grade || null,
        gradePointRate: selectedCustomer?.grade_point_rate || 1.0,
        saleDate: saleIso,
        receiptStatus,
        receiptDate: receiptDate || null,
        approvalStatus,
        cart: cart.map(c => ({
          productId: c.productId,
          name: c.name,
          price: c.price,
          quantity: c.quantity,
          discount: c.discount,
          orderOption: c.orderOption,
          deliveryType: c.deliveryType || 'PICKUP',
        })),
        totalAmount: total,
        discountAmount: itemDiscountTotal + discountAmount + (usePoints ? pointsToUse : 0),
        finalAmount,
        paymentMethod,
        usePoints,
        pointsToUse,
        cashReceived: cashReceivedNum > 0 ? cashReceivedNum : undefined,
        userId: handlerId || initialUserId,
        approvalNo: isDeptStore && deptApprovalNo ? deptApprovalNo : undefined,
        cardInfo: isDeptStore
          ? [deptCardCompany, deptInstallment !== '0' ? `${deptInstallment}개월` : '일시불'].filter(Boolean).join(' · ')
          : undefined,
        memo: memoCombined,
        paymentSplits: paymentSplits.length > 0 ? paymentSplits.map(p => ({ method: p.method, amount: p.amount, approvalNo: p.approvalNo, cardInfo: p.cardInfo })) : undefined,
        shipFromBranchId: useShipping ? (shipFromBranchId || selectedBranch) : undefined,
        shipping: useShipping ? {
          delivery_type: shipping.type === 'QUICK' ? 'QUICK' : 'PARCEL',
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

      if (stockUpdates) {
        for (const [productId, newQty] of Object.entries(stockUpdates)) {
          const key = `${selectedBranch}_${productId}`;
          setInventoryMap(prev => new Map(prev).set(key, newQty));
        }
      }

      setReceiptData({
        orderNumber: orderNumber!, branchName: branchData?.name || '',
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

      // 결제 완료 — 진행 중이던 임시저장 슬롯이 있으면 자동 정리
      if (currentDraftId) {
        deleteDraft(currentDraftId).then(() => refreshDraftCount()).catch(() => {});
      }
      // 폼 전체 초기화 (담당자·매출처는 보존 — 같은 담당자·지점에서 연속 판매하는 경우가 많음)
      const keepHandler = handlerId;
      const keepBranch = selectedBranch;
      resetCheckoutForm();
      setHandlerId(keepHandler);
      setSelectedBranch(keepBranch);

    } catch (err: any) {
      console.error('결제 오류:', err);
      alert(`결제 처리 중 오류가 발생했습니다.\n\n${err?.message || JSON.stringify(err)}`);
    }

    setProcessing(false);
  };

  // ── 임시저장 핸들러 ──────────────────────────────────────────────────────
  const resetCheckoutForm = () => {
    setCart([]);
    setSelectedCustomer(null);
    setCustomerSearch('');
    setHistory({ loading: false, consultations: [], orders: [], totalLtv: 0 });
    setConsultText('');
    setUsePoints(false);
    setPointsToUse(0);
    setDiscountInput('');
    setCashReceived('');
    setOrderMemo('');
    setShipping({
      type: 'NONE',
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
    setDeptApprovalNo('');
    setDeptCardCompany('');
    setDeptInstallment('0');
    setDeptMemo('');
    setSaleDate(kstTodayString());
    setReceiptDate(kstTodayString());
    setReceiptStatus('RECEIVED');
    setApprovalStatus('COMPLETED');
    setCurrentDraftId(null);
    setCopyBanner(null);
    setDraftBanner(null);
  };

  const refreshDraftCount = useCallback(async () => {
    const res = await listDrafts();
    if (res.data) {
      setDraftCount(res.data.length);
      setDrafts(res.data);
    }
  }, []);

  // 초기 임시저장 개수 로드
  useEffect(() => {
    if (!loading) refreshDraftCount();
  }, [loading, refreshDraftCount]);

  const handleSaveDraft = async () => {
    if (cart.length === 0) {
      alert('장바구니에 품목이 있어야 임시저장할 수 있습니다.');
      return;
    }
    if (!selectedBranch) {
      alert('판매 지점이 지정되지 않았습니다.');
      return;
    }

    setSavingDraft(true);
    const subTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
    const itemCount = cart.length;
    const titleHint = selectedCustomer?.name
      ? `${selectedCustomer.name} · ${cart[0]?.name}${cart.length > 1 ? ` 외 ${cart.length - 1}` : ''}`
      : `${cart[0]?.name || '비회원'}${cart.length > 1 ? ` 외 ${cart.length - 1}` : ''}`;

    const res = await saveDraft({
      branch_id: selectedBranch,
      customer_id: selectedCustomer?.id || null,
      customer_snapshot: selectedCustomer
        ? { name: selectedCustomer.name, phone: selectedCustomer.phone, grade: selectedCustomer.grade }
        : null,
      cart_items: cart,
      delivery_info: shipping,
      payment_info: {
        paymentMethod, splitMode, extraPayments, cashReceived,
        usePoints, pointsToUse, discountInput, discountType,
        deptApprovalNo, deptCardCompany, deptInstallment, deptMemo,
      },
      meta_info: {
        saleDate, receiptStatus, receiptDate, approvalStatus,
        shipFromBranchId, handlerId,
      },
      memo: orderMemo || null,
      title: titleHint,
      total_amount: subTotal,
      item_count: itemCount,
    }, currentDraftId || undefined);

    setSavingDraft(false);
    if (res.error) {
      alert('임시저장 실패: ' + res.error);
      return;
    }
    setCurrentDraftId(res.id || null);
    setDraftBanner(`💾 임시저장 완료 — 나중에 "불러오기"에서 다시 작성 가능합니다.`);
    refreshDraftCount();
    setTimeout(() => setDraftBanner(null), 4000);
  };

  const handleOpenDraftModal = async () => {
    setShowDraftModal(true);
    setDraftLoading(true);
    const res = await listDrafts();
    setDraftLoading(false);
    if (res.error) {
      alert('임시저장 목록 조회 실패: ' + res.error);
      return;
    }
    setDrafts(res.data || []);
    setDraftCount((res.data || []).length);
  };

  const handleLoadDraft = async (draftId: string) => {
    if (cart.length > 0 && !confirm('현재 작성 중인 전표가 있습니다. 임시저장을 불러오면 현재 내용은 사라집니다. 계속하시겠습니까?')) {
      return;
    }
    const res = await getDraft(draftId);
    if (res.error || !res.data) {
      alert('불러오기 실패: ' + (res.error || '데이터 없음'));
      return;
    }
    const d = res.data;

    // 카트 — 현재 products와 매칭해 deliveryType/orderOption 그대로 복원
    const newCart: CartItem[] = (d.cart_items || []).map((it: any) => ({
      productId: it.productId,
      name: it.name,
      price: Number(it.price || 0),
      quantity: Number(it.quantity || 1),
      discount: Number(it.discount || 0),
      barcode: it.barcode,
      orderOption: it.orderOption || undefined,
      deliveryType: (it.deliveryType as ItemDeliveryType) || 'PICKUP',
    })).filter((c: CartItem) => !!c.productId);
    setCart(newCart);

    // 매출처
    if (d.branch_id) setSelectedBranch(d.branch_id);

    // 고객 — DB의 customer 우선, 없으면 snapshot 표시용
    if (d.customer_id && d.customer) {
      const cust = customers.find(c => c.id === d.customer_id);
      if (cust) {
        await selectCustomer(cust);
      }
    } else if (d.customer_snapshot) {
      // 비회원/스냅샷 — 표시만 복원 (선택 상태 X)
      setSelectedCustomer(null);
    }

    // 배송
    if (d.delivery_info) {
      setShipping((prev) => ({ ...prev, ...d.delivery_info }));
    }

    // 결제 진행 상태
    const p = d.payment_info || {};
    if (p.paymentMethod) setPaymentMethod(p.paymentMethod);
    if (typeof p.splitMode === 'boolean') setSplitMode(p.splitMode);
    if (Array.isArray(p.extraPayments)) setExtraPayments(p.extraPayments);
    if (typeof p.cashReceived === 'string') setCashReceived(p.cashReceived);
    if (typeof p.usePoints === 'boolean') setUsePoints(p.usePoints);
    if (typeof p.pointsToUse === 'number') setPointsToUse(p.pointsToUse);
    if (typeof p.discountInput === 'string') setDiscountInput(p.discountInput);
    if (p.discountType === 'amount' || p.discountType === 'percent') setDiscountType(p.discountType);
    if (typeof p.deptApprovalNo === 'string') setDeptApprovalNo(p.deptApprovalNo);
    if (typeof p.deptCardCompany === 'string') setDeptCardCompany(p.deptCardCompany);
    if (typeof p.deptInstallment === 'string') setDeptInstallment(p.deptInstallment);
    if (typeof p.deptMemo === 'string') setDeptMemo(p.deptMemo);

    // 메타
    const m = d.meta_info || {};
    if (m.saleDate) setSaleDate(m.saleDate);
    if (m.receiptStatus) setReceiptStatus(m.receiptStatus);
    if (m.receiptDate) setReceiptDate(m.receiptDate);
    if (m.approvalStatus) setApprovalStatus(m.approvalStatus);
    if (m.shipFromBranchId) setShipFromBranchId(m.shipFromBranchId);
    if (m.handlerId) setHandlerId(m.handlerId);

    setOrderMemo(d.memo || '');
    setCurrentDraftId(d.id);
    setMainTab('checkout');
    setShowDraftModal(false);
    setDraftBanner(`📂 임시저장 불러오기 완료 — 이어서 작성하거나 결제하면 자동 정리됩니다.`);
    setTimeout(() => setDraftBanner(null), 4500);
  };

  const handleDeleteDraft = async (draftId: string) => {
    if (!confirm('이 임시저장 전표를 삭제하시겠습니까? (복구 불가)')) return;
    const res = await deleteDraft(draftId);
    if (res.error) {
      alert('삭제 실패: ' + res.error);
      return;
    }
    if (currentDraftId === draftId) setCurrentDraftId(null);
    refreshDraftCount();
  };

  const commitQtyEdit = (productId: string) => {
    const val = parseInt(editingQtyVal);
    if (!isNaN(val)) updateQuantity(productId, val);
    setEditingQtyId(null);
    setEditingQtyVal('');
  };

  // ── 렌더링 ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 전표 복사 배너 */}
      {copyBanner && (
        <div className="p-2 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs flex items-center justify-between">
          <span>{copyBanner}</span>
          <button onClick={() => setCopyBanner(null)} className="text-indigo-400 hover:text-indigo-600">✕</button>
        </div>
      )}

      {/* 임시저장 배너 */}
      {draftBanner && (
        <div className="p-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center justify-between">
          <span>{draftBanner}</span>
          <button onClick={() => setDraftBanner(null)} className="text-emerald-400 hover:text-emerald-600">✕</button>
        </div>
      )}

      {/* 판매관리 상단 탭 */}
      <div className="flex gap-1 border-b border-slate-200 items-center justify-between">
        <div className="flex gap-1">
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

        {/* 임시저장 / 불러오기 — 판매 등록 탭에서만 노출 */}
        {mainTab === 'checkout' && (
          <div className="flex gap-1.5 pb-1">
            {currentDraftId && (
              <span
                className="inline-flex items-center px-2 py-1 rounded-md text-[11px] bg-amber-50 text-amber-700 border border-amber-200"
                title="현재 임시저장 슬롯에서 이어 작성 중. 임시저장을 다시 누르면 덮어씁니다."
              >
                ✏️ 임시저장 이어쓰기 중
              </span>
            )}
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={savingDraft || cart.length === 0}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
              title="현재 작성 중인 전표를 임시저장합니다"
            >
              {savingDraft ? '저장 중...' : (currentDraftId ? '💾 덮어쓰기' : '💾 임시저장')}
            </button>
            <button
              type="button"
              onClick={handleOpenDraftModal}
              className="relative px-3 py-1.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
              title="임시저장 목록 열기"
            >
              📂 불러오기
              {draftCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                  {draftCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* 판매 메타 헤더 (일자 · 매출처 · 출고처) */}
      {mainTab === 'checkout' && (
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-slate-500 uppercase">일자</label>
          <input
            type="date"
            value={saleDate}
            onChange={e => setSaleDate(e.target.value)}
            className="input text-sm py-1.5 w-40"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[220px] relative">
          <label className="text-[11px] font-semibold text-slate-500 uppercase">매출처</label>
          {selectedBranchData ? (
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-sm ${
              isBranchLocked ? 'bg-slate-100 border-slate-200 text-slate-600'
                             : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}>
              <span className="font-medium">{selectedBranchData.name}</span>
              {selectedBranchData.code && (
                <span className="text-[10px] text-slate-400 font-mono">[{selectedBranchData.code}]</span>
              )}
              {isDeptStore && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px]">백화점</span>}
              {!isBranchLocked && (
                <button
                  type="button"
                  onClick={() => { setSelectedBranch(''); setBranchSearch(''); setShowBranchDropdown(true); }}
                  className="ml-auto text-slate-400 hover:text-slate-600 text-xs"
                >변경</button>
              )}
            </div>
          ) : (
            <input
              type="text"
              value={branchSearch}
              onChange={e => { setBranchSearch(e.target.value); setShowBranchDropdown(true); }}
              onFocus={() => setShowBranchDropdown(true)}
              onBlur={() => setTimeout(() => setShowBranchDropdown(false), 200)}
              placeholder="매출처 검색 (지점명 / 코드)"
              className="input text-sm py-1.5"
            />
          )}
          {showBranchDropdown && !selectedBranchData && (
            <div className="absolute z-40 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-auto">
              {filteredBranches.length === 0 && (
                <div className="p-3 text-center text-xs text-slate-400">결과 없음</div>
              )}
              {filteredBranches.map((b: any) => (
                <button
                  key={b.id}
                  onMouseDown={() => {
                    setSelectedBranch(b.id);
                    setBranchSearch('');
                    setShowBranchDropdown(false);
                    setShipFromBranchId(b.id);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{b.name}</p>
                      {b.code && <p className="text-[10px] text-slate-400 font-mono">{b.code}</p>}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      b.channel === 'DEPT_STORE' ? 'bg-purple-100 text-purple-700'
                      : b.is_headquarters ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-slate-100 text-slate-600'
                    }`}>
                      {b.channel === 'DEPT_STORE' ? '백화점'
                        : b.is_headquarters ? '본사'
                        : b.channel === 'ONLINE' ? '온라인'
                        : '한약국'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 현장 수령 지점 — 택배/퀵이 아닐 때만 노출.
            배송 시에는 하단 택배 섹션의 '출고 지점'으로 입력하여 의미 혼동 방지. */}
        {shipping.type === 'NONE' && (
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-[11px] font-semibold text-slate-500 uppercase">
              수령 지점 <span className="text-slate-400 normal-case font-normal">(현장)</span>
            </label>
            <select
              value={shipFromBranchId}
              onChange={e => setShipFromBranchId(e.target.value)}
              className="input text-sm py-1.5"
              title="매출처와 다른 지점에서 현장 수령하는 경우(A점 구매·B점 수령). 재고는 수령 지점에서 차감됩니다."
            >
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.id === selectedBranch ? ' (매출처)' : ''}{b.is_headquarters ? ' · 본사' : ''}
                </option>
              ))}
            </select>
            {shipFromBranchId && shipFromBranchId !== selectedBranch && (
              <span className="text-[10px] text-amber-600">매출처와 상이 — 재고는 {branches.find((b: any) => b.id === shipFromBranchId)?.name || '수령 지점'}에서 차감</span>
            )}
          </div>
        )}
      </div>
      )}

      {mainTab === 'list' && <SalesListTab />}

      {mainTab === 'checkout' && (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh-10rem)]">
      {/* 왼쪽: 고객·이력·상담 + 제품 */}
      <div className="flex-1 flex flex-col min-w-0 gap-3">
        {/* 상단 — 고객·이력·상담 패널 */}
        <div className="card p-3 flex flex-col gap-3 lg:max-h-[46%] lg:flex-shrink-0 overflow-hidden">
          {/* 고객 검색/선택 */}
          <div className="relative">
            {selectedCustomer ? (
              <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/customers/${selectedCustomer.id}`}
                      className="font-semibold text-blue-800 hover:underline text-sm">
                      {selectedCustomer.name}
                    </Link>
                    <span className="text-xs text-slate-500">{selectedCustomer.phone}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${GRADE_BADGE[selectedCustomer.grade]}`}>
                      {GRADE_LABELS[selectedCustomer.grade]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
                    <span className="text-green-600 font-medium">{(selectedCustomer.currentPoints || 0).toLocaleString()}P 보유</span>
                    {history.totalLtv > 0 && <span>LTV {history.totalLtv.toLocaleString()}원</span>}
                    <span>주문 {history.orders.length}건 · 상담 {history.consultations.length}건</span>
                  </div>
                </div>
                <button onClick={clearCustomer}
                  className="text-slate-400 hover:text-slate-600 text-lg leading-none shrink-0 ml-2">✕</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  ref={customerInputRef}
                  type="text"
                  placeholder="고객 검색 (이름 / 전화번호)"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  onFocus={() => customerSearch.length >= 1 && setShowCustomerDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
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
            )}
            {showCustomerDropdown && !selectedCustomer && (
              <div className="absolute z-40 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-auto">
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

          {/* 이력(탭) + 상담 작성 — 고객 선택 시에만 노출 */}
          {selectedCustomer ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-[160px] overflow-hidden">
              {/* 이력 탭 */}
              <div className="flex flex-col border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex border-b border-slate-200 bg-slate-50 text-xs">
                  <button
                    onClick={() => setHistoryTab('consult')}
                    className={`flex-1 py-1.5 font-medium transition-colors ${historyTab === 'consult'
                      ? 'bg-white text-blue-600 border-b-2 border-blue-500 -mb-px' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    상담 이력 ({history.consultations.length})
                  </button>
                  <button
                    onClick={() => setHistoryTab('orders')}
                    className={`flex-1 py-1.5 font-medium transition-colors ${historyTab === 'orders'
                      ? 'bg-white text-blue-600 border-b-2 border-blue-500 -mb-px' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    구매 이력 ({history.orders.length})
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 text-xs space-y-1.5 bg-white">
                  {history.loading ? (
                    <p className="text-center text-slate-400 py-4">불러오는 중...</p>
                  ) : historyTab === 'consult' ? (
                    history.consultations.length === 0 ? (
                      <p className="text-center text-slate-400 py-4">상담 이력이 없습니다.</p>
                    ) : history.consultations.map((c: any) => {
                      const text = typeof c.content === 'string' ? c.content : (c.content?.text || '-');
                      return (
                        <div key={c.id} className="border border-slate-100 rounded p-1.5 hover:bg-slate-50">
                          <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                            <span className="font-medium text-slate-500">[{c.consultation_type || '기타'}]</span>
                            <span>{String(c.created_at).slice(0, 10)}</span>
                          </div>
                          <p className="text-slate-700 whitespace-pre-wrap leading-snug">{text}</p>
                        </div>
                      );
                    })
                  ) : (
                    history.orders.length === 0 ? (
                      <p className="text-center text-slate-400 py-4">구매 이력이 없습니다.</p>
                    ) : history.orders.map((o: any) => {
                      const items = (o.items || []) as any[];
                      const names = items.map((i: any) => i.product?.name).filter(Boolean) as string[];
                      const head = names.slice(0, 2).join(', ');
                      const extra = names.length > 2 ? ` 외 ${names.length - 2}종` : '';
                      const cancelled = ['CANCELLED', 'REFUNDED'].includes(o.status);
                      return (
                        <div key={o.id} className="border border-slate-100 rounded p-1.5 flex justify-between gap-2 group">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                              <span>{String(o.ordered_at).slice(0, 10)}</span>
                              <span className="font-mono">{o.order_number}</span>
                            </div>
                            <p className="text-slate-700 truncate" title={names.join(', ')}>{head || '-'}{extra}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`whitespace-nowrap font-medium text-xs ${cancelled ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                              {Number(o.total_amount || 0).toLocaleString()}원
                            </span>
                            {!cancelled && (
                              <button
                                type="button"
                                onClick={() => {
                                  const warn = cart.length > 0
                                    ? '현재 장바구니 내용이 복사된 전표로 대체됩니다. 진행할까요?'
                                    : `${o.order_number} 전표를 복사해 새 판매로 등록할까요?`;
                                  if (confirm(warn)) applyCopy(o.id);
                                }}
                                title="이 전표를 복사해 새 판매 등록"
                                className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 opacity-70 group-hover:opacity-100"
                              >
                                📋 복사
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* 상담 작성 */}
              <div className="flex flex-col border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-semibold text-slate-600">새 상담 기록</span>
                  <select
                    value={consultType}
                    onChange={e => setConsultType(e.target.value)}
                    className="ml-auto text-xs py-0.5 px-1.5 border border-slate-200 rounded bg-white"
                  >
                    {CONSULT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <textarea
                  value={consultText}
                  onChange={e => setConsultText(e.target.value)}
                  placeholder={`고객 상태·주호소·권장 제품 등을 적으세요.\n이 내용은 고객 상담 이력으로 저장됩니다.`}
                  rows={6}
                  className="flex-1 p-2 text-xs resize-none focus:outline-none"
                />
                <div className="flex items-center justify-between p-2 border-t border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-slate-400">
                    {consultText.length > 0 ? `${consultText.length}자` : '결제와 별개로 저장됩니다'}
                  </span>
                  <button
                    type="button"
                    onClick={saveConsultation}
                    disabled={!consultText.trim() || savingConsult}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {savingConsult ? '저장 중...' : '상담 저장'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg py-6">
              고객을 선택하면 이력과 상담 작성 영역이 표시됩니다.
            </div>
          )}
        </div>

        {/* 하단 — 제품 검색/그리드 (축소) */}
        <div className="flex flex-col min-h-0 flex-1">
          <div className="mb-2">
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
          <div className="flex-1 overflow-auto pb-24 lg:pb-0">
            {loading ? (
              <p className="text-center text-slate-400 py-8">로딩 중...</p>
            ) : filteredProducts.length === 0 && search ? (
              <p className="text-center text-slate-400 py-8">검색 결과가 없습니다</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                {filteredProducts.map(product => {
                  const stock = getStock(product.id);
                  const inCart = cart.find(i => i.productId === product.id)?.quantity ?? 0;
                  // 음수 재고 정책: 품절(0) 또는 음수여도 클릭 가능. 빨강 배지로 시각 안내만.
                  const isOutOfStock = stock !== null && stock <= 0;
                  const isLow = stock !== null && stock > 0 && stock < 10;
                  return (
                    <button
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className={`bg-white p-2 rounded-md shadow-sm text-left border transition-all hover:border-blue-300 hover:shadow-md active:scale-95 ${
                        isOutOfStock ? 'border-red-200 bg-red-50/30' : 'border-slate-100'
                      } ${inCart > 0 ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
                    >
                      {product.barcode && (
                        <p className="text-[10px] text-slate-400 font-mono mb-0.5 truncate">{product.barcode}</p>
                      )}
                      <p className="font-medium text-slate-800 text-xs leading-tight line-clamp-2">{product.name}</p>
                      <p className="text-[10px] text-slate-400">{product.code}</p>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-sm font-bold text-blue-600">{product.price.toLocaleString()}원</p>
                        {inCart > 0 && (
                          <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{inCart}</span>
                        )}
                      </div>
                      <p className={`text-[10px] mt-0.5 ${
                        isOutOfStock ? 'text-red-500 font-semibold' :
                        isLow ? 'text-orange-500' : 'text-slate-400'
                      }`}>
                        {stock === null ? '\u00A0' : stock === 0 ? '품절 (판매 가능)' : stock < 0 ? `재고 ${stock} (판매 가능)` : `재고 ${stock}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 모바일 장바구니 토글 버튼 */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 p-3 bg-white border-t shadow-lg">
        <button
          onClick={() => setCartOpen(prev => !prev)}
          className="w-full btn-primary min-h-12 text-base font-semibold flex items-center justify-between px-4"
        >
          <span>🛒 장바구니 {cart.length > 0 ? `(${cart.length}종)` : ''}</span>
          <span>{cart.length > 0 ? `${total.toLocaleString()}원 →` : '비어있음'}</span>
        </button>
      </div>

      {cartOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setCartOpen(false)}
        />
      )}

      {/* 오른쪽: 장바구니 + 결제 */}
      <div className={`
        lg:w-[480px] lg:static lg:flex lg:flex-col lg:shrink-0
        fixed bottom-0 left-0 right-0 z-50 flex flex-col
        bg-white rounded-t-2xl lg:rounded-lg shadow
        transition-transform duration-300 ease-in-out
        ${cartOpen ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
        max-h-[90vh] lg:max-h-none lg:h-full
      `}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold">장바구니 {cart.length > 0 && <span className="text-sm font-normal text-slate-500">({cart.length}종)</span>}</h3>
          <div className="flex items-center gap-3">
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-red-400 hover:text-red-600">전체 삭제</button>
            )}
            <button onClick={() => setCartOpen(false)} className="lg:hidden text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* 장바구니 목록 */}
        <div className="flex-1 overflow-auto p-3 space-y-2 min-h-[140px] lg:min-h-[120px]">
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
              {/* 주문 옵션 (보자기/쇼핑백/혼합배송 등) */}
              <div className="flex items-center gap-1.5">
                {editingOptionId === item.productId ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      list={`opt-presets-${item.productId}`}
                      value={editingOptionVal}
                      onChange={e => setEditingOptionVal(e.target.value)}
                      onBlur={() => {
                        setCart(prev => prev.map(c => c.productId === item.productId ? { ...c, orderOption: editingOptionVal.trim() || undefined } : c));
                        setEditingOptionId(null); setEditingOptionVal('');
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          setCart(prev => prev.map(c => c.productId === item.productId ? { ...c, orderOption: editingOptionVal.trim() || undefined } : c));
                          setEditingOptionId(null); setEditingOptionVal('');
                        } else if (e.key === 'Escape') {
                          setEditingOptionId(null); setEditingOptionVal('');
                        }
                      }}
                      placeholder="예: 보자기 포장 / 택배 예정"
                      className="flex-1 border border-indigo-400 rounded text-xs px-2 py-1"
                    />
                    <datalist id={`opt-presets-${item.productId}`}>
                      {ORDER_OPTION_PRESETS.map(p => <option key={p} value={p} />)}
                    </datalist>
                  </>
                ) : item.orderOption ? (
                  <button
                    onClick={() => { setEditingOptionId(item.productId); setEditingOptionVal(item.orderOption || ''); }}
                    className="text-xs px-2 py-0.5 rounded border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  >
                    🎀 {item.orderOption} <span className="text-indigo-400">✎</span>
                  </button>
                ) : (
                  <button
                    onClick={() => { setEditingOptionId(item.productId); setEditingOptionVal(''); }}
                    className="text-xs px-2 py-0.5 rounded border border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-500"
                  >
                    + 주문 옵션
                  </button>
                )}
                {/* 품목별 배송 방식 */}
                <select
                  value={item.deliveryType || 'PICKUP'}
                  onChange={e => {
                    const newType = e.target.value as ItemDeliveryType;
                    setCart(prev => prev.map(c => c.productId === item.productId ? { ...c, deliveryType: newType } : c));
                  }}
                  className={`ml-auto text-xs py-0.5 px-1.5 rounded border focus:outline-none ${
                    item.deliveryType === 'PARCEL' ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : item.deliveryType === 'QUICK' ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600'
                  }`}
                  title="이 품목의 배송 방식"
                >
                  <option value="PICKUP">🏠 현장</option>
                  <option value="PARCEL">📦 택배</option>
                  <option value="QUICK">🛵 퀵</option>
                </select>
              </div>
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

        {/* 결제 옵션 영역 — 필요 시 스크롤. 결제 버튼은 별도 푸터로 분리(아래) */}
        <div className="p-4 border-t space-y-3 overflow-y-auto flex-shrink-0 max-h-[55vh] lg:max-h-[55%]">
          {/* 담당자 */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">담당자</label>
            <select
              value={handlerId}
              onChange={e => setHandlerId(e.target.value)}
              className="input text-sm flex-1"
            >
              {!orderedStaff.some(s => s.id === handlerId) && handlerId && (
                <option value={handlerId}>{initialUserName || '현재 로그인'}</option>
              )}
              {orderedStaff.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name}{u.branch_id === selectedBranch ? '' : ' (타 지점)'}
                </option>
              ))}
            </select>
            {handlerId !== initialUserId && initialUserId && (
              <button
                type="button"
                onClick={() => setHandlerId(initialUserId)}
                className="text-[11px] text-slate-400 hover:text-blue-600 whitespace-nowrap"
                title="내 담당으로"
              >↺ 나</button>
            )}
          </div>

          {/* 할인 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 whitespace-nowrap">할인</span>
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

          {/* 포인트 사용 */}
          {selectedCustomer && (selectedCustomer.currentPoints ?? 0) > 0 && (
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
                포인트 사용 (보유 {(selectedCustomer.currentPoints || 0).toLocaleString()}P)
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

          {/* 수령현황 + 수령일자 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">수령 현황</label>
              <select
                value={receiptStatus}
                onChange={e => {
                  const newStatus = e.target.value as ReceiptStatus;
                  setReceiptStatus(newStatus);
                  // 카트 품목 일괄 배송방식 동기화 (effect는 품목→상태 집계만 하므로 역방향 명시 필요)
                  const newDType: ItemDeliveryType =
                    newStatus === 'QUICK_PLANNED' ? 'QUICK'
                    : newStatus === 'PARCEL_PLANNED' ? 'PARCEL'
                    : 'PICKUP';
                  setCart(prev => prev.map(it => it.deliveryType === newDType ? it : { ...it, deliveryType: newDType }));
                  // 배송 탭도 명시 세팅
                  const newShipType: DeliveryType =
                    newDType === 'PARCEL' ? 'PARCEL'
                    : newDType === 'QUICK' ? 'QUICK'
                    : 'NONE';
                  setShipping(prev => prev.type === newShipType ? prev : { ...prev, type: newShipType });
                }}
                className="input text-sm py-1.5"
              >
                {(['RECEIVED', 'PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED'] as ReceiptStatus[]).map(s => (
                  <option key={s} value={s}>{RECEIPT_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">수령(예정) 일자</label>
              <input
                type="date"
                value={receiptDate}
                onChange={e => setReceiptDate(e.target.value)}
                className="input text-sm py-1.5"
              />
            </div>
          </div>

          {/* 승인 상태 */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">승인</label>
            <select
              value={approvalStatus}
              onChange={e => setApprovalStatus(e.target.value as ApprovalStatus)}
              className="input text-sm py-1.5 w-full"
            >
              {(['COMPLETED', 'CARD_PENDING', 'UNSETTLED'] as ApprovalStatus[]).map(s => (
                <option key={s} value={s}>{APPROVAL_STATUS_LABEL[s]}</option>
              ))}
            </select>
            {approvalStatus !== 'COMPLETED' && (
              <p className={`text-[11px] mt-1 ${approvalStatus === 'UNSETTLED' ? 'text-amber-600' : 'text-indigo-600'}`}>
                {approvalStatus === 'UNSETTLED' ? '⚠ 미결 건: 수금 후 결제완료로 변경' : '⚠ 카드 키인 승인 대기 — 승인 후 결제완료로 변경'}
              </p>
            )}
          </div>

          {/* 주문 메모 */}
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

          {/* 배송: 없음 / 택배 / 퀵 */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex border-b border-slate-200 bg-slate-50 text-xs">
              {([
                { v: 'NONE' as DeliveryType, label: '배송 없음' },
                { v: 'PARCEL' as DeliveryType, label: '택배 배송' },
                { v: 'QUICK' as DeliveryType, label: '퀵배송' },
              ]).map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => {
                    setShipping(prev => ({ ...prev, type: opt.v }));
                    // 탭 전환 시 모든 품목 일괄 적용
                    const newDType: ItemDeliveryType =
                      opt.v === 'PARCEL' ? 'PARCEL' : opt.v === 'QUICK' ? 'QUICK' : 'PICKUP';
                    setCart(prev => prev.map(it => it.deliveryType === newDType ? it : { ...it, deliveryType: newDType }));
                    // 빈 카트 대비: 수령현황도 명시 세팅 (cart가 비어있으면 집계 effect가 돌지 않음)
                    setReceiptStatus(
                      opt.v === 'PARCEL' ? 'PARCEL_PLANNED'
                      : opt.v === 'QUICK' ? 'QUICK_PLANNED'
                      : 'RECEIVED'
                    );
                  }}
                  className={`flex-1 py-1.5 font-medium transition-colors ${shipping.type === opt.v
                    ? 'bg-white text-blue-600 border-b-2 border-blue-500 -mb-px'
                    : 'text-slate-500 hover:bg-white/60'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {shipping.type !== 'NONE' && (() => {
              const pickupCnt = cart.filter(c => (c.deliveryType || 'PICKUP') === 'PICKUP').length;
              const parcelCnt = cart.filter(c => c.deliveryType === 'PARCEL').length;
              const quickCnt = cart.filter(c => c.deliveryType === 'QUICK').length;
              const isMixed = pickupCnt > 0 && (parcelCnt > 0 || quickCnt > 0);
              return (
              <div className="p-3 space-y-3">
                {isMixed && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    ⚠ 혼합: 🏠 현장 {pickupCnt}품목 · {shipping.type === 'QUICK' ? '🛵 퀵' : '📦 택배'} {shipping.type === 'QUICK' ? quickCnt : parcelCnt}품목
                    <span className="block mt-0.5 text-[10px] text-amber-600">현장 품목은 즉시 수령, 배송 품목만 아래 주소로 발송됩니다.</span>
                  </p>
                )}
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

                {shipping.type === 'QUICK' && (
                  <p className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">
                    🛵 퀵배송: 당일 인편. 송장/알림톡 없이 인수자 확인 후 상태 업데이트 권장.
                  </p>
                )}

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
                  <input type="text"
                    placeholder={shipping.type === 'QUICK' ? '퀵 기사 전달 메시지 (선택)' : '배송 메시지 (선택)'}
                    value={shipping.delivery_message}
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
              );
            })()}
          </div>

          {/* 결제 수단 */}
          {isDeptStore && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-purple-50 rounded-lg border border-purple-200">
              <span className="text-xs text-purple-700 font-medium">🏬 백화점 모드</span>
              <span className="text-xs text-purple-500">카드 결제는 백화점 단말기에서 처리</span>
            </div>
          )}
          <div className="grid grid-cols-4 gap-1.5">
            {(isDeptStore
              ? [
                  { id: 'card' as const, label: '카드 (백화점)' },
                  { id: 'cash' as const, label: '현금' },
                  { id: 'credit' as const, label: '외상' },
                ]
              : [
                  { id: 'cash' as const, label: '현금' },
                  { id: 'card' as const, label: '카드' },
                  { id: 'credit' as const, label: '외상' },
                  { id: 'cod' as const, label: '수령시수금' },
                ]
            ).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => {
                  setPaymentMethod(id as PaymentMethodId);
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

          {/* 분할 결제 */}
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
                        {(['cash','card','credit','cod'] as PaymentMethodId[]).map(m => (
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
                      onClick={() => setExtraPayments(prev => [...prev, { method: 'credit', amount: Math.max(0, primaryAmt) }])}
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

          {/* 백화점 카드 결제 수기 입력 */}
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

        </div>

        {/* 하단 고정 결제 푸터 — 결제 금액 한 줄 + 결제 버튼. 우측 칼럼 최하단에 항상 노출. */}
        <div className="border-t bg-white px-4 py-3 flex-shrink-0 space-y-2 lg:rounded-b-lg">
          <div className="flex justify-between items-baseline">
            <span className="text-xs text-slate-500">결제 금액</span>
            <span className={`text-lg font-bold ${(discountAmount > 0 || (usePoints && pointsToUse > 0)) ? 'text-red-600' : 'text-blue-700'}`}>
              {finalAmount.toLocaleString()}원
            </span>
          </div>
          {(() => {
            const disabledReason =
              cart.length === 0 ? '장바구니에 품목을 추가하세요'
              : !selectedBranch ? '매출처를 선택하세요'
              : !handlerId ? '담당자를 선택하세요'
              : (paymentMethod === 'cash' && cashReceivedNum > 0 && change < 0)
                  ? `받은 금액이 결제 금액보다 ${Math.abs(change).toLocaleString()}원 부족합니다`
              : null;
            return (
              <>
                <button
                  onClick={handlePayment}
                  disabled={!!disabledReason || processing}
                  className="w-full btn-primary py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing ? '처리 중...' : `결제 (${finalAmount.toLocaleString()}원) · ${handlerName}`}
                </button>
                {disabledReason && (
                  <p className="text-xs text-amber-600 text-center mt-0.5">⚠ {disabledReason}</p>
                )}
              </>
            );
          })()}
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

      {showDraftModal && (
        <DraftListModal
          drafts={drafts}
          loading={draftLoading}
          currentDraftId={currentDraftId}
          onLoad={handleLoadDraft}
          onDelete={handleDeleteDraft}
          onClose={() => setShowDraftModal(false)}
        />
      )}
    </div>
      )}
    </div>
  );
}

// ── 임시저장 목록 모달 ────────────────────────────────────────────────────────
function DraftListModal({ drafts, loading, currentDraftId, onLoad, onDelete, onClose }: {
  drafts: DraftRow[];
  loading: boolean;
  currentDraftId: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const fmtTime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}시간 전`;
    return d.toISOString().slice(5, 16).replace('T', ' ');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl mx-auto max-h-[88vh] overflow-y-auto rounded-xl shadow-xl"
           onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold text-slate-800">📂 임시저장 전표 불러오기</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              총 {drafts.length}건 · 카드를 클릭해 이어서 작성하세요. 결제 완료 시 자동 정리됩니다.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">로딩 중...</div>
          ) : drafts.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              저장된 임시 전표가 없습니다.
              <p className="text-xs mt-1.5">판매 등록 화면에서 <span className="font-medium">💾 임시저장</span> 버튼을 눌러 보관할 수 있습니다.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {drafts.map(d => {
                const isCurrent = d.id === currentDraftId;
                const customerLabel = d.customer?.name
                  || d.customer_snapshot?.name
                  || '비회원';
                const phone = d.customer?.phone || d.customer_snapshot?.phone || '';
                const itemNames = (d.cart_items || []).slice(0, 3).map((c: any) => c.name).filter(Boolean);
                const moreCount = Math.max(0, (d.cart_items?.length || 0) - itemNames.length);
                return (
                  <div key={d.id}
                       className={`border rounded-lg p-3 transition-colors ${
                         isCurrent
                           ? 'border-amber-300 bg-amber-50/60'
                           : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                       }`}>
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onLoad(d.id)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-slate-800 truncate">
                            {customerLabel}
                          </span>
                          {phone && (
                            <span className="text-[11px] text-slate-400">{phone}</span>
                          )}
                          {isCurrent && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 font-medium">
                              ✏️ 작성 중
                            </span>
                          )}
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                            {d.branch?.name || ''}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 mt-1 line-clamp-2">
                          {itemNames.join(' · ')}
                          {moreCount > 0 && <span className="text-slate-400"> 외 {moreCount}</span>}
                          <span className="ml-2 text-slate-400">· {d.item_count}종</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700">
                            {(d.total_amount || 0).toLocaleString()}원
                          </span>
                          <span className="text-slate-300">·</span>
                          <span title={d.updated_at}>{fmtTime(d.updated_at)}</span>
                          {d.creator?.name && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span>{d.creator.name}</span>
                            </>
                          )}
                          {d.memo && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span className="truncate text-slate-400" title={d.memo}>📝 {d.memo}</span>
                            </>
                          )}
                        </div>
                      </button>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onLoad(d.id)}
                          className="px-3 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
                        >
                          불러오기
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(d.id)}
                          className="px-3 py-1 rounded text-xs text-red-500 hover:bg-red-50"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
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
