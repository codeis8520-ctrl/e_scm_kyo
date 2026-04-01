'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { validators, formatPhone } from '@/lib/validators';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'kakao' | 'sms'>('kakao');
  const [showSendModal, setShowSendModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();
    
    let query = supabase
      .from('notifications')
      .select('*, customer:customers(name, phone), template:notification_templates(template_name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data } = await query;
    setNotifications(data || []);

    const { data: templateData } = await supabase
      .from('notification_templates')
      .select('*')
      .eq('is_active', true)
      .order('created_at');
    setTemplates(templateData || []);

    const { data: customerData } = await supabase
      .from('customers')
      .select('id, name, phone, grade')
      .eq('is_active', true)
      .order('name');
    setCustomers(customerData || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent': return 'badge-success';
      case 'pending': return 'badge-warning';
      case 'failed': return 'badge-error';
      default: return '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex gap-2 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('kakao')}
            className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'kakao'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            알림톡 발송
          </button>
          <button
            onClick={() => setActiveTab('sms')}
            className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'sms'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            SMS 발송
          </button>
        </div>
        <button onClick={() => setShowSendModal(true)} className="btn-primary">
          + {activeTab === 'kakao' ? '알림톡' : 'SMS'} 발송
        </button>
      </div>

      <div className="card">
        <div className="flex gap-4 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-40"
          >
            <option value="">전체 상태</option>
            <option value="pending">대기중</option>
            <option value="sent">발송완료</option>
            <option value="failed">실패</option>
          </select>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>발송일시</th>
              <th>수신자</th>
              <th>연락처</th>
              <th>메시지</th>
              <th>유형</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 py-8">로딩 중...</td>
              </tr>
            ) : notifications.map((notif) => (
              <tr key={notif.id}>
                <td className="text-sm">{new Date(notif.created_at).toLocaleString('ko-KR')}</td>
                <td>{notif.customer?.name || '-'}</td>
                <td className="font-mono text-sm">{notif.phone}</td>
                <td className="max-w-xs truncate">{notif.message}</td>
                <td>
                  <span className={`badge ${notif.notification_type === 'KAKAO' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                    {notif.notification_type === 'KAKAO' ? '알림톡' : 'SMS'}
                  </span>
                </td>
                <td>
                  <span className={`badge ${getStatusBadge(notif.status)}`}>
                    {notif.status === 'sent' ? '발송완료' : notif.status === 'pending' ? '대기중' : '실패'}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && notifications.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 py-8">발송 기록이 없습니다</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showSendModal && (
        <BulkSendModal
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

interface BulkSendModalProps {
  type: 'kakao' | 'sms';
  templates: any[];
  customers: any[];
  onClose: () => void;
  onSuccess: () => void;
}

function BulkSendModal({ type, templates, customers, onClose, onSuccess }: BulkSendModalProps) {
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [phone, setPhone] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendMode, setSendMode] = useState<'bulk' | 'single'>('bulk');

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone.replace(/-/g, '').includes(customerSearch.replace(/-/g, ''))
  ).slice(0, 50);

  const toggleCustomer = (id: string) => {
    setSelectedCustomerIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectAllVisible = () => {
    const ids = filteredCustomers.map(c => c.id);
    setSelectedCustomerIds(prev => [...new Set([...prev, ...ids])]);
  };

  const handleSend = async () => {
    setLoading(true);
    setPhoneError('');

    const supabase = createClient() as any;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      let recipients: { customerId: string | null; phone: string }[] = [];

      if (sendMode === 'bulk') {
        if (selectedCustomerIds.length === 0) {
          alert('발송 대상을 선택해주세요.');
          setLoading(false);
          return;
        }
        recipients = selectedCustomerIds.map(id => {
          const customer = customers.find(c => c.id === id);
          return { customerId: id, phone: customer?.phone || '' };
        });
      } else {
        const phoneError = validators.phone(phone);
        if (phoneError) {
          setPhoneError(phoneError);
          setLoading(false);
          return;
        }
        recipients = [{ customerId: null, phone }];
      }

      if (!customMessage.trim()) {
        alert('메시지를 입력해주세요.');
        setLoading(false);
        return;
      }

      let finalMessage = customMessage;
      if (type === 'kakao' && templateId) {
        const template = templates.find(t => t.id === templateId);
        finalMessage = template?.message_template || customMessage;
      }

      for (const recipient of recipients) {
        await supabase.from('notifications').insert({
          customer_id: recipient.customerId,
          notification_type: type === 'kakao' ? 'KAKAO' : 'SMS',
          template_id: type === 'kakao' ? templateId || null : null,
          template_code: type === 'kakao' ? (templates.find(t => t.id === templateId)?.template_code || null) : null,
          phone: recipient.phone,
          message: finalMessage,
          status: 'sent',
          sent_by: user.id,
        });
      }

      alert(`${recipients.length}건이 발송되었습니다.`);
      onSuccess();
    } catch (err) {
      console.error(err);
      alert('발송 중 오류가 발생했습니다.');
    }

    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">
            {type === 'kakao' ? '알림톡' : 'SMS'} 발송
            <span className="text-sm font-normal text-slate-500 ml-2">
              ({sendMode === 'bulk' ? '단체 발송' : '단일 발송'})
            </span>
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2 border-b pb-2">
            <button
              onClick={() => setSendMode('bulk')}
              className={`px-3 py-1.5 rounded-md text-sm ${
                sendMode === 'bulk' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              단체 발송
            </button>
            <button
              onClick={() => setSendMode('single')}
              className={`px-3 py-1.5 rounded-md text-sm ${
                sendMode === 'single' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              단일 발송
            </button>
          </div>

          {sendMode === 'bulk' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  발송 대상 ({selectedCustomerIds.length}명 선택됨)
                </label>
                <input
                  type="text"
                  placeholder="고객 검색 (이름/연락처)"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="input mb-2"
                />
                <div className="flex gap-2 mb-2">
                  <button onClick={selectAllVisible} className="text-xs text-blue-600 hover:underline">
                    현재 결과 전체 선택
                  </button>
                  <button onClick={() => setSelectedCustomerIds([])} className="text-xs text-slate-500 hover:underline">
                    선택 해제
                  </button>
                </div>
                <div className="border rounded-lg max-h-48 overflow-auto">
                  {filteredCustomers.map(c => (
                    <label key={c.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                      <input
                        type="checkbox"
                        checked={selectedCustomerIds.includes(c.id)}
                        onChange={() => toggleCustomer(c.id)}
                        className="rounded"
                      />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-slate-500">{c.phone}</p>
                      </div>
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        c.grade === 'VVIP' ? 'bg-red-100 text-red-700' :
                        c.grade === 'VIP' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {c.grade}
                      </span>
                    </label>
                  ))}
                  {filteredCustomers.length === 0 && (
                    <p className="text-center text-slate-400 py-4">검색 결과가 없습니다</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700">연락처</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhone(e.target.value));
                  setPhoneError('');
                }}
                placeholder="010-0000-0000"
                className={`mt-1 input ${phoneError ? 'border-red-500' : ''}`}
              />
              {phoneError && <p className="mt-1 text-xs text-red-500">{phoneError}</p>}
            </div>
          )}

          {type === 'kakao' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">알림톡 템플릿</label>
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  if (e.target.value) {
                    const template = templates.find(t => t.id === e.target.value);
                    if (template) setCustomMessage(template.message_template);
                  }
                }}
                className="mt-1 input"
              >
                <option value="">템플릿 선택 (선택사항)</option>
                {templates.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.template_name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">
              메시지 {type === 'sms' && <span className="text-slate-400">(SMS)</span>}
            </label>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={5}
              className="mt-1 input"
              placeholder={type === 'kakao' 
                ? '템플릿을 선택하면 자동 입력됩니다...' 
                : '전송할 메시지를 입력하세요 (80자 이내 권장)'
              }
            />
            <p className="text-xs text-slate-500 mt-1">
              {type === 'kakao' && '변수: {{customer_name}}, {{product_name}}, {{amount}} 등'}
              {type === 'sms' && `${customMessage.length}/80자`}
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              onClick={handleSend}
              disabled={loading}
              className="flex-1 btn-primary py-3"
            >
              {loading ? '발송 중...' : `발송 (${sendMode === 'bulk' ? selectedCustomerIds.length : 1}건)`}
            </button>
            <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}
