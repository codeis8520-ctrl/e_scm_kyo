'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getShipments, createShipment, updateShipment, deleteShipment, bulkUpdateShipmentStatus, getShipmentWritebackFailures } from '@/lib/shipping-actions';
import { refreshCafe24Token, registerCafe24Customers, createCafe24ProductMap, deleteCafe24ProductMap } from '@/lib/cafe24-actions';
import { getProducts } from '@/lib/actions';
import * as XLSX from 'xlsx';
import { fmtDateKST, kstTodayString } from '@/lib/date';
import PageTabs from '@/components/PageTabs';
import SmartstoreImportModal from './SmartstoreImportModal';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

interface Shipment {
  id: string;
  source: 'CAFE24' | 'STORE';
  sale_branch_name?: string | null;   // 매출처(연결 sales_order의 지점) — #21
  sale_receipt_date?: string | null;   // 수령일/택배예정일(연결 sales_order) — #26
  order_options?: string | null;   // 주문 옵션(연결 sales_order_items.order_option 도출) — #40
  cafe24_order_id: string | null;
  branch_id: string | null;
  sender_name: string;
  sender_phone: string;
  sender_address: string | null;
  sender_address_detail: string | null;
  sender_zipcode: string | null;
  recipient_name: string;
  recipient_phone: string;
  recipient_zipcode: string | null;
  recipient_address: string;
  recipient_address_detail: string | null;
  delivery_message: string | null;
  items_summary: string | null;
  tracking_number: string | null;
  status: 'PENDING' | 'PRINTED' | 'SHIPPED' | 'DELIVERED';
  created_at: string;
}

interface Cafe24OrderForShipping {
  cafe24_order_id: string;
  member_id?: string;
  order_date: string;
  orderer_name: string;
  orderer_phone: string;
  orderer_email?: string;
  orderer_address?: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  delivery_message: string;
  items_summary: string;
  order_items?: { name: string; quantity: number; price: number; option: string; product_code: string; option_value: string; mapped_name: string | null }[];
  total_price: number;
  already_added: boolean;
  cafe24_status: string;
  customer_match?: { id: string; name: string } | null;
  customer_review?: boolean;   // #67: 휴대폰 일치·이름 불일치(또는 동일번호 다중) → 확인 필요
  is_dup?: boolean;
}

const CAFE24_STATUS_LABEL: Record<string, string> = {
  N: '입금전', F: '결제완료', M: '배송준비중',
  A: '배송중', B: '배송완료', C: '취소', R: '반품', E: '교환',
};
const CAFE24_STATUS_BADGE: Record<string, string> = {
  N: 'badge', F: 'badge badge-info', M: 'badge badge-info',
  A: 'badge badge-warning', B: 'badge badge-success',
  C: 'badge badge-error', R: 'badge badge-error', E: 'badge badge-error',
};

// 매칭 신뢰도 단계
//   rtc        — 내품명 컬럼에 박힌 round-trip code(KX-xxxxxxxx) 가 정확히 일치 → 신뢰 (구 export 파일 하위호환)
//   name_item  — 받는분 이름 + 품목명 조합이 정확히 일치하는 배송이 1건 → 자동 반영
//   ambiguous  — 이름+품목이 2건 이상 일치, 또는 품목은 다르나 이름이 일치(불확실) → 사용자 명시적 선택 필요
//   unmatched  — RTC·이름+품목·이름 어느 것으로도 대응 shipment 없음
// ※ 택배사 프로그램 다운로드 시 전화번호가 010-1111-****로 마스킹되어 전화 매칭이 부정확 → 이름+품목 기준으로 전환(#32)
type ImportConfidence = 'rtc' | 'name_item' | 'ambiguous' | 'unmatched';

interface ImportRow {
  trackingNo: string;
  matchName: string;                 // 임포트 행의 받는분 이름
  matchItems: string;                // 임포트 행의 품목명
  matchPhone: string;                // 참고용(마스킹 가능)
  matchRtc: string | null;          // 행에서 추출한 RTC (예: 'a3b1c2d4'), 없으면 null
  rawRow: string[];
  matched: Shipment | null;          // 확정 매칭. ambiguous면 사용자 선택 후 채워짐
  candidates: Shipment[];            // ambiguous 시 후보 목록
  confidence: ImportConfidence;
  alreadyHas: boolean;
}

type TabType = 'cafe24' | 'manual' | 'list';
type StatusFilter = 'ALL' | 'PENDING' | 'SHIPPED' | 'DELIVERED';

// 버킷 → 실제 status 매핑. 대기중=대기+출력완료(미발송), 발송완료=SHIPPED(미배송 처리대상), 배송완료=DELIVERED(종결).
const PENDING_STATES = ['PENDING', 'PRINTED'] as const;
// 필터 버튼 라벨(행 뱃지용 STATUS_LABEL 과 분리)
const BUCKET_LABEL: Record<StatusFilter, string> = {
  ALL: '전체', PENDING: '대기중', SHIPPED: '발송완료', DELIVERED: '배송완료',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: '대기중', PRINTED: '출력완료', SHIPPED: '발송완료', DELIVERED: '배송완료',
};
const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge', PRINTED: 'badge badge-info',
  SHIPPED: 'badge badge-warning', DELIVERED: 'badge badge-success',
};
const SOURCE_BADGE: Record<string, string> = {
  CAFE24: 'badge badge-info', STORE: 'badge badge-success',
};

// 그리드 셀 잘림 텍스트 — 클릭하면 펼쳐지고(줄바꿈), 다시 클릭하면 접힘. 호버 시 title로 미리보기.
function TruncatedCell({
  text, className = '', maxWidth = '', empty = '-',
}: {
  text: string | null | undefined;
  className?: string;
  maxWidth?: string;
  empty?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = (text ?? '').trim();
  if (!t) return <span className="text-slate-300 text-sm">{empty}</span>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded(v => !v)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
      title={expanded ? '클릭하여 접기' : t}
      className={`text-sm cursor-pointer hover:text-blue-600 transition-colors ${
        expanded ? 'whitespace-pre-wrap break-words' : `truncate ${maxWidth}`
      } ${className}`}
    >
      {t}
    </div>
  );
}

// #46: 배송메시지 = 순수 delivery_message(고객 직접입력 배송요청)만.
//   포장/옵션(order_options)은 더 이상 메시지에 합성하지 않고 별도 컬럼으로 노출한다.
//   (#40 포장 가시성 보존: 배송목록 '포장/옵션' 셀 + CJ export '배송메세지2' 컬럼=송장 라벨에 분리 인쇄.)
function composeDeliveryMessage(s: { delivery_message?: string | null }): string {
  return (s.delivery_message ?? '').trim();
}

export default function ShippingPage({ embedded }: { embedded?: 'online' | 'parcel' } = {}) {
  const [activeTab, setActiveTab] = useState<TabType>(
    embedded === 'parcel' ? 'list' : 'cafe24'
  );
  const [showSmartstore, setShowSmartstore] = useState(false);

  // ── Cafe24 탭 ─────────────────────────────────────────────────────────────
  const today = new Date();
  const oneWeekAgo = new Date(today);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  // KST 기준 YYYY-MM-DD. Cafe24 API는 calendar date만 받으므로 그대로 전달 가능.
  const fmt = (d: Date) => fmtDateKST(d);
  const [startDate, setStartDate] = useState(fmt(oneWeekAgo));
  const [endDate, setEndDate] = useState(fmt(today));
  const [cafe24Orders, setCafe24Orders] = useState<Cafe24OrderForShipping[]>([]);
  const [cafe24Loading, setCafe24Loading] = useState(false);
  const [cafe24Error, setCafe24Error] = useState('');
  const [isDemo, setIsDemo] = useState(false);
  const [demoReason, setDemoReason] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [addingOrders, setAddingOrders] = useState(false);
  const [addError, setAddError] = useState('');
  const [custSelected, setCustSelected] = useState<Set<string>>(new Set());
  const [registering, setRegistering] = useState(false);
  const [registerMsg, setRegisterMsg] = useState('');
  // 카페24 매장 발송지(출고지) — 모든 카페24 주문에 공통 적용
  // ── 직접 입력 탭 ──────────────────────────────────────────────────────────
  const [manualForm, setManualForm] = useState({
    sender_name: '', sender_phone: '', sender_address: '',
    recipient_name: '', recipient_phone: '', recipient_zipcode: '',
    recipient_address: '', recipient_address_detail: '',
    delivery_message: '', items_summary: '',
  });
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState('');

  // DB 검색 (발송자 / 수령자)
  const [senderSearch, setSenderSearch] = useState('');
  const [senderResults, setSenderResults] = useState<any[]>([]);
  const [showSenderDrop, setShowSenderDrop] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientResults, setRecipientResults] = useState<any[]>([]);
  const [showRecipientDrop, setShowRecipientDrop] = useState(false);
  const senderInputRef = useRef<HTMLInputElement>(null);
  const recipientInputRef = useRef<HTMLInputElement>(null);

  // ── 카페24 탭 검색 필터 ───────────────────────────────────────────────────
  const [cafe24Search, setCafe24Search]           = useState('');
  const [cafe24StatusFilter, setCafe24StatusFilter] = useState('');
  const [cafe24HideAdded, setCafe24HideAdded]     = useState(true);  // 기본 '미추가만 보기' — 처리 대상 집중 + 렌더 경량화
  const [cafe24Loaded, setCafe24Loaded]           = useState(false); // 1회 이상 불러오기 완료 여부(0건이어도 필터/안내 노출용)

  // ── 카페24 품목 매핑 (본사 전용 연결/해제) ────────────────────────────────
  const userRole = getCookie('user_role');
  const isHQ = userRole === 'SUPER_ADMIN' || userRole === 'HQ_OPERATOR';
  // #62 Phase2: 카페24 송장 역연동 실패건(본사 전용 표시 — 주문번호+사유)
  const [writebackFailures, setWritebackFailures] = useState<{ cafe24_order_id: string; error_message: string | null; processed_at: string | null }[]>([]);
  const [showWritebackFailures, setShowWritebackFailures] = useState(false);
  const [allProducts, setAllProducts] = useState<{ id: string; name: string; code: string }[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  // 현재 제품 검색 패널이 열린 item 키(order_id::index) + 검색어
  const [mappingKey, setMappingKey] = useState<string | null>(null);
  const [mappingSearch, setMappingSearch] = useState('');
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mappingError, setMappingError] = useState('');

  // ── 카페24 토큰 갱신 상태 ─────────────────────────────────────────────────
  // 결제완료 매출 동기화는 GitHub Actions(매일 08:00 / 18:00 KST)가 자동 처리.
  // /api/cafe24/sync-orders 크론 엔드포인트가 syncCafe24PaidOrdersCore를 호출.
  const [tokenRefreshing, setTokenRefreshing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const handleRefreshToken = async () => {
    setTokenRefreshing(true);
    setSyncMessage('');
    const r = await refreshCafe24Token();
    setSyncMessage((r.success ? '✅ ' : '❌ ') + r.message);
    setTokenRefreshing(false);
  };

  // ── 배송 목록 탭 ──────────────────────────────────────────────────────────
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  // 배송완료(종결) 숨기기 — 기본 ON. 전체/대기중/발송완료 뷰에서 배송완료 제외(배송완료 버킷 직접선택 시엔 무시).
  const [hideDelivered, setHideDelivered] = useState(true);
  // 택배관리 정렬 기준 — 사용자 선택(콤보)
  const [shipSort, setShipSort] = useState<'receipt_desc' | 'latest' | 'oldest'>('receipt_desc');
  const [listSearch, setListSearch] = useState('');
  const [listStartDate, setListStartDate] = useState(fmt(oneWeekAgo));
  const [listEndDate, setListEndDate] = useState(fmt(today));
  const [editShipment, setEditShipment] = useState<Shipment | null>(null);
  const [editForm, setEditForm] = useState<Partial<Shipment>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // 엑셀 임포트 (송장번호)
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importStep, setImportStep] = useState<0 | 1 | 2>(0); // 0=닫힘, 1=컬럼선택, 2=미리보기
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRawRows, setImportRawRows] = useState<string[][]>([]);
  const [importTrackingCol, setImportTrackingCol] = useState(0);
  const [importNameCol, setImportNameCol] = useState(1);   // 받는분 이름 열 (#32 매칭 기준)
  const [importItemCol, setImportItemCol] = useState(2);   // 품목명 열 (#32 매칭 기준)
  const [importPhoneCol, setImportPhoneCol] = useState(-1); // 참고용(마스킹 가능), 없으면 -1
  const [importPreview, setImportPreview] = useState<ImportRow[]>([]);
  const [importSaving, setImportSaving] = useState(false);

  // 배송 목록 선택
  const [selectedShipments, setSelectedShipments] = useState<Set<string>>(new Set());


  // ── 대한통운 엑셀 발송지(보내는분) 선택 ───────────────────────────────────
  interface BranchSender {
    id: string; name: string; is_headquarters: boolean;
    address: string | null; phone: string | null;
    // migration 063 신규 컬럼 (적용 전이면 undefined)
    sender_name?: string | null; sender_phone?: string | null;
    sender_zipcode?: string | null; sender_address?: string | null;
    sender_address_detail?: string | null;
  }
  const [branchSenders, setBranchSenders] = useState<BranchSender[]>([]);

  // 지점 발송지 목록 로드
  // ⚠️ 마이그 063 (branches.sender_*) 미적용 환경 폴백 — 신규 컬럼 SELECT 실패 시 기본 컬럼만.
  useEffect(() => {
    (async () => {
      const sb = createClient() as any;

      // 1차: 마이그 063 신규 컬럼 포함
      let res = await sb.from('branches')
        .select('id, name, is_headquarters, address, phone, sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail')
        .eq('is_active', true)
        .order('is_headquarters', { ascending: false })
        .order('name');

      // 2차: sender_* 컬럼 없음 폴백
      if (res.error) {
        console.warn('[shipping] branches sender_* 컬럼 미적용 폴백 (마이그 063):', res.error.message);
        res = await sb.from('branches')
          .select('id, name, is_headquarters, address, phone')
          .eq('is_active', true)
          .order('is_headquarters', { ascending: false })
          .order('name');
      }
      // 3차: is_headquarters 도 없음 (마이그 047 미적용)
      if (res.error) {
        console.warn('[shipping] branches is_headquarters 미적용 폴백:', res.error.message);
        res = await sb.from('branches')
          .select('id, name, address, phone')
          .eq('is_active', true)
          .order('name');
      }
      if (res.error) {
        console.error('[shipping] branches 페치 실패:', res.error);
        return;
      }

      const list = (res.data || []) as BranchSender[];
      setBranchSenders(list);
    })();
  }, []);

  // #62 Phase2: 카페24 송장 역연동 실패건 로드(본사 전용). 실패만 표시 — 없으면 배너 미노출.
  useEffect(() => {
    if (!isHQ) return;
    (async () => {
      const res = await getShipmentWritebackFailures();
      if (!res.error && res.rows) setWritebackFailures(res.rows);
    })();
  }, [isHQ]);

  // ── Daum 우편번호 스크립트 로드 ──────────────────────────────────────────
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  const openDaumPostcode = (onComplete: (zipcode: string, address: string) => void) => {
    new (window as any).daum.Postcode({
      oncomplete(data: any) {
        onComplete(data.zonecode, data.roadAddress || data.address);
      },
    }).open();
  };

  // ── 초기 로드 ─────────────────────────────────────────────────────────────
  const fetchShipments = async () => {
    setListLoading(true);
    try {
      const result = await getShipments();
      setShipments(result.data as Shipment[]);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'list') fetchShipments();
  }, [activeTab]);

  // ── DB 검색: 발송자 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (senderSearch.length < 1) { setSenderResults([]); setShowSenderDrop(false); return; }
    const supabase = createClient();
    const q = senderSearch.toLowerCase();
    const s = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    supabase.from('customers').select('id,name,phone,address').eq('is_active', true)
      .or(`name.ilike."%${s}%",phone.ilike."%${s}%"`)
      .limit(8)
      .then(({ data }) => {
        setSenderResults(data || []);
        setShowSenderDrop(true);
      });
  }, [senderSearch]);

  const selectSender = (c: any) => {
    setManualForm(f => ({
      ...f,
      sender_name: c.name,
      sender_phone: c.phone,
      sender_address: c.address || '',
    }));
    setSenderSearch('');
    setSenderResults([]);
    setShowSenderDrop(false);
  };

  // ── DB 검색: 수령자 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (recipientSearch.length < 1) { setRecipientResults([]); setShowRecipientDrop(false); return; }
    const supabase = createClient();
    const q = recipientSearch.toLowerCase();
    const s = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    supabase.from('customers').select('id,name,phone,address').eq('is_active', true)
      .or(`name.ilike."%${s}%",phone.ilike."%${s}%"`)
      .limit(8)
      .then(({ data }) => {
        setRecipientResults(data || []);
        setShowRecipientDrop(true);
      });
  }, [recipientSearch]);

  const selectRecipient = (c: any) => {
    // address: "서울시 강남구 테헤란로 123 101동 201호" 형태 → 분할 시도
    setManualForm(f => ({
      ...f,
      recipient_name: c.name,
      recipient_phone: c.phone,
      recipient_address: c.address || '',
    }));
    setRecipientSearch('');
    setRecipientResults([]);
    setShowRecipientDrop(false);
  };

  // #65: 출고처(재고 차감 지점) 표시 — shipment.branch_id 가 출고지점.
  //   cafe24 행(branch_id=NULL)은 본사를 출고지점으로 간주(발송지 해결과 동일 규칙).
  //   '동일' 등 상대표현 금지 → 항상 실제 지점/창고명 노출.
  const resolveShipFromName = (s: Shipment): string => {
    const branch = (s.branch_id && branchSenders.find(b => b.id === s.branch_id))
      || branchSenders.find(b => b.is_headquarters)
      || branchSenders[0]
      || null;
    return branch?.name || '-';
  };

  // ── 행별 발송지(보내는분) 자동 해결 ──────────────────────────────────────
  // 정책 (Project Owner 확정):
  //  - 이름/전화: 저장된 shipment.sender_* 우선 → 출고지점 branch.sender_* → 기본 폴백.
  //  - 주소/우편번호: 항상 출고지점 발송지(구매자 주소 절대 아님). sender_address 없으면 branch.address.
  //  - cafe24 행(branch_id=NULL): 본사 지점을 출고지점으로 간주, 없으면 branchSenders[0].
  // 반환값에 빈칸이 남으면 가드가 export 를 막는다.
  const resolveSenderForRow = (s: Shipment) => {
    const branch = (s.branch_id && branchSenders.find(b => b.id === s.branch_id))
      || branchSenders.find(b => b.is_headquarters)
      || branchSenders[0]
      || null;

    const branchName = branch
      ? (branch.sender_name ?? (branch.name.includes('경옥채') ? branch.name : `경옥채 ${branch.name}`))
      : '';
    const branchPhone = branch ? (branch.sender_phone ?? branch.phone ?? '') : '';
    const branchAddress = branch ? (branch.sender_address ?? branch.address ?? '') : '';
    const branchAddressDetail = branch ? (branch.sender_address_detail ?? '') : '';
    const branchZipcode = branch ? (branch.sender_zipcode ?? '') : '';

    const rawName = (s.sender_name && s.sender_name.trim()) || branchName;
    const rawPhone = (s.sender_phone && s.sender_phone.trim()) || branchPhone;

    // 본인 발송(보내는분=받는분) → 회사명 '더경옥' + 회사(출고지점) 발신 전화로 대체.
    //   #39: 전화도 함께 대체하지 않으면 받는분(=본인) 전화가 보내는분 전화로 새어 동일하게 출력됨.
    //   선물 등 보내는분≠받는분 이면 실제 보내는분 이름·전화 유지.
    const isCompanySelf = !!(rawName && s.recipient_name && rawName.trim() === s.recipient_name.trim());
    const name = isCompanySelf ? '더경옥' : rawName;
    const phone = isCompanySelf ? branchPhone : rawPhone;

    return {
      name: name || '',
      phone: phone || '',
      address: branchAddress || '',
      addressDetail: branchAddressDetail || '',
      zipcode: branchZipcode || '',
    };
  };

  // 가드: 모든 target 행의 발송지를 해결, 이름/전화/주소 중 하나라도 빈 행이 있으면
  // export 를 막고 수령자명을 나열해 alert. 조용한 빈칸 export 금지.
  const guardSenders = (targets: Shipment[]): boolean => {
    const unresolved = targets.filter(s => {
      const r = resolveSenderForRow(s);
      return !r.name.trim() || !r.phone.trim() || !r.address.trim();
    });
    if (unresolved.length > 0) {
      const names = unresolved.map(s => s.recipient_name || '(수령자명 없음)').join(', ');
      alert(`발송지(보내는분) 정보를 확정할 수 없는 행이 있습니다: ${names}. 출고 지점의 발송지 정보(지점 관리)를 먼저 등록해주세요.`);
      return false;
    }
    return true;
  };

  // ── 대한통운 엑셀 다운로드 ────────────────────────────────────────────────
  // 정책: 행 체크박스로 선택한 건만 추출 (전체 일괄 추출은 의도치 않은 대량 발송 위험).
  // 발송지는 행별로 자동 해결(resolveSenderForRow) — 모달 없음.
  const downloadCjExcel = async () => {
    if (selectedShipments.size === 0) {
      alert('대한통운 엑셀로 추출할 행을 좌측 체크박스로 먼저 선택해주세요.');
      return;
    }
    // 선택된 행만 export — 정렬은 화면 순서(filteredShipments) 유지
    const targets = filteredShipments.filter(s => selectedShipments.has(s.id));
    if (targets.length === 0) { alert('선택된 행이 없습니다.'); return; }
    if (!guardSenders(targets)) return;

    // 실제 CJ대한통운 임포트 양식과 정확히 일치(12컬럼). 배송메세지2·보내는분우편번호 컬럼은
    //   실제 양식에 없어 추가 시 임포트 오류 위험 → 제외. (사용자 제공 '택배기본 (경옥채-CJ대한통운).xlsx' 기준)
    const header = [
      '받는분성명', '받는분전화번호', '받는분기타연락처',
      '받는분주소(전체, 분할)', '배송메세지1',
      '품목명', '내품명', '내품수량', '운임구분',
      '보내는분성명', '보내는분전화번호', '보내는분주소(전체, 분할)',
    ];
    // #46: 배송메세지1 = 고객 직접입력 배송요청만(순수). 포장/옵션은 품목명에 ' / '로 병기
    //   (CJ 관행 — 실제 양식엔 옵션 전용 컬럼이 없어 품목명에 구분값으로 함께 기재. 송장에도 품목명으로 인쇄됨).
    // #30: 내품명(G열)은 비움 — 송장에 코드성 문자열 노출 금지.
    //   보내는분성명(J열): 본인 발송이면 '더경옥', 다르면 실제 보내는분(선물 등).
    const rows = targets.map(s => {
      const sender = resolveSenderForRow(s);
      const senderFullAddress = [sender.address, sender.addressDetail].filter(Boolean).join(' ');
      const opt = (s.order_options ?? '').trim();
      const itemName = (s.items_summary || '') + (opt ? ` / ${opt}` : '');
      return [
        s.recipient_name, s.recipient_phone, '',
        [s.recipient_address, s.recipient_address_detail].filter(Boolean).join(' '),
        composeDeliveryMessage(s),   // 배송메세지1 = 순수 배송요청
        itemName,                    // 품목명 + (옵션 병기)
        '',                 // 내품명 — 비움(#30)
        '', '선불',
        sender.name, sender.phone, senderFullAddress,
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 50 }, { wch: 30 },
      { wch: 30 }, { wch: 16 }, { wch: 8 }, { wch: 8 },
      { wch: 12 }, { wch: 16 }, { wch: 40 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'sheet1');
    XLSX.writeFile(wb, `CJ대한통운_${kstTodayString().replace(/-/g, '')}.xlsx`);

    // ─── 상태 자동 전환: PENDING → PRINTED ──────────────────────────────
    // CJ 엑셀 다운로드 = "출력 명단 확정" 의미. PENDING 만 PRINTED 로 전환.
    // (이미 PRINTED/SHIPPED/DELIVERED 인 건은 그대로 — 운영 중에 재다운로드 케이스 보호)
    const pendingIds = targets.filter(s => s.status === 'PENDING').map(s => s.id);
    if (pendingIds.length > 0) {
      try {
        const sb = createClient() as any;
        const { error } = await sb
          .from('shipments')
          .update({ status: 'PRINTED', updated_at: new Date().toISOString() })
          .in('id', pendingIds)
          .eq('status', 'PENDING');  // race condition 가드
        if (error) {
          console.error('[shipping] PENDING → PRINTED 전환 실패:', error);
        } else {
          await fetchShipments();
          // 사용자에게 피드백 — 별도 alert 으로 다운로드와 분리해 인지하게
          setTimeout(() => {
            alert(`${pendingIds.length}건의 배송 상태가 "출력완료(PRINTED)" 로 전환되었습니다.\n실제로 CJ 임포트를 진행하지 않았다면 각 행에서 상태를 되돌릴 수 있습니다.`);
          }, 100);
        }
      } catch (e) {
        console.error('[shipping] 상태 전환 예외:', e);
      }
    }
  };

  // ── 엑셀 임포트 (송장번호) ────────────────────────────────────────────────
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][];
      if (rows.length < 2) { alert('데이터가 없습니다.'); return; }
      const headers = rows[0].map(String);
      const dataRows = rows.slice(1).filter(r => r.some(c => String(c).trim()));
      setImportHeaders(headers);
      setImportRawRows(dataRows.map(r => r.map(String)));
      // 송장번호 열 자동 감지(#66): 헤더 '운송장/송장' 우선(CJ export '운송장번호') →
      //   없으면 데이터 패턴(10~13자리 숫자). 헤더 우선이라 마스킹 전화 등 다른 숫자열 오선택 방지.
      const trackByHeader = headers.findIndex(h => /운송장|송장/.test(String(h)));
      const trackIdx = trackByHeader >= 0 ? trackByHeader : headers.findIndex((_, i) =>
        dataRows.slice(0, 5).some(r => /^\d{10,13}$/.test(String(r[i] || '').replace(/\D/g, '')))
      );
      // 받는분 이름 열: 헤더에 받는/수령/수취/성명/이름/고객 포함 (CJ export 헤더 '받는분성명')
      const nameIdx = headers.findIndex(h => /받는|수령|수취|성명|이름|고객/.test(String(h)));
      // 품목명 열: 헤더에 품목/품명/상품/내품 포함 (CJ export 헤더 '품목명'). '내품명'(RTC)보다 '품목명' 우선
      const itemIdx = (() => {
        const exact = headers.findIndex(h => /품목|품명|상품/.test(String(h)));
        if (exact >= 0) return exact;
        return headers.findIndex(h => /내품/.test(String(h)));
      })();
      // 전화번호 열(참고용 표시): 헤더에 전화/연락처 포함 (마스킹돼도 표시는 가능)
      const phoneIdx = headers.findIndex(h => /전화|연락처|휴대/.test(String(h)));
      setImportTrackingCol(trackIdx >= 0 ? trackIdx : 0);
      setImportNameCol(nameIdx >= 0 ? nameIdx : (trackIdx === 1 ? 0 : 1));
      setImportItemCol(itemIdx >= 0 ? itemIdx : 2);
      setImportPhoneCol(phoneIdx);
      setImportStep(1);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // 매칭용 정규화 — 공백·구분자 제거 후 소문자 (이름/품목 양쪽 동일 적용)
  const normMatch = (s: string) => String(s || '').replace(/\s+/g, '').replace(/[,·\-_/]/g, '').toLowerCase();
  // 후보 정렬 — 수령일/택배예정일 최신 우선(동명이인·동일품목 구분 보조)
  const byReceiptDesc = (a: Shipment, b: Shipment) =>
    String(b.sale_receipt_date || b.created_at || '').localeCompare(String(a.sale_receipt_date || a.created_at || ''));

  const handleImportPreview = () => {
    // RTC 패턴 — KX-{8자 hex}. 구 export 파일 하위호환용(어느 컬럼이든 행 안에 있으면 인식).
    const RTC_PAT = /KX-([0-9a-fA-F]{8})/;

    // 1) shipment.id 앞 8자리 → shipment 매핑 (O(1) 조회용)
    const rtcMap = new Map<string, Shipment>();
    for (const s of shipments) {
      const code = s.id.replace(/-/g, '').slice(0, 8).toLowerCase();
      if (!rtcMap.has(code)) rtcMap.set(code, s);
    }

    // 2) 이름+품목 → 후보, 이름만 → 후보 (둘 다 중복 가능)
    const pushMap = (m: Map<string, Shipment[]>, k: string, v: Shipment) => {
      const a = m.get(k); if (a) a.push(v); else m.set(k, [v]);
    };
    const nameItemMap = new Map<string, Shipment[]>();
    const nameMap = new Map<string, Shipment[]>();
    for (const s of shipments) {
      const nm = normMatch(s.recipient_name || '');
      if (!nm) continue;
      pushMap(nameItemMap, nm + '|' + normMatch(s.items_summary || ''), s);
      pushMap(nameMap, nm, s);
    }

    // 이번 임포트 안에서 같은 shipment 가 여러 행에 매핑되지 않도록 사용 추적
    const claimed = new Set<string>();

    const preview: ImportRow[] = importRawRows.map(row => {
      const trackingNo = String(row[importTrackingCol] || '').trim();
      const nameRaw = String(row[importNameCol] || '').trim();
      const itemRaw = String(row[importItemCol] || '').trim();
      const phoneRaw = importPhoneCol >= 0 ? String(row[importPhoneCol] || '') : '';

      // RTC: 행의 모든 셀을 합쳐서 패턴 검색 (구 파일 하위호환)
      const joined = row.join(' ');
      const rtcMatch = joined.match(RTC_PAT);
      const matchRtc = rtcMatch ? rtcMatch[1].toLowerCase() : null;

      const base = {
        trackingNo, matchName: nameRaw, matchItems: itemRaw,
        matchPhone: phoneRaw, matchRtc, rawRow: row,
      };

      // 1순위 — RTC 매칭(구 export 파일)
      if (matchRtc) {
        const s = rtcMap.get(matchRtc);
        if (s && !claimed.has(s.id)) {
          claimed.add(s.id);
          return { ...base, matched: s, candidates: [s], confidence: 'rtc' as ImportConfidence, alreadyHas: !!s.tracking_number };
        }
      }

      const nm = normMatch(nameRaw);
      if (nm) {
        // 2순위 — 이름 + 품목 정확 일치
        const exact = (nameItemMap.get(nm + '|' + normMatch(itemRaw)) || [])
          .filter(s => !claimed.has(s.id)).sort(byReceiptDesc);
        if (exact.length === 1) {
          claimed.add(exact[0].id);
          return { ...base, matched: exact[0], candidates: exact, confidence: 'name_item' as ImportConfidence, alreadyHas: !!exact[0].tracking_number };
        }
        if (exact.length > 1) {
          // 동일 이름+품목 다건 → 자동 반영 금지, 수령일로 구분해 직접 선택
          return { ...base, matched: null, candidates: exact, confidence: 'ambiguous' as ImportConfidence, alreadyHas: false };
        }
        // 3순위 — 품목 불일치, 이름만 일치 → 불확실, 확인 목록으로 분리
        const byName = (nameMap.get(nm) || []).filter(s => !claimed.has(s.id)).sort(byReceiptDesc);
        if (byName.length >= 1) {
          return { ...base, matched: null, candidates: byName, confidence: 'ambiguous' as ImportConfidence, alreadyHas: false };
        }
      }

      // 4순위 — 미매칭
      return { ...base, matched: null, candidates: [], confidence: 'unmatched' as ImportConfidence, alreadyHas: false };
    }).filter(r => r.trackingNo);

    setImportPreview(preview);
    setImportStep(2);
  };

  // ambiguous 행에서 사용자가 후보를 직접 선택하면 매칭 확정
  const resolveAmbiguousMatch = (rowIdx: number, shipmentId: string) => {
    setImportPreview(prev => {
      // 동일 shipment 가 다른 행에서 이미 확정됐는지 체크
      const claimedByOther = prev.some((r, i) =>
        i !== rowIdx && r.matched?.id === shipmentId
      );
      if (claimedByOther) {
        alert('이 배송 행은 이미 다른 임포트 행에서 선택되었습니다. 다른 후보를 선택해주세요.');
        return prev;
      }
      const pick = prev[rowIdx].candidates.find(c => c.id === shipmentId);
      if (!pick) return prev;
      return prev.map((r, i) => i === rowIdx ? {
        ...r,
        matched: pick,
        confidence: 'name_item' as ImportConfidence,  // 사용자 선택 = 확정
        alreadyHas: !!pick.tracking_number,
      } : r);
    });
  };

  const handleImportConfirm = async () => {
    const toUpdate = importPreview.filter(r => r.matched && !r.alreadyHas && r.trackingNo);
    if (toUpdate.length === 0) { alert('업데이트할 항목이 없습니다.'); return; }
    setImportSaving(true);
    try {
      for (const row of toUpdate) {
        await updateShipment(row.matched!.id, {
          tracking_number: row.trackingNo,
          status: ['PENDING', 'PRINTED'].includes(row.matched!.status) ? 'SHIPPED' : row.matched!.status,
        });
      }
      await fetchShipments();
      setImportStep(0);
      alert(`✅ 송장번호 ${toUpdate.length}건 등록 완료`);
    } finally {
      setImportSaving(false);
    }
  };

  // ── 선택건 일괄 배송완료 ──────────────────────────────────────────────────
  const handleBulkDeliver = async () => {
    const ids = [...selectedShipments];
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}건을 '배송완료'로 처리합니다. 판매현황 수령상태도 함께 갱신됩니다. 계속할까요?`)) return;
    const res = await bulkUpdateShipmentStatus(ids, 'DELIVERED');
    if (res.error) { alert(`처리 실패: ${res.error}`); return; }
    alert(`${res.updated ?? 0}건 배송완료 처리(이미 완료 ${res.skipped ?? 0}건 제외)`);
    await fetchShipments();
    setSelectedShipments(new Set());
  };

  // ── Cafe24 탭 핸들러 ──────────────────────────────────────────────────────
  const handleLoadCafe24Orders = async (hideAddedOverride?: boolean) => {
    if (!startDate || !endDate) return;
    // 미추가만 보기면 서버가 이미 추가된 주문의 상세 페치를 건너뛰어 빠르게 응답(#성능).
    const hide = hideAddedOverride ?? cafe24HideAdded;
    setCafe24Loading(true); setCafe24Error(''); setSelectedOrders(new Set()); setCustSelected(new Set()); setRegisterMsg('');
    try {
      const res = await fetch(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}${hide ? '&hide_added=1' : ''}`);
      if (!res.ok) throw new Error('불러오기 실패');
      const data = await res.json();
      setCafe24Orders(data.orders ?? []);
      setIsDemo(!!data.is_demo);
      setDemoReason(data.demo_reason ?? '');
      if (data.error) setCafe24Error(data.demo_reason || '카페24 연동 오류');
      setCafe24Loaded(true);
    } catch (e: any) {
      setCafe24Error(e.message || '오류');
    } finally { setCafe24Loading(false); }
  };

  // 페이지 진입 시 카페24 주문 자동 로드
  useEffect(() => {
    if (activeTab === 'cafe24' && cafe24Orders.length === 0 && !cafe24Loading) {
      handleLoadCafe24Orders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // 카페24 탭(본사) 진입 시 제품 목록 1회 로드 — 매핑 제품 선택용
  useEffect(() => {
    if (activeTab !== 'cafe24' || !isHQ || productsLoaded) return;
    (async () => {
      const { data } = await getProducts();
      setAllProducts((data ?? []).map((p: any) => ({ id: p.id, name: p.name, code: p.code })));
      setProductsLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const toggleOrderSelect = (id: string) =>
    setSelectedOrders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── 카페24 품목 ↔ 내부 제품 매핑 ──────────────────────────────────────────
  const toggleExpandOrder = (id: string) =>
    setExpandedOrders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleConnectProduct = async (
    item: { product_code: string; option_value: string; option?: string; name?: string },
    productId: string,
  ) => {
    setMappingBusy(true); setMappingError('');
    try {
      const res = await createCafe24ProductMap({
        cafe24_product_code: item.product_code,
        option_value: item.option_value,
        product_id: productId,
        // 기존 전표 백필 키 — 표시옵션(order_option)·원본 품목명(item_text) 매칭용
        option_display: item.option ?? '',
        cafe24_name: item.name ?? '',
      });
      if ('error' in res && res.error) { setMappingError(res.error); return; }
      setMappingKey(null); setMappingSearch('');
      await handleLoadCafe24Orders();
    } catch (e: any) {
      setMappingError(e.message ?? '연결 중 오류가 발생했습니다.');
    } finally { setMappingBusy(false); }
  };

  const handleDisconnectProduct = async (item: { product_code: string; option_value: string }) => {
    setMappingBusy(true); setMappingError('');
    try {
      const res = await deleteCafe24ProductMap({
        cafe24_product_code: item.product_code,
        option_value: item.option_value,
      });
      if ('error' in res && res.error) { setMappingError(res.error); return; }
      await handleLoadCafe24Orders();
    } catch (e: any) {
      setMappingError(e.message ?? '해제 중 오류가 발생했습니다.');
    } finally { setMappingBusy(false); }
  };

  // ── 주문자 고객 등록(미등록만) ──────────────────────────────────────────
  const toggleCustSelect = (id: string) =>
    setCustSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleRegisterCustomers = async () => {
    if (custSelected.size === 0) return;
    setRegistering(true); setRegisterMsg('');
    try {
      const items = cafe24Orders
        .filter(o => custSelected.has(o.cafe24_order_id) && !o.customer_match)
        .map(o => ({
          cafe24_order_id: o.cafe24_order_id,
          name: o.orderer_name,
          phone: o.orderer_phone,
          address: o.orderer_address || o.recipient_address,
          email: o.orderer_email,
          order_items: o.order_items,
        }));
      const res = await registerCafe24Customers(items);
      setRegisterMsg(res.message || (res.success ? '완료' : '실패'));
      if (res.success) {
        setCustSelected(new Set());
        await handleLoadCafe24Orders();  // 매칭 상태 새로고침
      }
    } catch (e: any) {
      setRegisterMsg(e.message ?? '고객 등록 중 오류');
    } finally {
      setRegistering(false);
    }
  };

  const handleAddSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setAddingOrders(true);
    setAddError('');
    try {
      const toAdd = cafe24Orders.filter(o => selectedOrders.has(o.cafe24_order_id));
      // 보내는분 성명/전화 = 구매자(주문자). 주소는 행 생성 시 빈 채로 두고
      // CJ 엑셀 다운로드 모달에서 지점(branches.sender_*) 발송지로 일괄 적용.
      for (const order of toAdd) {
        const result = await createShipment({
          source: 'CAFE24', cafe24_order_id: order.cafe24_order_id,
          member_id: order.member_id || '',   // 확정 시 고객 dedup(없으면 '' — phone dedup로 동작)
          sender_name: order.orderer_name || '',
          sender_phone: order.orderer_phone || '',
          sender_zipcode: undefined,
          sender_address: undefined,
          sender_address_detail: undefined,
          recipient_name: order.recipient_name,
          recipient_phone: order.recipient_phone,
          recipient_address: order.recipient_address,
          delivery_message: order.delivery_message, items_summary: order.items_summary,
        });
        if (!result.success) {
          setAddError(`주문 ${order.cafe24_order_id} 추가 실패: ${result.error}`);
          return;
        }
      }
      setSelectedOrders(new Set());
      await fetchShipments();
      // 카페24 주문 목록도 재조회 — 전표 생성 여부(already_added)·고객매칭이 즉시 반영되게
      // (임베드 온라인몰 탭은 탭 전환을 안 하므로 이 재조회가 없으면 새로고침 전까지 옛 값 유지)
      await handleLoadCafe24Orders();
      if (!embedded) setActiveTab('list'); // 임베드(온라인몰 탭)에선 뷰 고정 — 탭 전환 금지
    } catch (e: any) {
      setAddError(e.message ?? '배송 추가 중 오류가 발생했습니다.');
    } finally { setAddingOrders(false); }
  };

  // ── 직접 입력 탭 핸들러 ───────────────────────────────────────────────────
  const handleManualChange = (field: string, value: string) =>
    setManualForm(prev => ({ ...prev, [field]: value }));

  const handleManualSubmit = async () => {
    if (!manualForm.sender_name || !manualForm.sender_phone || !manualForm.recipient_name || !manualForm.recipient_phone || !manualForm.recipient_address) {
      setManualError('필수 항목을 모두 입력해주세요.'); return;
    }
    setManualSaving(true); setManualError('');
    try {
      await createShipment({
        source: 'STORE',
        sender_name: manualForm.sender_name, sender_phone: manualForm.sender_phone,
        sender_address: manualForm.sender_address || undefined,
        recipient_name: manualForm.recipient_name, recipient_phone: manualForm.recipient_phone,
        recipient_zipcode: manualForm.recipient_zipcode || undefined,
        recipient_address: manualForm.recipient_address,
        recipient_address_detail: manualForm.recipient_address_detail || undefined,
        delivery_message: manualForm.delivery_message || undefined,
        items_summary: manualForm.items_summary || undefined,
      });
      setManualForm({ sender_name:'',sender_phone:'',sender_address:'',recipient_name:'',recipient_phone:'',recipient_zipcode:'',recipient_address:'',recipient_address_detail:'',delivery_message:'',items_summary:'' });
      await fetchShipments(); if (!embedded) setActiveTab('list');
    } catch (e: any) {
      setManualError(e.message || '저장 중 오류');
    } finally { setManualSaving(false); }
  };

  // ── 카페24 탭 필터 ────────────────────────────────────────────────────────
  const filteredCafe24Orders = cafe24Orders.filter(o => {
    if (cafe24HideAdded && o.already_added) return false;
    if (cafe24StatusFilter && o.cafe24_status !== cafe24StatusFilter) return false;
    if (cafe24Search) {
      const q = cafe24Search.toLowerCase().replace(/-/g, '');
      return (
        o.orderer_name.toLowerCase().includes(q) ||
        o.recipient_name.toLowerCase().includes(q) ||
        o.orderer_phone.replace(/-/g, '').includes(q) ||
        o.recipient_phone.replace(/-/g, '').includes(q) ||
        o.items_summary.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // 카페24 탭 — 현재 필터된 목록 중 추가 가능한(이미 등록되지 않은) 주문만 모두선택 대상
  const cafe24SelectableIds = filteredCafe24Orders
    .filter(o => !o.already_added)
    .map(o => o.cafe24_order_id);
  const cafe24AllSelected =
    cafe24SelectableIds.length > 0 &&
    cafe24SelectableIds.every(id => selectedOrders.has(id));
  const toggleSelectAllCafe24 = () => {
    setSelectedOrders(prev => {
      const n = new Set(prev);
      if (cafe24AllSelected) {
        for (const id of cafe24SelectableIds) n.delete(id);
      } else {
        for (const id of cafe24SelectableIds) n.add(id);
      }
      return n;
    });
  };

  // ── 목록 탭 핸들러 ────────────────────────────────────────────────────────
  const filteredShipments = shipments.filter(s => {
    if (statusFilter === 'PENDING' && !PENDING_STATES.includes(s.status as typeof PENDING_STATES[number])) return false;
    if (statusFilter === 'SHIPPED' && s.status !== 'SHIPPED') return false;
    if (statusFilter === 'DELIVERED' && s.status !== 'DELIVERED') return false;
    // 배송완료 숨기기: 배송완료 버킷을 직접 보는 경우가 아니면 종결(DELIVERED) 건 제외
    if (hideDelivered && statusFilter !== 'DELIVERED' && s.status === 'DELIVERED') return false;
    // 'ALL' 은 위 가드 외 무필터(전체)
    const day = (s.created_at || '').slice(0, 10);
    if (listStartDate && day && day < listStartDate) return false;
    if (listEndDate && day && day > listEndDate) return false;
    if (listSearch) {
      const q = listSearch.toLowerCase().replace(/-/g, '');
      return (
        (s.recipient_name || '').toLowerCase().includes(q) ||
        (s.recipient_phone || '').replace(/-/g, '').includes(q) ||
        (s.tracking_number || '').includes(q) ||
        (s.recipient_address || '').toLowerCase().includes(q) ||
        (s.items_summary || '').toLowerCase().includes(q)
      );
    }
    return true;
  }).sort((a, b) => {
    const ca = a.created_at || '', cb = b.created_at || '';
    if (shipSort === 'latest') {
      // 최신 등록순(등록일 내림차순)
      return cb < ca ? -1 : cb > ca ? 1 : 0;
    }
    if (shipSort === 'oldest') {
      // 오래된 등록순(등록일 오름차순)
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    }
    // receipt_desc(기본, #60): 수령일/택배예정일 내림차순(최신 우선),
    //   값 없는 행은 맨 뒤(미정 건이 위로 튀지 않게). 동일하면 등록일 최신순.
    const ra = a.sale_receipt_date || '', rb = b.sale_receipt_date || '';
    if (ra !== rb) {
      if (!ra) return 1;
      if (!rb) return -1;
      return ra < rb ? 1 : -1;
    }
    return cb < ca ? -1 : cb > ca ? 1 : 0;
  });

  const toggleShipmentSelect = (id: string) => {
    setSelectedShipments(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedShipments.size === filteredShipments.length) {
      setSelectedShipments(new Set());
    } else {
      setSelectedShipments(new Set(filteredShipments.map(s => s.id)));
    }
  };

  // 선택 엑셀 익스포트 — 발송지는 행별 자동 해결(resolveSenderForRow). 모달 없음.
  const handleEditOpen = (s: Shipment) => { setEditShipment(s); setEditForm({ ...s }); setEditError(''); };
  const handleEditClose = () => { setEditShipment(null); setEditForm({}); setEditError(''); };
  const handleEditSave = async () => {
    if (!editShipment) return;
    setEditSaving(true); setEditError('');
    try {
      // 송장번호를 새로 넣었는데 상태가 아직 대기중이면 발송완료로 자동 연결
      // (출력완료는 유지 — 이미 출력 후 송장만 채운 경우) → #19 판매현황 수령상태 연동도 함께 발화
      const newTracking = (editForm.tracking_number ?? '').toString().trim();
      const hadTracking = !!editShipment.tracking_number;
      let status = editForm.status ?? editShipment.status;
      if (newTracking && !hadTracking && status === 'PENDING') status = 'SHIPPED';

      const res = await updateShipment(editShipment.id, { ...editForm, tracking_number: newTracking || null, status } as any);
      if (res && (res as any).success === false) {
        setEditError((res as any).error || '저장에 실패했습니다.');
        return;
      }
      await fetchShipments(); handleEditClose();
    } catch (e: any) {
      setEditError(e.message || '저장 중 오류');
    } finally { setEditSaving(false); }
  };
  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await deleteShipment(id); await fetchShipments();
  };

  // ── 렌더링 ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* #62 Phase2: 카페24 송장 역연동 실패 배너(본사 전용) — 실패건 있을 때만. 주문번호+사유 확인. */}
      {isHQ && writebackFailures.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <button
            onClick={() => setShowWritebackFailures(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-amber-800"
          >
            <span>⚠️ 카페24 송장 자동등록 실패 {writebackFailures.length}건</span>
            <span className="text-amber-500">{showWritebackFailures ? '▾' : '▸'}</span>
          </button>
          {showWritebackFailures && (
            <div className="mt-2 max-h-60 overflow-y-auto divide-y divide-amber-200">
              {writebackFailures.map((f, i) => (
                <div key={i} className="py-1.5 text-xs flex flex-wrap gap-x-3">
                  <span className="font-mono text-amber-900">{f.cafe24_order_id}</span>
                  <span className="text-amber-700 flex-1 min-w-[200px]">{f.error_message || '-'}</span>
                  <span className="text-amber-400">{f.processed_at ? new Date(f.processed_at).toLocaleString('ko-KR') : ''}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-amber-600">
            재인증(mall.write_order) + CAFE24_CJ_CARRIER_CODE 설정 후 해당 주문 송장을 다시 저장하면 재전송됩니다(우리 송장·배송은 이미 정상 처리됨).
          </p>
        </div>
      )}

      {/* Tabs — embedded 시 부모(/pos)가 탭바를 그리므로 생략(이중 탭바 회피) */}
      {!embedded && (
        <PageTabs
          tabs={[
            { key: 'cafe24', label: '카페24 주문' },
            { key: 'list', label: '배송 목록' },
          ]}
          activeKey={activeTab}
          onChange={k => setActiveTab(k as TabType)}
        />
      )}

      {/* ── Tab: Cafe24 ──────────────────────────────────────────────────── */}
      {activeTab === 'cafe24' && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">시작일</label>
                <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">종료일</label>
                <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={() => handleLoadCafe24Orders()} disabled={cafe24Loading || !startDate || !endDate}>
                {cafe24Loading ? '불러오는 중...' : '불러오기'}
              </button>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded bg-green-50 text-green-700 border border-green-300 hover:bg-green-100"
                  onClick={() => setShowSmartstore(true)}
                  title="네이버 스마트스토어 주문 엑셀(암호) 가져오기"
                >
                  🟢 스마트스토어 가져오기
                </button>
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                  onClick={handleRefreshToken}
                  disabled={tokenRefreshing}
                  title="카페24 access_token / refresh_token 갱신"
                >
                  {tokenRefreshing ? '갱신 중...' : '🔄 토큰 갱신'}
                </button>
              </div>
            </div>
            {syncMessage && (
              <div className="mt-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm">{syncMessage}</div>
            )}
            {/* 필터 행 — 0건이어도 노출(미추가만 보기 토글을 끄려면 항상 접근 가능해야 함) */}
            {(cafe24Orders.length > 0 || cafe24Loaded) && (
              <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-slate-100">
                <input
                  type="text"
                  value={cafe24Search}
                  onChange={e => setCafe24Search(e.target.value)}
                  placeholder="주문자 / 수령자 / 품목 검색"
                  className="input text-sm py-1.5 w-52"
                />
                <select value={cafe24StatusFilter} onChange={e => setCafe24StatusFilter(e.target.value)} className="input text-sm py-1.5 w-36">
                  <option value="">전체 상태</option>
                  <option value="N">입금전</option>
                  <option value="F">결제완료</option>
                  <option value="M">배송준비중</option>
                  <option value="A">배송중</option>
                  <option value="B">배송완료</option>
                  <option value="C">취소</option>
                </select>
                <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
                  {/* 토글 시 재조회 — 서버가 추가된 주문 상세 페치를 건너뛰므로 새 값으로 즉시 반영 */}
                  <input type="checkbox" checked={cafe24HideAdded}
                    onChange={e => { setCafe24HideAdded(e.target.checked); handleLoadCafe24Orders(e.target.checked); }}
                    className="w-4 h-4" />
                  미추가만 보기 <span className="text-[11px] text-slate-400">(이미 추가된 주문 숨김)</span>
                </label>
              </div>
            )}
            {/* 0건 안내 — 미추가만 보기가 켜져 있으면 다 추가됐을 수 있음을 안내 + 즉시 해제 */}
            {cafe24Loaded && !cafe24Loading && cafe24Orders.length === 0 && !cafe24Error && (
              <div className="mt-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
                불러온 주문이 없습니다.
                {cafe24HideAdded ? (
                  <> 이 기간 주문이 <b>모두 이미 추가</b>되었을 수 있습니다.{' '}
                    <button
                      type="button"
                      className="text-blue-600 font-medium hover:underline"
                      onClick={() => { setCafe24HideAdded(false); handleLoadCafe24Orders(false); }}
                    >
                      미추가만 보기 해제하고 전체 보기
                    </button>
                  </>
                ) : (
                  <> 선택한 기간({startDate} ~ {endDate})에 카페24 주문이 없습니다. 기간을 조정해 보세요.</>
                )}
              </div>
            )}
            {cafe24Error && <p className="text-red-500 text-sm mt-2">{cafe24Error}</p>}
            {isDemo && (
              <div className="mt-3 flex items-center gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <span>⚠️ 데모 데이터 표시 중 ({demoReason})</span>
                <a href="/api/cafe24/auth" className="ml-auto px-3 py-1 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 whitespace-nowrap">
                  카페24 재인증
                </a>
              </div>
            )}

            {/* 발송지 배너 제거 — 출고지는 우리 시스템(branches.sender_*)에서 관리. 대한통운 엑셀 다운로드 모달에서 지점 선택. */}
          </div>

          {cafe24Orders.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <span className="text-sm text-slate-600">총 {filteredCafe24Orders.length}건 {filteredCafe24Orders.length !== cafe24Orders.length && <span className="text-slate-400">(전체 {cafe24Orders.length}건)</span>}</span>
                <div className="flex items-center gap-3">
                  {registerMsg && <span className="text-emerald-600 text-sm">{registerMsg}</span>}
                  {addError && <span className="text-red-500 text-sm">{addError}</span>}
                  <button className="btn-secondary" onClick={handleRegisterCustomers} disabled={custSelected.size === 0 || registering}
                    title="선택한 미등록 주문자를 고객으로 등록하고 해당 주문에 연결">
                    {registering ? '등록 중...' : `주문자 고객 등록 (${custSelected.size}건)`}
                  </button>
                  <button className="btn-primary" onClick={handleAddSelectedOrders} disabled={selectedOrders.size === 0 || addingOrders}
                    title="배송 추가 시 판매전표·매출분개가 생성됩니다(매출 확정).">
                    {addingOrders ? '추가 중...' : `배송 추가 + 판매전표 생성 (${selectedOrders.size}건)`}
                  </button>
                </div>
              </div>
              <p className="px-4 pt-2 pb-1 text-xs text-amber-600">
                ※ &quot;배송 추가&quot; 클릭 시 해당 주문의 판매전표와 매출분개가 생성됩니다(매출 확정). 수집만으로는 매출이 잡히지 않습니다.
              </p>
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead><tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={cafe24AllSelected}
                        onChange={toggleSelectAllCafe24}
                        disabled={cafe24SelectableIds.length === 0}
                        title={cafe24SelectableIds.length === 0 ? '선택 가능한 주문이 없습니다' : '필터된 주문 모두 선택/해제'}
                      />
                    </th>
                    <th>주문일</th><th>주문자</th><th>고객</th><th>수령자</th><th>주소</th><th>배송메모</th><th>품목</th><th>금액</th><th>카페24 상태</th><th></th>
                  </tr></thead>
                  <tbody>
                    {filteredCafe24Orders.map(order => {
                      const isExpanded = expandedOrders.has(order.cafe24_order_id);
                      const items = order.order_items ?? [];
                      return (
                      <Fragment key={order.cafe24_order_id}>
                      <tr className={`align-top ${order.already_added ? 'opacity-40' : ''}`}>
                        <td><input type="checkbox" checked={selectedOrders.has(order.cafe24_order_id)} onChange={() => toggleOrderSelect(order.cafe24_order_id)} disabled={order.already_added} className="w-4 h-4" /></td>
                        <td className="text-sm text-slate-600 whitespace-nowrap">{order.order_date?.slice(0, 10)}</td>
                        <td className="text-sm"><div>{order.orderer_name}</div><div className="text-slate-400 text-xs">{order.orderer_phone}</div></td>
                        <td className="text-sm whitespace-nowrap">
                          {order.customer_match ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 text-xs px-1.5 py-0.5 rounded bg-emerald-50" title="우리 고객DB에 등록됨(휴대폰+이름 일치)">
                              ✓ 고객
                            </span>
                          ) : (order.orderer_name && order.orderer_phone) ? (
                            // #67: 휴대폰 일치·이름 불일치(또는 동일번호 다중) → 확인 필요. 등록 시 기존 고객에 연결+검수플래그.
                            <label
                              className={`inline-flex items-center gap-1 text-xs cursor-pointer ${order.customer_review ? 'text-amber-700' : 'text-slate-500'}`}
                              title={order.customer_review
                                ? '휴대폰은 기존 고객과 일치하나 이름이 다릅니다. 체크 후 등록하면 기존 고객에 연결하고 검수 대상으로 표시합니다.'
                                : "체크 후 '주문자 고객 등록'으로 등록"}>
                              <input type="checkbox" className="w-3.5 h-3.5"
                                checked={custSelected.has(order.cafe24_order_id)}
                                onChange={() => toggleCustSelect(order.cafe24_order_id)} />
                              {order.customer_review
                                ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50">🔶 확인 필요</span>
                                : '미등록'}
                            </label>
                          ) : <span className="text-slate-300 text-xs">-</span>}
                        </td>
                        <td className="text-sm"><div className="flex items-center gap-1 flex-wrap">{order.recipient_name}{order.is_dup && <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-rose-50 text-rose-600" title="같은 받는분·같은 품목 주문이 조회 집합 내 2건 이상 — 중복발송 주의">🔁 중복가능</span>}</div><div className="text-slate-400 text-xs">{order.recipient_phone}</div></td>
                        <td className="text-sm text-slate-600 max-w-[220px]">
                          <TruncatedCell text={order.recipient_address} className="text-slate-600" />
                        </td>
                        <td className="text-sm text-slate-600 max-w-[180px]">
                          <TruncatedCell text={order.delivery_message} className="text-amber-700" />
                        </td>
                        <td className="text-sm text-slate-600 max-w-[200px]">
                          <button
                            type="button"
                            onClick={() => toggleExpandOrder(order.cafe24_order_id)}
                            className="flex items-start gap-1 text-left w-full hover:text-blue-600 transition-colors"
                            title={isExpanded ? '품목 매핑 접기' : '품목 매핑 펼치기'}
                          >
                            <span className="text-slate-400 mt-0.5 shrink-0">{isExpanded ? '▾' : '▸'}</span>
                            <span className={isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}>{order.items_summary || <span className="text-slate-300">-</span>}</span>
                          </button>
                          {(() => {
                            const unmapped = items.filter(i => i.product_code && !i.mapped_name).length;
                            return unmapped > 0 ? (
                              <span className="inline-flex items-center text-xs px-1.5 py-0.5 mt-1 rounded bg-amber-50 text-amber-700" title="펼쳐서 해당 품목을 내부 제품에 매핑하세요">
                                ⚠ 미매핑 {unmapped}건
                              </span>
                            ) : null;
                          })()}
                        </td>
                        <td className="text-sm text-slate-700 whitespace-nowrap">{order.total_price.toLocaleString()}원</td>
                        <td><span className={`${CAFE24_STATUS_BADGE[order.cafe24_status] ?? 'badge'} text-xs`}>{CAFE24_STATUS_LABEL[order.cafe24_status] ?? order.cafe24_status}</span></td>
                        <td>{order.already_added && <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 whitespace-nowrap" title="이 주문은 이미 배송 추가되어 판매전표가 생성되었습니다">✓ 전표생성완료</span>}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={11} className="px-6 py-3">
                            <p className="text-xs text-slate-400 mb-2">같은 옵션조합은 모든 주문에 한 번에 반영됩니다.</p>
                            {mappingError && <p className="text-xs text-red-500 mb-2">{mappingError}</p>}
                            {items.length === 0 ? (
                              <p className="text-sm text-slate-400">품목 정보가 없습니다.</p>
                            ) : (
                              <ul className="space-y-1.5">
                                {items.map((item, idx) => {
                                  const itemKey = `${order.cafe24_order_id}::${idx}`;
                                  const noCode = !item.product_code;
                                  return (
                                    <li key={itemKey} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm border-b border-slate-100 last:border-b-0 pb-1.5 last:pb-0">
                                      <span className="font-medium text-slate-700">{item.name}</span>
                                      {item.option && <span className="text-xs text-slate-400">{item.option}</span>}
                                      <span className="text-xs text-slate-400">x{item.quantity}</span>
                                      <span className="text-slate-300">·</span>
                                      {item.mapped_name ? (
                                        <span className="inline-flex items-center gap-2">
                                          <span className="text-emerald-700">→ {item.mapped_name} ✓</span>
                                          {isHQ && (
                                            <button
                                              type="button"
                                              onClick={() => handleDisconnectProduct(item)}
                                              disabled={mappingBusy}
                                              className="text-xs text-red-500 hover:underline disabled:opacity-40"
                                            >
                                              해제
                                            </button>
                                          )}
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-2">
                                          <span className="text-amber-600">미매핑</span>
                                          {isHQ && (
                                            noCode ? (
                                              <span className="text-xs text-slate-400" title="이 품목은 카페24 품목코드가 없어 매핑할 수 없습니다.">품목코드 없음 (매핑 불가)</span>
                                            ) : mappingKey === itemKey ? (
                                              <span className="relative inline-block">
                                                <input
                                                  type="text"
                                                  autoFocus
                                                  className="input text-xs py-1 w-56"
                                                  placeholder="제품명 / 코드 검색"
                                                  value={mappingSearch}
                                                  onChange={e => setMappingSearch(e.target.value)}
                                                  onBlur={() => setTimeout(() => { setMappingKey(null); setMappingSearch(''); }, 200)}
                                                />
                                                {(() => {
                                                  const q = mappingSearch.trim().toLowerCase();
                                                  const matches = q
                                                    ? allProducts.filter(p => p.name.toLowerCase().includes(q) || (p.code ?? '').toLowerCase().includes(q)).slice(0, 30)
                                                    : allProducts.slice(0, 30);
                                                  return matches.length > 0 ? (
                                                    <div className="absolute z-50 w-72 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                                                      {matches.map(p => (
                                                        <button
                                                          key={p.id}
                                                          type="button"
                                                          disabled={mappingBusy}
                                                          onMouseDown={() => handleConnectProduct(item, p.id)}
                                                          className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-100 last:border-b-0 disabled:opacity-40"
                                                        >
                                                          <span className="font-medium text-sm">{p.name}</span>
                                                          {p.code && <span className="text-xs text-slate-400 ml-2">{p.code}</span>}
                                                        </button>
                                                      ))}
                                                    </div>
                                                  ) : (
                                                    <div className="absolute z-50 w-72 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs text-slate-400">
                                                      일치하는 제품이 없습니다.
                                                    </div>
                                                  );
                                                })()}
                                              </span>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => { setMappingKey(itemKey); setMappingSearch(''); setMappingError(''); }}
                                                disabled={mappingBusy}
                                                className="text-xs text-blue-600 hover:underline disabled:opacity-40"
                                              >
                                                내부 제품 연결
                                              </button>
                                            )
                                          )}
                                        </span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: 직접 입력 ───────────────────────────────────────────────── */}
      {activeTab === 'manual' && (
        <div className="card p-6 max-w-2xl space-y-6">

          {/* 복귀 경로 — 탭바에서 빠진 예외 입력 화면이므로 목록 복귀 링크 보장 */}
          <button
            onClick={() => setActiveTab('list')}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ← 배송 목록으로
          </button>

          {/* 발송자 */}
          <div className="bg-slate-50 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">발송자 정보</h3>
            {/* DB 검색 */}
            <div className="relative">
              <input
                ref={senderInputRef}
                type="text"
                className="input w-full text-sm"
                placeholder="고객 검색 (이름 / 전화번호)으로 불러오기"
                value={senderSearch}
                onChange={e => setSenderSearch(e.target.value)}
                onFocus={() => senderSearch && setShowSenderDrop(true)}
                onBlur={() => setTimeout(() => setShowSenderDrop(false), 200)}
              />
              {showSenderDrop && senderResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                  {senderResults.map(c => (
                    <button key={c.id} onMouseDown={() => selectSender(c)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-b-0">
                      <span className="font-medium text-sm">{c.name}</span>
                      <span className="text-xs text-slate-400 ml-2">{c.phone}</span>
                      {c.address && <div className="text-xs text-slate-400 truncate">{c.address}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">발송자 이름 <span className="text-red-500">*</span></label>
                <input className="input w-full" value={manualForm.sender_name} onChange={e => handleManualChange('sender_name', e.target.value)} placeholder="홍길동" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">발송자 전화번호 <span className="text-red-500">*</span></label>
                <input className="input w-full" value={manualForm.sender_phone} onChange={e => handleManualChange('sender_phone', e.target.value)} placeholder="010-0000-0000" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">발송자 주소 <span className="text-xs text-slate-400">(대한통운 엑셀 필수)</span></label>
              <input className="input w-full" value={manualForm.sender_address} onChange={e => handleManualChange('sender_address', e.target.value)} placeholder="서울시 강남구 청담동 11-1" />
            </div>
          </div>

          {/* 수령자 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">수령자 정보</h3>
            {/* DB 검색 */}
            <div className="relative">
              <input
                ref={recipientInputRef}
                type="text"
                className="input w-full text-sm"
                placeholder="고객 검색 (이름 / 전화번호)으로 불러오기"
                value={recipientSearch}
                onChange={e => setRecipientSearch(e.target.value)}
                onFocus={() => recipientSearch && setShowRecipientDrop(true)}
                onBlur={() => setTimeout(() => setShowRecipientDrop(false), 200)}
              />
              {showRecipientDrop && recipientResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                  {recipientResults.map(c => (
                    <button key={c.id} onMouseDown={() => selectRecipient(c)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-b-0">
                      <span className="font-medium text-sm">{c.name}</span>
                      <span className="text-xs text-slate-400 ml-2">{c.phone}</span>
                      {c.address && <div className="text-xs text-slate-400 truncate">{c.address}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">수령자 이름 <span className="text-red-500">*</span></label>
                <input className="input w-full" value={manualForm.recipient_name} onChange={e => handleManualChange('recipient_name', e.target.value)} placeholder="홍길동" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">수령자 전화번호 <span className="text-red-500">*</span></label>
                <input className="input w-full" value={manualForm.recipient_phone} onChange={e => handleManualChange('recipient_phone', e.target.value)} placeholder="010-0000-0000" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">주소 <span className="text-red-500">*</span></label>
              <div className="flex gap-2 mb-1">
                <input className="input w-24" value={manualForm.recipient_zipcode} readOnly placeholder="우편번호" />
                <button type="button" className="px-3 py-1.5 rounded bg-slate-600 text-white text-xs whitespace-nowrap"
                  onClick={() => openDaumPostcode((zip, addr) => setManualForm(f => ({ ...f, recipient_zipcode: zip, recipient_address: addr })))}>
                  주소 검색
                </button>
              </div>
              <input className="input w-full" value={manualForm.recipient_address} onChange={e => handleManualChange('recipient_address', e.target.value)} placeholder="도로명 주소" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">상세주소</label>
              <input className="input w-full" value={manualForm.recipient_address_detail} onChange={e => handleManualChange('recipient_address_detail', e.target.value)} placeholder="101동 201호" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">배송 메모</label>
              <input className="input w-full" value={manualForm.delivery_message} onChange={e => handleManualChange('delivery_message', e.target.value)} placeholder="문 앞에 놓아주세요" />
            </div>
          </div>

          {/* 품목 */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">품목 메모</label>
            <textarea className="input w-full resize-none" rows={3} value={manualForm.items_summary} onChange={e => handleManualChange('items_summary', e.target.value)} placeholder="예: 경옥고 100g x2, 홍삼정 외 1건" />
          </div>

          {manualError && <p className="text-red-500 text-sm">{manualError}</p>}
          <button className="btn-primary w-full" onClick={handleManualSubmit} disabled={manualSaving}>
            {manualSaving ? '등록 중...' : '등록'}
          </button>
        </div>
      )}

      {/* ── Tab: 배송 목록 ───────────────────────────────────────────────── */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['ALL','PENDING','SHIPPED','DELIVERED'] as StatusFilter[]).map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    statusFilter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {BUCKET_LABEL[f]}
                </button>
              ))}
              {/* 배송완료(종결) 숨기기 — 배송완료 버킷을 직접 볼 때는 의미 없으므로 비활성 */}
              <button
                onClick={() => setHideDelivered(v => !v)}
                disabled={statusFilter === 'DELIVERED'}
                title="체크 시 배송완료(업무 종결) 건을 목록에서 숨깁니다. '배송완료' 버킷에서는 적용되지 않습니다."
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm font-medium border transition-colors disabled:opacity-40 ${
                  hideDelivered && statusFilter !== 'DELIVERED'
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className={`inline-block w-3 h-3 rounded-sm border ${hideDelivered && statusFilter !== 'DELIVERED' ? 'bg-white border-white' : 'border-slate-300'}`}>
                  {hideDelivered && statusFilter !== 'DELIVERED' && <span className="block text-amber-500 text-[10px] leading-3 text-center">✓</span>}
                </span>
                배송완료 숨기기
              </button>
              <input
                type="date"
                value={listStartDate}
                onChange={e => setListStartDate(e.target.value)}
                className="input text-sm py-1.5 w-40"
              />
              <span className="text-slate-400 text-sm">~</span>
              <input
                type="date"
                value={listEndDate}
                onChange={e => setListEndDate(e.target.value)}
                className="input text-sm py-1.5 w-40"
              />
              <button
                onClick={() => {
                  setListStartDate(fmt(oneWeekAgo));
                  setListEndDate(fmt(today));
                }}
                className="px-2 py-1.5 rounded text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                최근 1주
              </button>
              <input
                type="text"
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
                placeholder="수령자 / 전화번호 / 송장번호 / 주소"
                className="input text-sm py-1.5 w-64"
              />
              <select
                value={shipSort}
                onChange={e => setShipSort(e.target.value as typeof shipSort)}
                className="input text-sm py-1.5 w-44"
                title="정렬 기준"
              >
                <option value="receipt_desc">수령일/택배예정일 최신순</option>
                <option value="latest">최신 등록순</option>
                <option value="oldest">오래된 등록순</option>
              </select>
            </div>
            <div className="flex gap-2 flex-wrap">
              {/* 엑셀 임포트 */}
              <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
              <button
                onClick={() => importFileRef.current?.click()}
                className="px-3 py-2 rounded text-sm font-medium bg-amber-500 text-white hover:bg-amber-600"
              >
                엑셀로 송장번호 가져오기
              </button>
              {/* CJ 엑셀 다운로드 — 선택건만 */}
              <button
                onClick={downloadCjExcel}
                disabled={selectedShipments.size === 0}
                title="선택한 행만 대한통운 임포트 형식으로 다운로드"
                className="px-3 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
              >
                대한통운 엑셀 다운로드 ({selectedShipments.size})
              </button>
              {/* 선택건 일괄 배송·수령완료 — 배송완료(DELIVERED) + 판매현황 수령완료 동기화(#64).
                  발송완료는 수령으로 자동 전이하지 않음(발송≠수령, #43) → 실배송 후 이 버튼 1번으로 종결. */}
              <button
                onClick={handleBulkDeliver}
                disabled={selectedShipments.size === 0}
                title="선택한 배송건을 배송완료로 처리하고, 판매현황 수령상태도 '수령완료'로 함께 갱신합니다."
                className="px-3 py-2 rounded text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                선택건 배송·수령완료 ({selectedShipments.size})
              </button>
              {/* 예외 진입점: 직접 배송 입력 — 보조 버튼(임베드 미노출) */}
              {!embedded && (
                <button
                  onClick={() => setActiveTab('manual')}
                  className="px-2 py-2 text-xs text-slate-400 hover:text-slate-600 underline"
                >
                  + 직접 배송 입력 (예외)
                </button>
              )}
            </div>
          </div>

          <div className="card p-0 overflow-hidden">
            {listLoading ? (
              <div className="p-8 text-center text-slate-400 text-sm">불러오는 중...</div>
            ) : filteredShipments.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">배송 내역이 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="w-10 px-3">
                        <input type="checkbox" className="w-4 h-4"
                          checked={filteredShipments.length > 0 && selectedShipments.size === filteredShipments.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">등록일</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-blue-600 uppercase tracking-wide w-24">수령/택배예정일</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">수령자</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">발송자</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">배송지 주소</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">배송메모</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-violet-600 uppercase tracking-wide">포장/옵션</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">품목</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">매출처</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-600 uppercase tracking-wide w-24" title="재고 차감 기준 지점/창고">출고처</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">상태</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">송장번호</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">액션</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredShipments.map(s => (
                      <tr key={s.id} className={`hover:bg-slate-50 transition-colors ${selectedShipments.has(s.id) ? 'bg-blue-50' : ''}`}>
                        <td className="px-3 py-3">
                          <input type="checkbox" className="w-4 h-4"
                            checked={selectedShipments.has(s.id)}
                            onChange={() => toggleShipmentSelect(s.id)}
                          />
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">{s.created_at?.slice(0, 10)}</td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap">
                          {s.sale_receipt_date
                            ? <span className="font-semibold text-blue-700">{s.sale_receipt_date}</span>
                            : <span className="text-slate-300">미지정</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-sm text-slate-800">{s.recipient_name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{s.recipient_phone}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-sm text-slate-700">{s.sender_name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{s.sender_phone}</div>
                        </td>
                        <td className="px-3 py-3 max-w-[260px] align-top">
                          <TruncatedCell
                            text={[s.recipient_address, s.recipient_address_detail].filter(Boolean).join(' ')}
                            className="text-slate-700"
                          />
                        </td>
                        <td className="px-3 py-3 max-w-[200px] align-top">
                          <TruncatedCell text={composeDeliveryMessage(s)} className="text-amber-700" />
                        </td>
                        <td className="px-3 py-3 max-w-[160px] align-top">
                          {s.order_options
                            ? <TruncatedCell text={s.order_options} className="text-violet-700" />
                            : <span className="text-slate-300 text-sm">-</span>}
                        </td>
                        <td className="px-3 py-3 max-w-[180px] align-top">
                          <TruncatedCell text={s.items_summary} className="text-slate-600" />
                        </td>
                        <td className="px-3 py-3">
                          {/* 매출처(#21): 연결 sales_order의 지점. 미연결이면 출처 라벨 폴백 */}
                          {s.sale_branch_name
                            ? <span className="text-xs font-medium text-slate-700">{s.sale_branch_name}</span>
                            : <span className="text-xs text-slate-400">{s.source === 'CAFE24' ? '자사몰' : '직접'}</span>}
                        </td>
                        <td className="px-3 py-3">
                          {/* #65: 출고처 = 재고 차감 기준. 항상 실제 지점/창고명(자사몰 같은 채널명 아님). */}
                          <span className="text-xs font-medium text-indigo-700">{resolveShipFromName(s)}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`${STATUS_BADGE[s.status]} text-xs`}>{STATUS_LABEL[s.status]}</span>
                        </td>
                        <td className="px-3 py-3">
                          {s.tracking_number ? (
                            <a href={`https://trace.cjlogistics.com/web/detail.jsp?slipno=${s.tracking_number}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono text-blue-600 hover:underline text-xs font-medium">
                              {s.tracking_number}
                            </a>
                          ) : <span className="text-slate-300 text-xs">-</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <button className="text-xs text-blue-600 hover:text-blue-800 font-medium" onClick={() => handleEditOpen(s)}>수정</button>
                            {s.status === 'PENDING' && (
                              <button className="text-xs text-red-500 hover:text-red-700 font-medium" onClick={() => handleDelete(s.id)}>삭제</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 엑셀 임포트 모달 ─────────────────────────────────────────────── */}
      {importStep > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                {importStep === 1 ? '컬럼 선택' : `매칭 미리보기 (${importPreview.filter(r => r.matched && !r.alreadyHas).length}건 등록 가능)`}
              </h2>
              <button onClick={() => setImportStep(0)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>

            {importStep === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-500">
                  송장번호 열과 매칭 기준(<b>받는분 이름 + 품목명</b>) 열을 선택하세요.
                </p>
                <div className="px-3 py-2 rounded bg-blue-50 border border-blue-200 text-xs text-blue-800">
                  💡 택배사 다운로드 파일은 전화번호가 마스킹(010-1111-****)되어 부정확하므로 <b>받는분 이름 + 품목명</b> 조합으로 매칭합니다.
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">송장번호 열</label>
                    <select className="input w-full" value={importTrackingCol} onChange={e => setImportTrackingCol(Number(e.target.value))}>
                      {importHeaders.map((h, i) => <option key={i} value={i}>{h || `열 ${i + 1}`}</option>)}
                    </select>
                    <p className="text-xs text-slate-400 mt-1 truncate" title={importRawRows[0]?.[importTrackingCol]}>예시: {importRawRows[0]?.[importTrackingCol]}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">받는분 이름 열</label>
                    <select className="input w-full" value={importNameCol} onChange={e => setImportNameCol(Number(e.target.value))}>
                      {importHeaders.map((h, i) => <option key={i} value={i}>{h || `열 ${i + 1}`}</option>)}
                    </select>
                    <p className="text-xs text-slate-400 mt-1 truncate" title={importRawRows[0]?.[importNameCol]}>예시: {importRawRows[0]?.[importNameCol]}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">품목명 열</label>
                    <select className="input w-full" value={importItemCol} onChange={e => setImportItemCol(Number(e.target.value))}>
                      {importHeaders.map((h, i) => <option key={i} value={i}>{h || `열 ${i + 1}`}</option>)}
                    </select>
                    <p className="text-xs text-slate-400 mt-1 truncate" title={importRawRows[0]?.[importItemCol]}>예시: {importRawRows[0]?.[importItemCol]}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary flex-1" onClick={handleImportPreview}>미리보기</button>
                  <button className="flex-1 px-4 py-2 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setImportStep(0)}>취소</button>
                </div>
              </div>
            )}

            {importStep === 2 && (() => {
              const summary = {
                total: importPreview.length,
                rtc: importPreview.filter(r => r.confidence === 'rtc').length,
                nameItem: importPreview.filter(r => r.confidence === 'name_item').length,
                ambiguous: importPreview.filter(r => r.confidence === 'ambiguous').length,
                unmatched: importPreview.filter(r => r.confidence === 'unmatched').length,
                ready: importPreview.filter(r => r.matched && !r.alreadyHas).length,
                already: importPreview.filter(r => r.matched && r.alreadyHas).length,
              };
              return (
              <div className="space-y-4">
                {/* 카운트 박스 — 한눈 검증 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="rounded bg-emerald-50 border border-emerald-200 px-2 py-1.5">
                    <div className="font-bold text-emerald-700">{summary.nameItem}</div>
                    <div className="text-emerald-600">🟢 이름+품목</div>
                  </div>
                  <div className="rounded bg-sky-50 border border-sky-200 px-2 py-1.5">
                    <div className="font-bold text-sky-700">{summary.rtc}</div>
                    <div className="text-sky-600">🔵 코드(구파일)</div>
                  </div>
                  <div className="rounded bg-rose-50 border border-rose-200 px-2 py-1.5">
                    <div className="font-bold text-rose-700">{summary.ambiguous}</div>
                    <div className="text-rose-600">🔴 확인 필요</div>
                  </div>
                  <div className="rounded bg-slate-50 border border-slate-200 px-2 py-1.5">
                    <div className="font-bold text-slate-700">{summary.unmatched}</div>
                    <div className="text-slate-600">⚪ 미매칭</div>
                  </div>
                </div>
                {summary.ambiguous > 0 && (
                  <div className="px-3 py-2 rounded bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    ⚠️ 이름+품목이 여러 배송과 일치하거나 품목이 정확히 맞지 않는 행이 <b>{summary.ambiguous}건</b> 있습니다.
                    자동 반영되지 않으니, 아래에서 <b>수령일</b>을 참고해 각 행에 맞는 배송을 직접 선택하세요.
                  </div>
                )}

                <div className="overflow-x-auto max-h-96">
                  <table className="table w-full text-sm">
                    <thead>
                      <tr>
                        <th>상태</th>
                        <th>송장번호</th>
                        <th>받는분 / 품목</th>
                        <th>매칭 배송</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((row, i) => {
                        const badge =
                          row.confidence === 'rtc'        ? <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px]">🔵 코드</span>
                          : row.confidence === 'name_item' ? <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px]">🟢 이름+품목</span>
                          : row.confidence === 'ambiguous' ? <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px]">🔴 확인</span>
                          :                                 <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">⚪ 미매칭</span>;
                        return (
                          <tr key={i} className={!row.matched && row.confidence !== 'ambiguous' ? 'opacity-50' : ''}>
                            <td>
                              {badge}
                              {row.alreadyHas && <span className="ml-1 px-1 rounded bg-amber-100 text-amber-700 text-[10px]">중복</span>}
                            </td>
                            <td className="font-mono text-xs">{row.trackingNo}</td>
                            <td className="text-xs">
                              <div className="font-medium text-slate-700">{row.matchName || '-'}</div>
                              <div className="text-slate-400 truncate max-w-[160px]" title={row.matchItems}>{row.matchItems || ''}</div>
                            </td>
                            <td>
                              {row.confidence === 'ambiguous' ? (
                                <select
                                  className="input text-xs py-1 w-full"
                                  value={row.matched?.id || ''}
                                  onChange={e => resolveAmbiguousMatch(i, e.target.value)}
                                >
                                  <option value="">— 선택 —</option>
                                  {row.candidates.map(c => (
                                    <option key={c.id} value={c.id}>
                                      {c.recipient_name} · {c.items_summary?.slice(0, 24) || '품목 없음'} · 수령일 {(c.sale_receipt_date || c.created_at)?.slice(0, 10) || '-'}
                                      {c.tracking_number ? ` (이미 송장 ${c.tracking_number.slice(0, 8)}...)` : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : row.matched ? (
                                <span className="text-xs">
                                  {row.matched.recipient_name} · <span className="text-slate-400">{row.matched.items_summary?.slice(0, 24) || ''}</span>
                                  {row.matched.sale_receipt_date && <span className="text-slate-400"> · {row.matched.sale_receipt_date.slice(0, 10)}</span>}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">대응되는 배송 없음</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-primary flex-1"
                    onClick={handleImportConfirm}
                    disabled={importSaving || summary.ready === 0 || summary.ambiguous > 0}
                    title={summary.ambiguous > 0 ? '선택 필요 행을 모두 해결해야 등록 가능' : ''}
                  >
                    {importSaving ? '등록 중...' : `송장번호 ${summary.ready}건 등록${summary.already > 0 ? ` (중복 ${summary.already}건 제외)` : ''}`}
                  </button>
                  <button className="px-4 py-2 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setImportStep(1)}>← 다시 선택</button>
                  <button className="px-4 py-2 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setImportStep(0)}>취소</button>
                </div>
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── 수정 모달 ────────────────────────────────────────────────────── */}
      {editShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">배송 수정</h2>
              <button onClick={handleEditClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 space-y-3">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">발송자 정보</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">발송자 이름</label>
                  <input className="input w-full" value={editForm.sender_name ?? ''} onChange={e => setEditForm(f => ({ ...f, sender_name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">발송자 전화번호</label>
                  <input className="input w-full" value={editForm.sender_phone ?? ''} onChange={e => setEditForm(f => ({ ...f, sender_phone: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">발송자 주소</label>
                <input className="input w-full" value={(editForm as any).sender_address ?? ''} onChange={e => setEditForm(f => ({ ...f, sender_address: e.target.value }))} placeholder="서울시 강남구 청담동 11-1" />
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">수령자 정보</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">수령자 이름</label>
                  <input className="input w-full" value={editForm.recipient_name ?? ''} onChange={e => setEditForm(f => ({ ...f, recipient_name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">수령자 전화번호</label>
                  <input className="input w-full" value={editForm.recipient_phone ?? ''} onChange={e => setEditForm(f => ({ ...f, recipient_phone: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">주소</label>
                <div className="flex gap-2 mb-1">
                  <input className="input w-24" value={editForm.recipient_zipcode ?? ''} readOnly placeholder="우편번호" />
                  <button type="button" className="px-3 py-1.5 rounded bg-slate-600 text-white text-xs whitespace-nowrap"
                    onClick={() => openDaumPostcode((zip, addr) => setEditForm(f => ({ ...f, recipient_zipcode: zip, recipient_address: addr })))}>
                    주소 검색
                  </button>
                </div>
                <input className="input w-full" value={editForm.recipient_address ?? ''} onChange={e => setEditForm(f => ({ ...f, recipient_address: e.target.value }))} placeholder="도로명 주소" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">상세주소</label>
                <input className="input w-full" value={editForm.recipient_address_detail ?? ''} onChange={e => setEditForm(f => ({ ...f, recipient_address_detail: e.target.value || null }))} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">배송 메모</label>
                <input className="input w-full" value={editForm.delivery_message ?? ''} onChange={e => setEditForm(f => ({ ...f, delivery_message: e.target.value || null }))} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">품목 메모</label>
                <input className="input w-full" value={editForm.items_summary ?? ''} onChange={e => setEditForm(f => ({ ...f, items_summary: e.target.value || null }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">송장번호</label>
                <input className="input w-full" value={editForm.tracking_number ?? ''} onChange={e => setEditForm(f => ({ ...f, tracking_number: e.target.value || null }))} placeholder="숫자 입력" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">상태</label>
                <select className="input w-full" value={editForm.status ?? 'PENDING'} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as Shipment['status'] }))}>
                  {Object.entries(STATUS_LABEL).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                </select>
              </div>
            </div>
            {editError && <p className="text-red-500 text-sm">{editError}</p>}
            <div className="flex gap-2 pt-2">
              <button className="btn-primary flex-1" onClick={handleEditSave} disabled={editSaving}>{editSaving ? '저장 중...' : '저장'}</button>
              <button className="flex-1 px-4 py-2 rounded border border-slate-300 text-slate-600 text-sm hover:bg-slate-50" onClick={handleEditClose}>취소</button>
            </div>
          </div>
        </div>
      )}

      {showSmartstore && (
        <SmartstoreImportModal
          onClose={() => setShowSmartstore(false)}
          onImported={() => { /* 생성 주문은 판매현황에 표시됨 — 별도 갱신 불필요 */ }}
        />
      )}
    </div>
  );
}
