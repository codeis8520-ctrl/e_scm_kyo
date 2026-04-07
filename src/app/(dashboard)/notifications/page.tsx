'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { validators, formatPhone } from '@/lib/validators';
import { sendSmsAction, sendKakaoAction, getNotifications } from '@/lib/notification-actions';

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
  const [customers, setCustomers]         = useState<any[]>([]);
  const [loading, setLoading]             = useState(true);
  const [activeTab, setActiveTab]         = useState<'kakao' | 'sms'>('sms');
  const [showSendModal, setShowSendModal] = useState(false);
  const [statusFilter, setStatusFilter]   = useState('');
  const [typeFilter, setTypeFilter]       = useState('');

  const fetchData = async () => {
    setLoading(true);
    const [notifRes, templateRes, customerRes] = await Promise.all([
      getNotifications({
        status: statusFilter || undefined,
        type:   typeFilter   || undefined,
      }),
      fetch('/api/solapi/templates').then(r => r.json()).then(d => d.templates ?? []),
      (async () => {
        const supabase = createClient() as any;
        const { data } = await supabase.from('customers').select('id, name, phone, grade').eq('is_active', true).order('name');
        return data || [];
      })(),
    ]);

    setNotifications(notifRes.data || []);
    setTemplates(templateRes);
    setCustomers(customerRes);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [statusFilter, typeFilter]);

  const stats = {
    sent:    notifications.filter(n => n.status === 'sent').length,
    failed:  notifications.filter(n => n.status === 'failed').length,
    kakao:   notifications.filter(n => n.notification_type === 'KAKAO').length,
    sms:     notifications.filter(n => n.notification_type === 'SMS').length,
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 border-b border-slate-200">
          {(['sms', 'kakao'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'sms' ? 'SMS 발송' : '알림톡 발송'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Link href="/notifications/templates" className="px-3 py-2 rounded text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">
            템플릿 관리
          </Link>
          <button onClick={() => setShowSendModal(true)} className="btn-primary text-sm">
            + {activeTab === 'sms' ? 'SMS' : '알림톡'} 발송
          </button>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="stat-card">
          <p className="text-sm text-slate-500">발송 완료</p>
          <p className="text-2xl font-bold text-green-600">{stats.sent}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">실패</p>
          <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">알림톡</p>
          <p className="text-2xl font-bold text-purple-600">{stats.kakao}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">SMS</p>
          <p className="text-2xl font-bold text-blue-600">{stats.sms}</p>
        </div>
      </div>

      {/* 필터 + 테이블 */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-36 text-sm py-1.5">
            <option value="">전체 상태</option>
            <option value="sent">발송완료</option>
            <option value="failed">실패</option>
            <option value="pending">대기중</option>
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input w-36 text-sm py-1.5">
            <option value="">전체 유형</option>
            <option value="SMS">SMS</option>
            <option value="KAKAO">알림톡</option>
          </select>
        </div>

        <div className="overflow-x-auto">
        <table className="table min-w-[600px]">
          <thead>
            <tr>
              <th>발송일시</th>
              <th>유형</th>
              <th>수신자</th>
              <th>연락처</th>
              <th>메시지</th>
              <th>상태</th>
              <th>오류</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8">로딩 중...</td></tr>
            ) : notifications.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">발송 기록이 없습니다</td></tr>
            ) : notifications.map(n => (
              <tr key={n.id}>
                <td className="text-sm text-slate-500 whitespace-nowrap">{new Date(n.created_at).toLocaleString('ko-KR')}</td>
                <td>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    n.notification_type === 'KAKAO' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {TYPE_LABEL[n.notification_type] || n.notification_type}
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
                <td className="text-xs text-red-500 max-w-[120px] truncate">{n.error_message || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {showSendModal && (
        <SendModal
          type={activeTab}
          templates={templates}
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
  customers: any[];
  onClose: () => void;
  onSuccess: () => void;
}

function SendModal({ type, templates, customers, onClose, onSuccess }: SendModalProps) {
  const [sendMode, setSendMode]                   = useState<'bulk' | 'single'>('bulk');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch]       = useState('');
  const [gradeFilter, setGradeFilter]             = useState('');
  const [phone, setPhone]                         = useState('');
  const [phoneError, setPhoneError]               = useState('');
  const [templateId, setTemplateId]               = useState('');
  const [message, setMessage]                     = useState('');
  const [submitting, setSubmitting]               = useState(false);
  const [result, setResult]                       = useState<{ successCount: number; failCount: number } | null>(null);
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});

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

    let targets: { customerId: string | null; phone: string }[];

    if (sendMode === 'bulk') {
      if (selectedCustomerIds.length === 0) { alert('발송 대상을 선택해주세요.'); setSubmitting(false); return; }
      targets = selectedCustomerIds.map(id => {
        const c = customers.find(c => c.id === id);
        return { customerId: id, phone: c?.phone || '' };
      });
    } else {
      const err = validators.phone(phone);
      if (err) { setPhoneError(err); setSubmitting(false); return; }
      targets = [{ customerId: null, phone }];
    }

    if (!message.trim()) { alert('메시지를 입력해주세요.'); setSubmitting(false); return; }

    let res;
    if (type === 'sms') {
      res = await sendSmsAction({ targets, message });
    } else {
      if (!templateId) {
        alert('템플릿을 선택해주세요.');
        setSubmitting(false);
        return;
      }
      res = await sendKakaoAction({
        targets,
        templateId,
        message,
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
              <div>
                <label className="block text-sm font-medium mb-1">알림톡 템플릿</label>
                {templates.length === 0 ? (
                  <p className="text-sm text-amber-600">⚠️ 솔라피에 승인된 템플릿이 없거나 환경변수 미설정</p>
                ) : (
                  <select
                    value={templateId}
                    onChange={e => {
                      setTemplateId(e.target.value);
                      const t = templates.find((t: any) => t.templateId === e.target.value);
                      if (t) {
                        setMessage(t.content);
                        setTemplateVariables(
                          t.variables.reduce((acc: Record<string, string>, v: string) => ({ ...acc, [v]: '' }), {})
                        );
                      }
                    }}
                    className="input"
                  >
                    <option value="">템플릿 선택</option>
                    {templates.map((t: any) => (
                      <option key={t.templateId} value={t.templateId}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
              {/* 변수 입력 */}
              {Object.keys(templateVariables).length > 0 && (
                <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-600">템플릿 변수 입력</p>
                  {Object.entries(templateVariables).map(([key, val]) => (
                    <div key={key}>
                      <label className="text-xs text-slate-500">{key}</label>
                      <input
                        className="input mt-0.5"
                        value={val as string}
                        onChange={e => setTemplateVariables(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder={key}
                      />
                    </div>
                  ))}
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
              <p className="text-xs text-slate-400 mt-1">변수: {'{{customer_name}}'}, {'{{amount}}'}, {'{{product_name}}'} 등</p>
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
