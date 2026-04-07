'use client';

import { useState, useEffect } from 'react';
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
}

type TabType = 'cafe24' | 'manual' | 'list';
type StatusFilter = 'ALL' | 'PENDING' | 'PRINTED' | 'SHIPPED' | 'DELIVERED';

const STATUS_LABEL: Record<string, string> = {
  PENDING: '대기중',
  PRINTED: '출력완료',
  SHIPPED: '발송완료',
  DELIVERED: '배송완료',
};

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge',
  PRINTED: 'badge badge-info',
  SHIPPED: 'badge badge-warning',
  DELIVERED: 'badge badge-success',
};

const SOURCE_BADGE: Record<string, string> = {
  CAFE24: 'badge badge-info',
  STORE: 'badge badge-success',
};

export default function ShippingPage() {
  const [activeTab, setActiveTab] = useState<TabType>('cafe24');

  // Cafe24 tab state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [cafe24Orders, setCafe24Orders] = useState<Cafe24OrderForShipping[]>([]);
  const [cafe24Loading, setCafe24Loading] = useState(false);
  const [cafe24Error, setCafe24Error] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [addingOrders, setAddingOrders] = useState(false);

  // Manual tab state
  const [manualForm, setManualForm] = useState({
    sender_name: '',
    sender_phone: '',
    sender_address: '',
    recipient_name: '',
    recipient_phone: '',
    recipient_zipcode: '',
    recipient_address: '',
    recipient_address_detail: '',
    delivery_message: '',
    items_summary: '',
  });
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState('');

  // List tab state
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [editShipment, setEditShipment] = useState<Shipment | null>(null);
  const [editForm, setEditForm] = useState<Partial<Shipment>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

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
    if (activeTab === 'list') {
      fetchShipments();
    }
  }, [activeTab]);

  // ── 대한통운 엑셀 다운로드 ─────────────────────────────────────────────────
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
      s.recipient_name,
      s.recipient_phone,
      '',
      [s.recipient_address, s.recipient_address_detail].filter(Boolean).join(' '),
      s.delivery_message || '',
      s.items_summary || '',
      '',
      '',
      '선불',
      s.sender_name,
      s.sender_phone,
      s.sender_address || '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

    // 컬럼 너비 설정
    ws['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 50 }, { wch: 30 },
      { wch: 24 }, { wch: 16 }, { wch: 8 },  { wch: 8 },
      { wch: 12 }, { wch: 16 }, { wch: 40 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'sheet1');

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    XLSX.writeFile(wb, `CJ대한통운_${date}.xlsx`);
  };

  // Cafe24 tab handlers
  const handleLoadCafe24Orders = async () => {
    if (!startDate || !endDate) return;
    setCafe24Loading(true);
    setCafe24Error('');
    setSelectedOrders(new Set());
    try {
      const res = await fetch(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}`);
      if (!res.ok) throw new Error('불러오기 실패');
      const data = await res.json();
      setCafe24Orders(data);
    } catch (e: any) {
      setCafe24Error(e.message || '오류가 발생했습니다.');
    } finally {
      setCafe24Loading(false);
    }
  };

  const toggleOrderSelect = (orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const handleAddSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setAddingOrders(true);
    try {
      const toAdd = cafe24Orders.filter(o => selectedOrders.has(o.cafe24_order_id));
      for (const order of toAdd) {
        await createShipment({
          source: 'CAFE24',
          cafe24_order_id: order.cafe24_order_id,
          sender_name: order.orderer_name,
          sender_phone: order.orderer_phone,
          recipient_name: order.recipient_name,
          recipient_phone: order.recipient_phone,
          recipient_address: order.recipient_address,
          delivery_message: order.delivery_message,
          items_summary: order.items_summary,
        });
      }
      await fetchShipments();
      setActiveTab('list');
    } finally {
      setAddingOrders(false);
    }
  };

  // Manual tab handlers
  const handleManualChange = (field: string, value: string) => {
    setManualForm(prev => ({ ...prev, [field]: value }));
  };

  const handleManualSubmit = async () => {
    if (!manualForm.sender_name || !manualForm.sender_phone || !manualForm.recipient_name || !manualForm.recipient_phone || !manualForm.recipient_address) {
      setManualError('필수 항목을 모두 입력해주세요.');
      return;
    }
    setManualSaving(true);
    setManualError('');
    try {
      await createShipment({
        source: 'STORE',
        sender_name: manualForm.sender_name,
        sender_phone: manualForm.sender_phone,
        sender_address: manualForm.sender_address || undefined,
        recipient_name: manualForm.recipient_name,
        recipient_phone: manualForm.recipient_phone,
        recipient_zipcode: manualForm.recipient_zipcode || undefined,
        recipient_address: manualForm.recipient_address,
        recipient_address_detail: manualForm.recipient_address_detail || undefined,
        delivery_message: manualForm.delivery_message || undefined,
        items_summary: manualForm.items_summary || undefined,
      });
      setManualForm({
        sender_name: '',
        sender_phone: '',
        sender_address: '',
        recipient_name: '',
        recipient_phone: '',
        recipient_zipcode: '',
        recipient_address: '',
        recipient_address_detail: '',
        delivery_message: '',
        items_summary: '',
      });
      await fetchShipments();
      setActiveTab('list');
    } catch (e: any) {
      setManualError(e.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setManualSaving(false);
    }
  };

  // List tab handlers
  const filteredShipments = statusFilter === 'ALL'
    ? shipments
    : shipments.filter(s => s.status === statusFilter);

  const handleEditOpen = (s: Shipment) => {
    setEditShipment(s);
    setEditForm({ ...s });
    setEditError('');
  };

  const handleEditClose = () => {
    setEditShipment(null);
    setEditForm({});
    setEditError('');
  };

  const handleEditSave = async () => {
    if (!editShipment) return;
    setEditSaving(true);
    setEditError('');
    try {
      await updateShipment(editShipment.id, editForm as any);
      await fetchShipments();
      handleEditClose();
    } catch (e: any) {
      setEditError(e.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await deleteShipment(id);
    await fetchShipments();
  };

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
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab: Cafe24 */}
      {activeTab === 'cafe24' && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">시작일</label>
                <input
                  type="date"
                  className="input"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">종료일</label>
                <input
                  type="date"
                  className="input"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                />
              </div>
              <button
                className="btn-primary"
                onClick={handleLoadCafe24Orders}
                disabled={cafe24Loading || !startDate || !endDate}
              >
                {cafe24Loading ? '불러오는 중...' : '불러오기'}
              </button>
            </div>
            {cafe24Error && <p className="text-red-500 text-sm mt-2">{cafe24Error}</p>}
          </div>

          {cafe24Orders.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <span className="text-sm text-slate-600">총 {cafe24Orders.length}건</span>
                <button
                  className="btn-primary"
                  onClick={handleAddSelectedOrders}
                  disabled={selectedOrders.size === 0 || addingOrders}
                >
                  {addingOrders ? '추가 중...' : `선택한 주문 배송 추가 (${selectedOrders.size}건)`}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="w-10"></th>
                      <th>주문일</th>
                      <th>주문자</th>
                      <th>수령자</th>
                      <th>주소</th>
                      <th>품목</th>
                      <th>금액</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cafe24Orders.map(order => (
                      <tr
                        key={order.cafe24_order_id}
                        className={order.already_added ? 'opacity-40' : ''}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedOrders.has(order.cafe24_order_id)}
                            onChange={() => toggleOrderSelect(order.cafe24_order_id)}
                            disabled={order.already_added}
                            className="w-4 h-4"
                          />
                        </td>
                        <td className="text-sm text-slate-600">{order.order_date?.slice(0, 10)}</td>
                        <td className="text-sm">
                          <div>{order.orderer_name}</div>
                          <div className="text-slate-400 text-xs">{order.orderer_phone}</div>
                        </td>
                        <td className="text-sm">
                          <div>{order.recipient_name}</div>
                          <div className="text-slate-400 text-xs">{order.recipient_phone}</div>
                        </td>
                        <td className="text-sm text-slate-600 max-w-[180px] truncate">{order.recipient_address}</td>
                        <td className="text-sm text-slate-600 max-w-[140px] truncate">{order.items_summary}</td>
                        <td className="text-sm text-slate-700">{order.total_price.toLocaleString()}원</td>
                        <td>
                          {order.already_added && (
                            <span className="badge badge-info text-xs">이미 추가됨</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Manual */}
      {activeTab === 'manual' && (
        <div className="card p-6 max-w-2xl space-y-6">
          {/* Sender */}
          <div className="bg-slate-50 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">발송자 정보</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">발송자 이름 <span className="text-red-500">*</span></label>
                <input
                  className="input w-full"
                  value={manualForm.sender_name}
                  onChange={e => handleManualChange('sender_name', e.target.value)}
                  placeholder="홍길동"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">발송자 전화번호 <span className="text-red-500">*</span></label>
                <input
                  className="input w-full"
                  value={manualForm.sender_phone}
                  onChange={e => handleManualChange('sender_phone', e.target.value)}
                  placeholder="010-0000-0000"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">발송자 주소 <span className="text-xs text-slate-400">(대한통운 엑셀 필수)</span></label>
              <input
                className="input w-full"
                value={manualForm.sender_address}
                onChange={e => handleManualChange('sender_address', e.target.value)}
                placeholder="서울시 강남구 청담동 11-1"
              />
            </div>
          </div>

          {/* Recipient */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">수령자 정보</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">수령자 이름 <span className="text-red-500">*</span></label>
                <input
                  className="input w-full"
                  value={manualForm.recipient_name}
                  onChange={e => handleManualChange('recipient_name', e.target.value)}
                  placeholder="홍길동"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">수령자 전화번호 <span className="text-red-500">*</span></label>
                <input
                  className="input w-full"
                  value={manualForm.recipient_phone}
                  onChange={e => handleManualChange('recipient_phone', e.target.value)}
                  placeholder="010-0000-0000"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">우편번호</label>
                <input
                  className="input w-full"
                  value={manualForm.recipient_zipcode}
                  onChange={e => handleManualChange('recipient_zipcode', e.target.value)}
                  placeholder="12345"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1">주소 <span className="text-red-500">*</span></label>
                <input
                  className="input w-full"
                  value={manualForm.recipient_address}
                  onChange={e => handleManualChange('recipient_address', e.target.value)}
                  placeholder="서울시 강남구 테헤란로 123"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">상세주소</label>
              <input
                className="input w-full"
                value={manualForm.recipient_address_detail}
                onChange={e => handleManualChange('recipient_address_detail', e.target.value)}
                placeholder="101동 201호"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">배송 메모</label>
              <input
                className="input w-full"
                value={manualForm.delivery_message}
                onChange={e => handleManualChange('delivery_message', e.target.value)}
                placeholder="문 앞에 놓아주세요"
              />
            </div>
          </div>

          {/* Items */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">품목 메모</label>
            <textarea
              className="input w-full resize-none"
              rows={3}
              value={manualForm.items_summary}
              onChange={e => handleManualChange('items_summary', e.target.value)}
              placeholder="예: 경옥고 100g x2, 홍삼정 외 1건"
            />
          </div>

          {manualError && <p className="text-red-500 text-sm">{manualError}</p>}

          <button
            className="btn-primary w-full"
            onClick={handleManualSubmit}
            disabled={manualSaving}
          >
            {manualSaving ? '등록 중...' : '등록'}
          </button>
        </div>
      )}

      {/* Tab: List */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* Status filter */}
            <div className="flex gap-1 flex-wrap">
              {([
                { value: 'ALL', label: '전체' },
                { value: 'PENDING', label: '대기' },
                { value: 'PRINTED', label: '출력완료' },
                { value: 'SHIPPED', label: '발송완료' },
                { value: 'DELIVERED', label: '배송완료' },
              ] as { value: StatusFilter; label: string }[]).map(f => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    statusFilter === f.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={downloadCjExcel}
              className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              대한통운 엑셀 다운로드
            </button>
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
                    <tr>
                      <th>출처</th>
                      <th>등록일</th>
                      <th>발송자</th>
                      <th>수령자</th>
                      <th>주소</th>
                      <th>품목</th>
                      <th>상태</th>
                      <th>송장번호</th>
                      <th>액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredShipments.map(s => (
                      <tr key={s.id}>
                        <td>
                          <span className={SOURCE_BADGE[s.source]}>
                            {s.source}
                          </span>
                        </td>
                        <td className="text-sm text-slate-600">{s.created_at?.slice(0, 10)}</td>
                        <td className="text-sm">
                          <div>{s.sender_name}</div>
                          <div className="text-slate-400 text-xs">{s.sender_phone}</div>
                        </td>
                        <td className="text-sm">
                          <div>{s.recipient_name}</div>
                          <div className="text-slate-400 text-xs">{s.recipient_phone}</div>
                        </td>
                        <td className="text-sm text-slate-600 max-w-[160px] truncate">
                          {s.recipient_address}
                          {s.recipient_address_detail && ` ${s.recipient_address_detail}`}
                        </td>
                        <td className="text-sm text-slate-600 max-w-[120px] truncate">{s.items_summary || '-'}</td>
                        <td>
                          <span className={STATUS_BADGE[s.status]}>
                            {STATUS_LABEL[s.status]}
                          </span>
                        </td>
                        <td className="text-sm">
                          {s.tracking_number ? (
                            <a
                              href={`https://trace.cjlogistics.com/web/detail.jsp?slipno=${s.tracking_number}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-blue-600 hover:underline"
                            >
                              {s.tracking_number}
                            </a>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td>
                          <div className="flex gap-2">
                            <button
                              className="text-xs text-blue-600 hover:underline"
                              onClick={() => handleEditOpen(s)}
                            >
                              수정
                            </button>
                            {s.status === 'PENDING' && (
                              <button
                                className="text-xs text-red-500 hover:underline"
                                onClick={() => handleDelete(s.id)}
                              >
                                삭제
                              </button>
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

      {/* Edit Modal */}
      {editShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">배송 수정</h2>
              <button onClick={handleEditClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>

            {/* Sender */}
            <div className="bg-slate-50 rounded-lg p-3 space-y-3">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">발송자 정보</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">발송자 이름</label>
                  <input
                    className="input w-full"
                    value={editForm.sender_name ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, sender_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">발송자 전화번호</label>
                  <input
                    className="input w-full"
                    value={editForm.sender_phone ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, sender_phone: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">발송자 주소</label>
                <input
                  className="input w-full"
                  value={(editForm as any).sender_address ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, sender_address: e.target.value }))}
                  placeholder="서울시 강남구 청담동 11-1"
                />
              </div>
            </div>

            {/* Recipient */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">수령자 정보</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">수령자 이름</label>
                  <input
                    className="input w-full"
                    value={editForm.recipient_name ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, recipient_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">수령자 전화번호</label>
                  <input
                    className="input w-full"
                    value={editForm.recipient_phone ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, recipient_phone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">우편번호</label>
                  <input
                    className="input w-full"
                    value={editForm.recipient_zipcode ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, recipient_zipcode: e.target.value || null }))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-slate-500 block mb-1">주소</label>
                  <input
                    className="input w-full"
                    value={editForm.recipient_address ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, recipient_address: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">상세주소</label>
                <input
                  className="input w-full"
                  value={editForm.recipient_address_detail ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, recipient_address_detail: e.target.value || null }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">배송 메모</label>
                <input
                  className="input w-full"
                  value={editForm.delivery_message ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, delivery_message: e.target.value || null }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">품목 메모</label>
                <input
                  className="input w-full"
                  value={editForm.items_summary ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, items_summary: e.target.value || null }))}
                />
              </div>
            </div>

            {/* Tracking & Status */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">송장번호</label>
                <input
                  className="input w-full"
                  value={editForm.tracking_number ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, tracking_number: e.target.value || null }))}
                  placeholder="숫자 입력"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">상태</label>
                <select
                  className="input w-full"
                  value={editForm.status ?? 'PENDING'}
                  onChange={e => setEditForm(f => ({ ...f, status: e.target.value as Shipment['status'] }))}
                >
                  {Object.entries(STATUS_LABEL).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            {editError && <p className="text-red-500 text-sm">{editError}</p>}

            <div className="flex gap-2 pt-2">
              <button className="btn-primary flex-1" onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? '저장 중...' : '저장'}
              </button>
              <button className="flex-1 px-4 py-2 rounded border border-slate-300 text-slate-600 text-sm hover:bg-slate-50" onClick={handleEditClose}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
