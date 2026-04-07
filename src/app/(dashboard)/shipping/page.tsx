'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getShipments, createShipment, updateShipment, deleteShipment } from '@/lib/shipping-actions';
import * as XLSX from 'xlsx';

interface Shipment {
  id: string;
  source: 'CAFE24' | 'STORE';
  cafe24_order_id: string | null;
  sender_name: string;
  sender_phone: string;
  sender_address: string | null;
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
  order_date: string;
  orderer_name: string;
  orderer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  delivery_message: string;
  items_summary: string;
  total_price: number;
  already_added: boolean;
  cafe24_status: string;
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

interface ImportRow {
  trackingNo: string;
  matchPhone: string;
  rawRow: string[];
  matched: Shipment | null;
  alreadyHas: boolean;
}

type TabType = 'cafe24' | 'manual' | 'list';
type StatusFilter = 'ALL' | 'PENDING' | 'PRINTED' | 'SHIPPED' | 'DELIVERED';

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

const normalPhone = (p: string) => p.replace(/\D/g, '');

export default function ShippingPage() {
  const [activeTab, setActiveTab] = useState<TabType>('cafe24');

  // ── Cafe24 탭 ─────────────────────────────────────────────────────────────
  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(fmt(oneMonthAgo));
  const [endDate, setEndDate] = useState(fmt(today));
  const [cafe24Orders, setCafe24Orders] = useState<Cafe24OrderForShipping[]>([]);
  const [cafe24Loading, setCafe24Loading] = useState(false);
  const [cafe24Error, setCafe24Error] = useState('');
  const [isDemo, setIsDemo] = useState(false);
  const [demoReason, setDemoReason] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [addingOrders, setAddingOrders] = useState(false);
  const [addError, setAddError] = useState('');

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

  // ── 배송 목록 탭 ──────────────────────────────────────────────────────────
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
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
  const [importPhoneCol, setImportPhoneCol] = useState(1);
  const [importPreview, setImportPreview] = useState<ImportRow[]>([]);
  const [importSaving, setImportSaving] = useState(false);

  // 배송 목록 선택
  const [selectedShipments, setSelectedShipments] = useState<Set<string>>(new Set());

  // 배송 추적
  const [trackingId, setTrackingId] = useState<string | null>(null); // 개별 추적 중인 shipment id
  const [batchTracking, setBatchTracking] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');

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
    supabase.from('customers').select('id,name,phone,address').eq('is_active', true)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
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
    supabase.from('customers').select('id,name,phone,address').eq('is_active', true)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
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

  // ── 대한통운 엑셀 다운로드 ────────────────────────────────────────────────
  const downloadCjExcel = () => {
    const targets = statusFilter === 'ALL' ? shipments : shipments.filter(s => s.status === statusFilter);
    if (targets.length === 0) { alert('다운로드할 배송 건이 없습니다.'); return; }

    const header = [
      '받는분성명', '받는분전화번호', '받는분기타연락처',
      '받는분주소(전체, 분할)', '배송메세지1',
      '품목명', '내품명', '내품수량', '운임구분',
      '보내는분성명', '보내는분전화번호', '보내는분주소(전체, 분할)',
    ];

    const rows = targets.map(s => [
      s.recipient_name, s.recipient_phone, '',
      [s.recipient_address, s.recipient_address_detail].filter(Boolean).join(' '),
      s.delivery_message || '', s.items_summary || '', '', '', '선불',
      s.sender_name, s.sender_phone, s.sender_address || '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 50 }, { wch: 30 },
      { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 8 },
      { wch: 12 }, { wch: 16 }, { wch: 40 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'sheet1');
    XLSX.writeFile(wb, `CJ대한통운_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
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
      // 자동 감지: 10자리 이상 숫자 컬럼 → 송장번호, 010 포함 → 전화번호
      const trackIdx = headers.findIndex((_, i) =>
        dataRows.slice(0, 5).some(r => /^\d{10,13}$/.test(String(r[i] || '').replace(/\D/g, '')))
      );
      const phoneIdx = headers.findIndex((_, i) =>
        dataRows.slice(0, 5).some(r => /^0\d{9,10}$/.test(String(r[i] || '').replace(/\D/g, '')))
      );
      setImportTrackingCol(trackIdx >= 0 ? trackIdx : 0);
      setImportPhoneCol(phoneIdx >= 0 ? phoneIdx : 1);
      setImportStep(1);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleImportPreview = () => {
    const preview: ImportRow[] = importRawRows.map(row => {
      const trackingNo = String(row[importTrackingCol] || '').trim();
      const matchPhone = normalPhone(String(row[importPhoneCol] || ''));
      const matched = shipments.find(s => normalPhone(s.recipient_phone) === matchPhone) || null;
      return {
        trackingNo,
        matchPhone: String(row[importPhoneCol] || ''),
        rawRow: row,
        matched,
        alreadyHas: matched ? !!matched.tracking_number : false,
      };
    }).filter(r => r.trackingNo);
    setImportPreview(preview);
    setImportStep(2);
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

  // ── 배송 상태 추적 ────────────────────────────────────────────────────────
  const trackOne = async (s: Shipment) => {
    if (!s.tracking_number) return;
    setTrackingId(s.id);
    try {
      const res = await fetch(`/api/shipping/track?trackingNo=${s.tracking_number}`);
      if (res.status === 429 || !res.ok) {
        window.open(`https://trace.cjlogistics.com/web/detail.jsp?slipno=${s.tracking_number}`, '_blank');
        return;
      }
      const data = await res.json();
      if (data.error === 'API_KEY_NOT_SET' || data.error?.includes('quota') || data.error?.includes('rate') || data.error?.includes('429')) {
        window.open(`https://trace.cjlogistics.com/web/detail.jsp?slipno=${s.tracking_number}`, '_blank');
        return;
      }
      if (data.error) { alert(`추적 실패: ${data.error}`); return; }
      if (data.status !== s.status) {
        await updateShipment(s.id, { status: data.status });
        await fetchShipments();
        alert(`상태 업데이트: ${STATUS_LABEL[s.status]} → ${STATUS_LABEL[data.status]}\n${data.stateText}${data.lastLocation ? ` (${data.lastLocation})` : ''}`);
      } else {
        alert(`현재 상태: ${STATUS_LABEL[data.status]}\n${data.stateText}${data.lastLocation ? ` (${data.lastLocation})` : ''}`);
      }
    } finally {
      setTrackingId(null);
    }
  };

  const trackBatch = async () => {
    const targets = shipments.filter(s => s.tracking_number && s.status === 'SHIPPED');
    if (targets.length === 0) { alert('추적할 발송완료 건이 없습니다.'); return; }
    setBatchTracking(true);
    let updated = 0;
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      setBatchProgress(`${i + 1}/${targets.length} 처리중...`);
      try {
        const res = await fetch(`/api/shipping/track?trackingNo=${s.tracking_number}`);
        if (res.status === 429) {
          setBatchTracking(false);
          setBatchProgress('');
          alert(`API 한도 초과 — ${updated}건 업데이트 후 중단됨.\n개별 송장번호 클릭으로 대한통운 공식 페이지에서 확인하세요.`);
          await fetchShipments();
          return;
        }
        const data = await res.json();
        if (data.error?.includes('quota') || data.error?.includes('rate') || data.error?.includes('429')) {
          setBatchTracking(false);
          setBatchProgress('');
          alert(`API 한도 초과 — ${updated}건 업데이트 후 중단됨.\n개별 송장번호 클릭으로 대한통운 공식 페이지에서 확인하세요.`);
          await fetchShipments();
          return;
        }
        if (!data.error && data.status !== s.status) {
          await updateShipment(s.id, { status: data.status });
          updated++;
        }
      } catch { /* skip */ }
    }
    await fetchShipments();
    setBatchTracking(false);
    setBatchProgress('');
    alert(`배송 상태 업데이트 완료 — ${updated}건 변경`);
  };

  // ── Cafe24 탭 핸들러 ──────────────────────────────────────────────────────
  const handleLoadCafe24Orders = async () => {
    if (!startDate || !endDate) return;
    setCafe24Loading(true); setCafe24Error(''); setSelectedOrders(new Set());
    try {
      const res = await fetch(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}`);
      if (!res.ok) throw new Error('불러오기 실패');
      const data = await res.json();
      setCafe24Orders(data.orders ?? []);
      setIsDemo(!!data.is_demo);
      setDemoReason(data.demo_reason ?? '');
    } catch (e: any) {
      setCafe24Error(e.message || '오류');
    } finally { setCafe24Loading(false); }
  };

  const toggleOrderSelect = (id: string) =>
    setSelectedOrders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleAddSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setAddingOrders(true);
    setAddError('');
    try {
      const toAdd = cafe24Orders.filter(o => selectedOrders.has(o.cafe24_order_id));
      for (const order of toAdd) {
        const result = await createShipment({
          source: 'CAFE24', cafe24_order_id: order.cafe24_order_id,
          sender_name: order.orderer_name || order.recipient_name,
          sender_phone: order.orderer_phone || order.recipient_phone,
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
      setActiveTab('list');
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
      await fetchShipments(); setActiveTab('list');
    } catch (e: any) {
      setManualError(e.message || '저장 중 오류');
    } finally { setManualSaving(false); }
  };

  // ── 목록 탭 핸들러 ────────────────────────────────────────────────────────
  const filteredShipments = statusFilter === 'ALL' ? shipments : shipments.filter(s => s.status === statusFilter);

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

  const exportSelectedToExcel = () => {
    const toExport = filteredShipments.filter(s => selectedShipments.has(s.id));
    if (toExport.length === 0) return;
    const rows = toExport.map(s => ({
      '등록일': s.created_at?.slice(0, 10) ?? '',
      '출처': s.source === 'CAFE24' ? '카페24' : '직접입력',
      '발송자': s.sender_name,
      '발송자 전화': s.sender_phone,
      '수령자': s.recipient_name,
      '수령자 전화': s.recipient_phone,
      '우편번호': s.recipient_zipcode ?? '',
      '주소': s.recipient_address,
      '상세주소': s.recipient_address_detail ?? '',
      '배송 메모': s.delivery_message ?? '',
      '품목': s.items_summary ?? '',
      '상태': STATUS_LABEL[s.status] ?? s.status,
      '송장번호': s.tracking_number ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '배송목록');
    XLSX.writeFile(wb, `배송목록_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleEditOpen = (s: Shipment) => { setEditShipment(s); setEditForm({ ...s }); setEditError(''); };
  const handleEditClose = () => { setEditShipment(null); setEditForm({}); setEditError(''); };
  const handleEditSave = async () => {
    if (!editShipment) return;
    setEditSaving(true); setEditError('');
    try {
      await updateShipment(editShipment.id, editForm as any);
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
      <div>
        <h1 className="text-2xl font-bold text-slate-800">배송 관리</h1>
        <p className="text-slate-500 text-sm mt-1">카페24 주문 및 매장 주문의 배송을 관리합니다.</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          {([
            { key: 'cafe24', label: '카페24 주문' },
            { key: 'manual', label: '직접 입력' },
            { key: 'list', label: '배송 목록' },
          ] as { key: TabType; label: string }[]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>{tab.label}</button>
          ))}
        </nav>
      </div>

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
              <button className="btn-primary" onClick={handleLoadCafe24Orders} disabled={cafe24Loading || !startDate || !endDate}>
                {cafe24Loading ? '불러오는 중...' : '불러오기'}
              </button>
            </div>
            {cafe24Error && <p className="text-red-500 text-sm mt-2">{cafe24Error}</p>}
            {isDemo && (
              <div className="mt-3 flex items-center gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <span>⚠️ 데모 데이터 표시 중 ({demoReason})</span>
                <a href="/api/cafe24/auth" className="ml-auto px-3 py-1 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 whitespace-nowrap">
                  카페24 재인증
                </a>
              </div>
            )}
          </div>

          {cafe24Orders.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <span className="text-sm text-slate-600">총 {cafe24Orders.length}건</span>
                <div className="flex items-center gap-3">
                  {addError && <span className="text-red-500 text-sm">{addError}</span>}
                  <button className="btn-primary" onClick={handleAddSelectedOrders} disabled={selectedOrders.size === 0 || addingOrders}>
                    {addingOrders ? '추가 중...' : `선택한 주문 배송 추가 (${selectedOrders.size}건)`}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead><tr><th className="w-10"></th><th>주문일</th><th>주문자</th><th>수령자</th><th>주소</th><th>품목</th><th>금액</th><th>카페24 상태</th><th></th></tr></thead>
                  <tbody>
                    {cafe24Orders.map(order => (
                      <tr key={order.cafe24_order_id} className={order.already_added ? 'opacity-40' : ''}>
                        <td><input type="checkbox" checked={selectedOrders.has(order.cafe24_order_id)} onChange={() => toggleOrderSelect(order.cafe24_order_id)} disabled={order.already_added} className="w-4 h-4" /></td>
                        <td className="text-sm text-slate-600">{order.order_date?.slice(0, 10)}</td>
                        <td className="text-sm"><div>{order.orderer_name}</div><div className="text-slate-400 text-xs">{order.orderer_phone}</div></td>
                        <td className="text-sm"><div>{order.recipient_name}</div><div className="text-slate-400 text-xs">{order.recipient_phone}</div></td>
                        <td className="text-sm text-slate-600 max-w-[180px] truncate">{order.recipient_address}</td>
                        <td className="text-sm text-slate-600 max-w-[140px] truncate">{order.items_summary}</td>
                        <td className="text-sm text-slate-700">{order.total_price.toLocaleString()}원</td>
                        <td><span className={`${CAFE24_STATUS_BADGE[order.cafe24_status] ?? 'badge'} text-xs`}>{CAFE24_STATUS_LABEL[order.cafe24_status] ?? order.cafe24_status}</span></td>
                        <td>{order.already_added && <span className="badge badge-info text-xs">추가됨</span>}</td>
                      </tr>
                    ))}
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
            <div className="flex gap-1 flex-wrap">
              {(['ALL','PENDING','PRINTED','SHIPPED','DELIVERED'] as StatusFilter[]).map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    statusFilter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {f === 'ALL' ? '전체' : STATUS_LABEL[f]}
                </button>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              {/* 배송상태 일괄 추적 */}
              <button
                onClick={trackBatch}
                disabled={batchTracking}
                className="px-3 py-2 rounded text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {batchTracking ? batchProgress : '배송상태 일괄 업데이트'}
              </button>
              {/* 엑셀 임포트 */}
              <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
              <button
                onClick={() => importFileRef.current?.click()}
                className="px-3 py-2 rounded text-sm font-medium bg-amber-500 text-white hover:bg-amber-600"
              >
                엑셀로 송장번호 가져오기
              </button>
              {/* CJ 엑셀 다운로드 */}
              <button onClick={downloadCjExcel} className="px-3 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700">
                대한통운 엑셀 다운로드
              </button>
              {/* 선택 엑셀 익스포트 */}
              <button
                onClick={exportSelectedToExcel}
                disabled={selectedShipments.size === 0}
                className="px-3 py-2 rounded text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                선택 엑셀 익스포트 ({selectedShipments.size}건)
              </button>
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
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">수령자</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">발송자</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">배송지 주소</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">품목</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-20">출처</th>
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
                        <td className="px-3 py-3">
                          <div className="font-medium text-sm text-slate-800">{s.recipient_name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{s.recipient_phone}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-sm text-slate-700">{s.sender_name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{s.sender_phone}</div>
                        </td>
                        <td className="px-3 py-3 max-w-[200px]">
                          <div className="text-sm text-slate-700 truncate">{s.recipient_address}</div>
                          {s.recipient_address_detail && (
                            <div className="text-xs text-slate-400 mt-0.5 truncate">{s.recipient_address_detail}</div>
                          )}
                          {s.delivery_message && (
                            <div className="text-xs text-amber-600 mt-0.5 truncate">💬 {s.delivery_message}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 max-w-[160px]">
                          <div className="text-sm text-slate-600 truncate">{s.items_summary || <span className="text-slate-300">-</span>}</div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`${SOURCE_BADGE[s.source]} text-xs`}>{s.source === 'CAFE24' ? '카페24' : '직접'}</span>
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
                            {s.tracking_number && (
                              <button
                                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-40"
                                onClick={() => trackOne(s)}
                                disabled={trackingId === s.id}
                              >
                                {trackingId === s.id ? '...' : '추적'}
                              </button>
                            )}
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
                <p className="text-sm text-slate-500">엑셀에서 송장번호와 전화번호가 있는 열을 선택하세요.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">송장번호 열</label>
                    <select className="input w-full" value={importTrackingCol} onChange={e => setImportTrackingCol(Number(e.target.value))}>
                      {importHeaders.map((h, i) => <option key={i} value={i}>{h || `열 ${i + 1}`}</option>)}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">예시: {importRawRows[0]?.[importTrackingCol]}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">매칭 기준 열 (전화번호)</label>
                    <select className="input w-full" value={importPhoneCol} onChange={e => setImportPhoneCol(Number(e.target.value))}>
                      {importHeaders.map((h, i) => <option key={i} value={i}>{h || `열 ${i + 1}`}</option>)}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">예시: {importRawRows[0]?.[importPhoneCol]}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary flex-1" onClick={handleImportPreview}>미리보기</button>
                  <button className="flex-1 px-4 py-2 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setImportStep(0)}>취소</button>
                </div>
              </div>
            )}

            {importStep === 2 && (
              <div className="space-y-4">
                <div className="overflow-x-auto max-h-96">
                  <table className="table w-full text-sm">
                    <thead>
                      <tr><th>수령자 전화</th><th>송장번호</th><th>수령자명</th><th>상태</th></tr>
                    </thead>
                    <tbody>
                      {importPreview.map((row, i) => (
                        <tr key={i} className={!row.matched ? 'opacity-40' : ''}>
                          <td className="font-mono text-xs">{row.matchPhone}</td>
                          <td className="font-mono text-xs">{row.trackingNo}</td>
                          <td>{row.matched?.recipient_name || '-'}</td>
                          <td>
                            {!row.matched ? (
                              <span className="text-slate-400 text-xs">미매칭</span>
                            ) : row.alreadyHas ? (
                              <span className="text-amber-500 text-xs">이미 있음</span>
                            ) : (
                              <span className="text-green-600 text-xs font-medium">등록 예정</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary flex-1" onClick={handleImportConfirm} disabled={importSaving || importPreview.filter(r => r.matched && !r.alreadyHas).length === 0}>
                    {importSaving ? '등록 중...' : `송장번호 ${importPreview.filter(r => r.matched && !r.alreadyHas).length}건 등록`}
                  </button>
                  <button className="px-4 py-2 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setImportStep(1)}>← 다시 선택</button>
                  <button className="px-4 py-2 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setImportStep(0)}>취소</button>
                </div>
              </div>
            )}
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
    </div>
  );
}
