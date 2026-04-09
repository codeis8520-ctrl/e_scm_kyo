'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { validators, formatPhone } from '@/lib/validators';
import { sendSmsAction, sendKakaoAction, getNotifications, resendFailedNotification, runNotificationBatch } from '@/lib/notification-actions';
import { getTemplateMappings } from '@/lib/notification-template-mapping-actions';
import { EVENT_TYPES, type TemplateMapping } from '@/lib/notification-event-types';

const TYPE_LABEL: Record<string, string> = { KAKAO: '알림톡', SMS: 'SMS' };
const STATUS_LABEL: Record<string, string> = { sent: '발송완료', pending: '대기중', failed: '실패' };
const STATUS_BADGE: Record<string, string> = {
  sent:    'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed:  'bg-red-100 text-red-600',
};
const GRADE_LABELS: Record<string, string> = { VVIP: 'VVIP', VIP: 'VIP', NORMAL: '일반' };
const GRADE_BADGE: Record<string, string> = {
  VVIP: 'bg-red-100 text-red-700',
  VIP:  'bg-amber-100 text-amber-700',
  NORMAL: 'bg-slate-100 text-slate-500',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [templates, setTemplates]         = useState<any[]>([]);
  const [templateMappings, setTemplateMappings] = useState<Record<string, TemplateMapping>>({});
  const [customers, setCustomers]         = useState<any[]>([]);
  const [loading, setLoading]             = useState(true);
  const [activeTab, setActiveTab]         = useState<'kakao' | 'sms'>('kakao'); // 기본값: 알림톡
  const [showSendModal, setShowSendModal] = useState(false);
  const [statusFilter, setStatusFilter]   = useState('');
  // 검색 조건 (탭별 독립)
  const [searchKeyword, setSearchKeyword] = useState('');
  const [startDate, setStartDate]         = useState('');
  const [endDate, setEndDate]             = useState('');
  const [sourceFilter, setSourceFilter]   = useState(''); // MANUAL | AUTO_EVENT | SCHEDULED
  const [resendingId, setResendingId]     = useState<string | null>(null);
  const [batchRunning, setBatchRunning]   = useState<string | null>(null);

  // 탭별 타입 매핑
  const typeByTab: Record<'kakao' | 'sms', string> = { kakao: 'KAKAO', sms: 'SMS' };

  const fetchData = async () => {
    setLoading(true);
    const [notifRes, templateRes, mappingRes, customerRes] = await Promise.all([
      getNotifications({
        status: statusFilter || undefined,
        type: typeByTab[activeTab], // 탭 기준으로 유형 강제
      }),
      fetch('/api/solapi/templates').then(r => r.json()).then(d => d.templates ?? []),
      getTemplateMappings(),
      (async () => {
        const supabase = createClient() as any;
        const { data } = await supabase.from('customers').select('id, name, phone, grade').eq('is_active', true).order('name');
        return data || [];
      })(),
    ]);

    setNotifications(notifRes.data || []);
    setTemplates(templateRes);
    setTemplateMappings(mappingRes.data || {});
    setCustomers(customerRes);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [statusFilter, activeTab]);

  // 탭 전환 시 검색 조건 초기화 (각 탭별 독립)
  const handleTabChange = (tab: 'kakao' | 'sms') => {
    setActiveTab(tab);
    setSearchKeyword('');
    setStatusFilter('');
    setStartDate('');
    setEndDate('');
    setSourceFilter('');
  };

  const handleResend = async (id: string) => {
    if (!confirm('이 건을 재발송하시겠습니까?')) return;
    setResendingId(id);
    const res = await resendFailedNotification(id);
    setResendingId(null);
    if (res.error) {
      alert('재발송 실패: ' + res.error);
    } else {
      alert(res.resent ? '재발송 완료' : '재발송 시도 했으나 실패로 기록됨');
      fetchData();
    }
  };

  const handleRunBatch = async (batchType: 'BIRTHDAY' | 'DORMANT') => {
    const label = batchType === 'BIRTHDAY' ? '오늘 생일 고객에게 축하 알림톡' : '최근 90일 미구매 휴면 고객 재유치 알림톡';
    if (!confirm(`${label}을(를) 즉시 발송하시겠습니까?`)) return;
    setBatchRunning(batchType);
    const res = await runNotificationBatch(batchType, batchType === 'DORMANT' ? { days: 90, limit: 50 } : undefined);
    setBatchRunning(null);
    if (res.error) {
      alert('배치 실패: ' + res.error);
    } else {
      alert(`배치 완료 — 대상 ${res.target}, 성공 ${res.sent}, 실패 ${res.failed}, 스킵 ${res.skipped}`);
      fetchData();
    }
  };

  // 탭 필터 + 검색어 + 날짜 범위 + 발송 출처 필터링
  const filteredNotifications = notifications.filter(n => {
    if (sourceFilter && (n.trigger_source || 'MANUAL') !== sourceFilter) return false;
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      const inName = (n.customer?.name || '').toLowerCase().includes(kw);
      const inPhone = String(n.phone || '').replace(/-/g, '').includes(kw.replace(/-/g, ''));
      const inMsg = (n.message || '').toLowerCase().includes(kw);
      const inErr = (n.error_message || '').toLowerCase().includes(kw);
      if (!inName && !inPhone && !inMsg && !inErr) return false;
    }
    if (startDate) {
      const d = new Date(n.created_at).getTime();
      if (d < new Date(`${startDate}T00:00:00`).getTime()) return false;
    }
    if (endDate) {
      const d = new Date(n.created_at).getTime();
      if (d > new Date(`${endDate}T23:59:59`).getTime()) return false;
    }
    return true;
  });

  const stats = {
    total:   filteredNotifications.length,
    sent:    filteredNotifications.filter(n => n.status === 'sent').length,
    failed:  filteredNotifications.filter(n => n.status === 'failed').length,
    pending: filteredNotifications.filter(n => n.status === 'pending').length,
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 border-b border-slate-200">
          {(['kakao', 'sms'] as const).map(t => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'kakao' ? '알림톡' : 'SMS'}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => handleRunBatch('BIRTHDAY')}
            disabled={batchRunning === 'BIRTHDAY'}
            className="px-3 py-2 rounded text-sm font-medium bg-pink-50 text-pink-600 hover:bg-pink-100 disabled:opacity-50"
            title="오늘 생일 고객에게 축하 알림톡 즉시 발송"
          >
            🎂 {batchRunning === 'BIRTHDAY' ? '실행 중...' : '생일 배치'}
          </button>
          <button
            onClick={() => handleRunBatch('DORMANT')}
            disabled={batchRunning === 'DORMANT'}
            className="px-3 py-2 rounded text-sm font-medium bg-amber-50 text-amber-600 hover:bg-amber-100 disabled:opacity-50"
            title="90일간 미구매 고객에게 재유치 알림톡 즉시 발송"
          >
            💤 {batchRunning === 'DORMANT' ? '실행 중...' : '휴면 배치'}
          </button>
          <Link href="/notifications/templates" className="px-3 py-2 rounded text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">
            템플릿 관리
          </Link>
          <button onClick={() => setShowSendModal(true)} className="btn-primary text-sm">
            + {activeTab === 'sms' ? 'SMS' : '알림톡'} 발송
          </button>
        </div>
      </div>

      {/* 통계 (현재 탭 기준) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="stat-card">
          <p className="text-sm text-slate-500">총 {activeTab === 'kakao' ? '알림톡' : 'SMS'}</p>
          <p className={`text-2xl font-bold ${activeTab === 'kakao' ? 'text-purple-600' : 'text-blue-600'}`}>{stats.total}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">발송 완료</p>
          <p className="text-2xl font-bold text-green-600">{stats.sent}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">실패</p>
          <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">대기중</p>
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
        </div>
      </div>

      {/* 필터 + 테이블 */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap items-start sm:items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">검색어</label>
            <input
              type="text"
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              placeholder="이름 / 전화 / 메시지 / 오류"
              className="input text-sm py-1.5 w-52"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">시작일</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input text-sm py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">종료일</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input text-sm py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">상태</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-32 text-sm py-1.5">
              <option value="">전체</option>
              <option value="sent">발송완료</option>
              <option value="failed">실패</option>
              <option value="pending">대기중</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">출처</label>
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="input w-32 text-sm py-1.5">
              <option value="">전체</option>
              <option value="MANUAL">수동</option>
              <option value="AUTO_EVENT">자동 (이벤트)</option>
              <option value="SCHEDULED">배치 (스케줄)</option>
            </select>
          </div>
          {(searchKeyword || startDate || endDate || statusFilter || sourceFilter) && (
            <button
              onClick={() => { setSearchKeyword(''); setStartDate(''); setEndDate(''); setStatusFilter(''); setSourceFilter(''); }}
              className="text-xs text-slate-500 hover:text-slate-700 underline py-1.5"
            >
              초기화
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
        <table className="table min-w-[700px]">
          <thead>
            <tr>
              <th>발송일시</th>
              <th>출처</th>
              <th>수신자</th>
              <th>연락처</th>
              <th>메시지</th>
              <th>상태</th>
              <th>오류</th>
              <th>동작</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8">로딩 중...</td></tr>
            ) : filteredNotifications.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">
                {notifications.length === 0
                  ? `${activeTab === 'kakao' ? '알림톡' : 'SMS'} 발송 기록이 없습니다`
                  : '검색 조건에 맞는 기록이 없습니다'}
              </td></tr>
            ) : filteredNotifications.map(n => {
              const src = n.trigger_source || 'MANUAL';
              const srcLabel: Record<string, string> = { MANUAL: '수동', AUTO_EVENT: '자동', SCHEDULED: '배치' };
              const srcColor: Record<string, string> = {
                MANUAL: 'bg-slate-100 text-slate-600',
                AUTO_EVENT: 'bg-blue-100 text-blue-700',
                SCHEDULED: 'bg-purple-100 text-purple-700',
              };
              return (
                <tr key={n.id}>
                  <td className="text-sm text-slate-500 whitespace-nowrap">{new Date(n.created_at).toLocaleString('ko-KR')}</td>
                  <td>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${srcColor[src] || ''}`}>
                      {srcLabel[src] || src}
                    </span>
                  </td>
                  <td className="text-sm">{n.customer?.name || '-'}</td>
                  <td className="font-mono text-sm">{n.phone}</td>
                  <td className="max-w-xs text-sm truncate text-slate-600">{n.message}</td>
                  <td>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[n.status] || ''}`}>
                      {STATUS_LABEL[n.status] || n.status}
                    </span>
                  </td>
                  <td className="text-xs text-red-500 max-w-[120px] truncate" title={n.error_message || ''}>{n.error_message || ''}</td>
                  <td>
                    {n.status === 'failed' && (
                      <button
                        onClick={() => handleResend(n.id)}
                        disabled={resendingId === n.id}
                        className="text-xs text-blue-600 hover:underline disabled:text-slate-300"
                      >
                        {resendingId === n.id ? '...' : '재발송'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {showSendModal && (
        <SendModal
          type={activeTab}
          templates={templates}
          templateMappings={templateMappings}
          customers={customers}
          onClose={() => setShowSendModal(false)}
          onSuccess={() => { setShowSendModal(false); fetchData(); }}
        />
      )}
    </div>
  );
}

// ─── 발송 모달 ─────────────────────────────────────────────────────────────────

interface SendModalProps {
  type: 'kakao' | 'sms';
  templates: any[];
  templateMappings: Record<string, TemplateMapping>;
  customers: any[];
  onClose: () => void;
  onSuccess: () => void;
}

// 시스템에서 자동 제공 불가 → 사용자 직접 입력 필요한 변수 감지
const PRODUCT_PAT  = /^(상품명|제품명|품목|상품)$/;
const ORDER_PAT    = /^(주문번호|주문_번호|오더번호)$/;
const TRACKING_PAT = /^(송장번호|운송장번호|배송번호|운송번호)$/;
const AMOUNT_PAT   = /^(금액|결제금액|주문금액|가격|amount)$/i;
const AUTH_PAT     = /^(인증번호|인증코드|otp)$/i;
// 자동 처리 패턴 (고객명, 전화번호, 등급, 지점명, URL 등)
const AUTO_PAT = /^([가-힣]{2,3}|고객명|이름|성함|회원명|구매자명|주문자명|수신자명|신청자명|고객이름|회원이름|받는분|구매자|주문자|수신자|고객|전화번호|연락처|핸드폰|휴대폰|휴대전화|등급|회원등급|고객등급|상점명|상점|매장명|매장|브랜드명|브랜드|업체명|업체|회사명|회사|가게명|가게|샵명|샵|url|링크|사이트|홈페이지|주소)$/i;

interface ManualField { key: string; label: string; contextKey: string; }

function detectManualFields(keys: string[]): ManualField[] {
  return keys.flatMap(key => {
    const inner = key.replace(/^#\{/, '').replace(/\}$/, '').trim();
    if (PRODUCT_PAT.test(inner))  return [{ key, label: '상품명', contextKey: 'productName' }];
    if (ORDER_PAT.test(inner))    return [{ key, label: '주문번호', contextKey: 'orderNo' }];
    if (TRACKING_PAT.test(inner)) return [{ key, label: '송장번호', contextKey: 'trackingNo' }];
    if (AMOUNT_PAT.test(inner))   return [{ key, label: '결제금액', contextKey: 'amount' }];
    if (AUTH_PAT.test(inner))     return [{ key, label: '인증번호', contextKey: 'authCode' }];
    if (!AUTO_PAT.test(inner))    return [{ key, label: inner, contextKey: inner }];
    return [];
  });
}

function SendModal({ type, templates, templateMappings, customers, onClose, onSuccess }: SendModalProps) {
  const [sendMode, setSendMode]                   = useState<'bulk' | 'single'>('bulk');
  const [showEventOnly, setShowEventOnly]         = useState(false); // 이벤트 전용 템플릿까지 보기
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch]       = useState('');
  const [gradeFilter, setGradeFilter]             = useState('');
  const [phone, setPhone]                         = useState('');
  const [phoneError, setPhoneError]               = useState('');
  const [templateId, setTemplateId]               = useState('');
  const [templateContent, setTemplateContent]     = useState('');
  const [variableKeys, setVariableKeys]           = useState<string[]>([]);
  const [manualFields, setManualFields]           = useState<ManualField[]>([]);
  const [manualVars, setManualVars]               = useState<Record<string, string>>({});
  const [message, setMessage]                     = useState('');
  const [submitting, setSubmitting]               = useState(false);
  const [result, setResult]                       = useState<{ successCount: number; failCount: number } | null>(null);

  const filteredCustomers = customers
    .filter(c => {
      const matchSearch = !customerSearch ||
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.phone.replace(/-/g, '').includes(customerSearch.replace(/-/g, ''));
      const matchGrade = !gradeFilter || c.grade === gradeFilter;
      return matchSearch && matchGrade;
    })
    .slice(0, 100);

  const toggleCustomer = (id: string) =>
    setSelectedCustomerIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleSend = async () => {
    setSubmitting(true);
    setResult(null);

    let targets: { customerId: string | null; phone: string; name?: string }[];

    if (sendMode === 'bulk') {
      if (selectedCustomerIds.length === 0) { alert('발송 대상을 선택해주세요.'); setSubmitting(false); return; }
      targets = selectedCustomerIds.map(id => {
        const c = customers.find(c => c.id === id);
        return { customerId: id, phone: c?.phone || '', name: c?.name };
      });
    } else {
      const err = validators.phone(phone);
      if (err) { setPhoneError(err); setSubmitting(false); return; }
      targets = [{ customerId: null, phone }];
    }

    if (type === 'sms' && !message.trim()) { alert('메시지를 입력해주세요.'); setSubmitting(false); return; }

    let res;
    if (type === 'sms') {
      res = await sendSmsAction({ targets, message });
    } else {
      if (!templateId) {
        alert('템플릿을 선택해주세요.');
        setSubmitting(false);
        return;
      }
      // manualVars: { '#{상품명}': '경옥채 크림' } → context: { productName: '경옥채 크림' }
      const context: Record<string, string> = {};
      manualFields.forEach(f => {
        if (manualVars[f.key]) context[f.contextKey] = manualVars[f.key];
      });
      res = await sendKakaoAction({
        targets,
        templateId,
        templateContent,
        variableKeys,
        context: context as any,
      });
    }

    setSubmitting(false);

    if (res.error) { alert(res.error); return; }

    setResult({ successCount: res.successCount ?? 0, failCount: res.failCount ?? 0 });
  };

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
        <div className="bg-white w-full max-w-sm mx-4 sm:mx-auto rounded-t-xl sm:rounded-xl p-6 sm:p-8 text-center shadow-xl">
          <div className="text-4xl mb-3">{result.failCount === 0 ? '✅' : '⚠️'}</div>
          <h3 className="text-lg font-bold mb-2">발송 완료</h3>
          <p className="text-slate-600 mb-1">성공 <span className="font-bold text-green-600">{result.successCount}건</span></p>
          {result.failCount > 0 && (
            <p className="text-slate-600 mb-1">실패 <span className="font-bold text-red-600">{result.failCount}건</span></p>
          )}
          <button onClick={onSuccess} className="mt-6 w-full btn-primary">확인</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl shadow-xl">
        <div className="flex justify-between items-center px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h2 className="font-bold text-slate-800">
            {type === 'sms' ? 'SMS' : '알림톡'} 발송
            <span className="text-sm font-normal text-slate-500 ml-2">({sendMode === 'bulk' ? '단체' : '단일'})</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* 발송 모드 */}
          <div className="flex gap-2">
            {(['bulk', 'single'] as const).map(m => (
              <button
                key={m}
                onClick={() => setSendMode(m)}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  sendMode === m ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m === 'bulk' ? '단체 발송' : '단일 발송'}
              </button>
            ))}
          </div>

          {/* 수신자 선택 */}
          {sendMode === 'bulk' ? (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium">발송 대상 ({selectedCustomerIds.length}명 / 전체 {filteredCustomers.length}명)</label>
                <div className="flex gap-3 text-xs">
                  <button onClick={() => setSelectedCustomerIds(filteredCustomers.map(c => c.id))} className="text-blue-600 hover:underline">전체 선택</button>
                  <button onClick={() => setSelectedCustomerIds([])} className="text-slate-500 hover:underline">선택 해제</button>
                </div>
              </div>
              {/* 등급 빠른 필터 */}
              <div className="flex gap-1.5 flex-wrap">
                {[['', '전체'], ['VVIP', 'VVIP'], ['VIP', 'VIP'], ['NORMAL', '일반']].map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => { setGradeFilter(v); setSelectedCustomerIds([]); }}
                    className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
                      gradeFilter === v
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {label}
                    {v && <span className="ml-1 opacity-60">{customers.filter(c => c.grade === v).length}</span>}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="이름 / 전화번호 검색"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                className="input text-sm"
              />
              <div className="border rounded-lg max-h-40 sm:max-h-52 overflow-auto">
                {filteredCustomers.map(c => (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0 cursor-pointer">
                    <input type="checkbox" checked={selectedCustomerIds.includes(c.id)} onChange={() => toggleCustomer(c.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.phone}</p>
                    </div>
                    <span className={`shrink-0 px-1.5 py-0.5 text-xs rounded ${GRADE_BADGE[c.grade] || 'bg-slate-100 text-slate-500'}`}>
                      {GRADE_LABELS[c.grade] || c.grade}
                    </span>
                  </label>
                ))}
                {filteredCustomers.length === 0 && (
                  <p className="text-center text-slate-400 py-4 text-sm">검색 결과 없음</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">연락처 *</label>
              <input
                type="tel"
                value={phone}
                onChange={e => { setPhone(formatPhone(e.target.value)); setPhoneError(''); }}
                placeholder="010-0000-0000"
                className={`input ${phoneError ? 'border-red-400' : ''}`}
              />
              {phoneError && <p className="mt-1 text-xs text-red-500">{phoneError}</p>}
            </div>
          )}

          {/* 알림톡 템플릿 */}
          {type === 'kakao' && (
            <div className="space-y-3">
              {(() => {
                // 템플릿을 분류 상태별로 구분
                const manualSendable = templates.filter((t: any) => templateMappings[t.templateId]?.is_manual_sendable);
                const eventOnly = templates.filter((t: any) => {
                  const m = templateMappings[t.templateId];
                  return m && !m.is_manual_sendable;
                });
                const unclassified = templates.filter((t: any) => !templateMappings[t.templateId]);
                const visibleTemplates = showEventOnly
                  ? templates
                  : manualSendable;

                const currentMapping = templateId ? templateMappings[templateId] : null;
                const isEventOnlySelected = currentMapping && !currentMapping.is_manual_sendable;
                const isUnclassifiedSelected = templateId && !currentMapping;

                return (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium">알림톡 템플릿</label>
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <span>수동 {manualSendable.length}</span>
                          <span className="text-slate-300">·</span>
                          <span>이벤트 {eventOnly.length}</span>
                          {unclassified.length > 0 && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span className="text-amber-600">미분류 {unclassified.length}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {templates.length === 0 ? (
                        <p className="text-sm text-amber-600">⚠️ 솔라피에 승인된 템플릿이 없거나 환경변수 미설정</p>
                      ) : (
                        <>
                          <select
                            value={templateId}
                            onChange={e => {
                              setTemplateId(e.target.value);
                              const t = templates.find((t: any) => t.templateId === e.target.value);
                              if (t) {
                                setTemplateContent(t.content);
                                const keys = t.variables.map((v: any) => v.name ?? v);
                                setVariableKeys(keys);
                                setMessage(t.content);
                                setManualFields(detectManualFields(keys));
                                setManualVars({});
                              }
                            }}
                            className="input"
                          >
                            <option value="">템플릿 선택</option>
                            {visibleTemplates.map((t: any) => {
                              const m = templateMappings[t.templateId];
                              const prefix = !m ? '[미분류] ' : m.is_manual_sendable ? '' : '[이벤트 전용] ';
                              return (
                                <option key={t.templateId} value={t.templateId}>
                                  {prefix}{t.name}
                                </option>
                              );
                            })}
                          </select>
                          <label className="flex items-center gap-1 mt-2 text-xs text-slate-500 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showEventOnly}
                              onChange={e => setShowEventOnly(e.target.checked)}
                              className="w-3.5 h-3.5"
                            />
                            이벤트 전용 · 미분류 템플릿도 보기
                          </label>
                        </>
                      )}
                    </div>

                    {/* 경고 배너 — 이벤트 전용 템플릿 선택 */}
                    {isEventOnlySelected && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm">
                        <div className="font-medium text-amber-800">
                          ⚠️ 이 템플릿은 &ldquo;{EVENT_TYPES[(currentMapping.event_type as keyof typeof EVENT_TYPES)] || currentMapping.event_type}&rdquo; 이벤트 자동 발송 전용입니다
                        </div>
                        <div className="text-xs text-amber-700 mt-1">
                          수동 발송 시 변수 값(상품명/주문번호/인증번호 등)이 의도한 값과 달라질 수 있습니다.
                          일반 공지·축하 메시지는 별도의 수동 발송 템플릿을 사용하세요.
                        </div>
                      </div>
                    )}

                    {/* 경고 배너 — 미분류 템플릿 */}
                    {isUnclassifiedSelected && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm">
                        <div className="font-medium text-amber-800">
                          ⚠️ 분류되지 않은 템플릿입니다
                        </div>
                        <div className="text-xs text-amber-700 mt-1">
                          <Link href="/notifications/templates" className="underline font-medium">템플릿 관리</Link> 페이지에서
                          이 템플릿의 용도와 수동 발송 가능 여부를 먼저 지정해주세요.
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              {variableKeys.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {variableKeys
                      .filter(k => !manualFields.find(f => f.key === k))
                      .map(k => (
                        <span key={k} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                          {k} 자동입력
                        </span>
                      ))}
                  </div>
                  {manualFields.length > 0 && (
                    <div className="space-y-2 border border-amber-200 bg-amber-50 rounded-lg p-3">
                      <p className="text-xs font-medium text-amber-700">직접 입력 필요</p>
                      {manualFields.map(f => (
                        <div key={f.key}>
                          <label className="block text-xs text-slate-600 mb-0.5">{f.label} <span className="text-slate-400">({f.key})</span></label>
                          <input
                            type="text"
                            value={manualVars[f.key] || ''}
                            onChange={e => setManualVars(prev => ({ ...prev, [f.key]: e.target.value }))}
                            className="input text-sm py-1.5"
                            placeholder={f.label + ' 입력'}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 메시지 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-sm font-medium">메시지 *</label>
              {type === 'sms' && (() => {
                const byteLen = new TextEncoder().encode(message).length;
                const isLms = byteLen > 90;
                return (
                  <span className={`text-xs ${isLms ? 'text-amber-600' : 'text-slate-400'}`}>
                    {message.length}자 ({byteLen}bytes) {isLms ? '→ LMS' : '→ SMS'}
                  </span>
                );
              })()}
            </div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={5}
              className="input"
              placeholder={type === 'kakao' ? '템플릿을 선택하거나 직접 입력...' : '전송할 SMS 메시지를 입력하세요'}
            />
            {type === 'kakao' && (
              <p className="text-xs text-slate-400 mt-1">변수는 발송 시 수신자 정보로 자동 치환됩니다</p>
            )}
          </div>

          {/* 환경변수 미설정 안내 */}
          {!process.env.NEXT_PUBLIC_SOLAPI_CONFIGURED && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
              ⚠️ SOLAPI_API_KEY가 설정되지 않으면 DB에만 기록되고 실제 발송되지 않습니다.
            </div>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t">
          <button
            onClick={handleSend}
            disabled={submitting}
            className="flex-1 btn-primary disabled:opacity-50"
          >
            {submitting ? '발송 중...' : `발송 (${sendMode === 'bulk' ? `${selectedCustomerIds.length}건` : '1건'})`}
          </button>
          <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
        </div>
      </div>
    </div>
  );
}
