'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { validators, formatPhone } from '@/lib/validators';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSendModal, setShowSendModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();
    
    let query = supabase
      .from('notifications')
      .select('*, customer:customers(*), template:notification_templates(*)')
      .order('created_at', { ascending: false });

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
      .select('*, kakao:customer_kakao(*)')
      .eq('is_active', true)
      .order('name');
    setCustomers(customerData || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const handleSend = async (customerId: string, phone: string, templateId: string, message: string) => {
    const supabase = createClient() as any;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 템플릿 메시지 가져오기
    let finalMessage = message;
    if (templateId) {
      const { data: template } = await supabase
        .from('notification_templates')
        .select('message_template')
        .eq('id', templateId)
        .single();
      finalMessage = template?.message_template || message;
    }

    // 알림 저장
    await supabase.from('notifications').insert({
      customer_id: customerId || null,
      notification_type: 'KAKAO',
      template_code: templateId || null,
      phone: phone,
      message: finalMessage,
      status: 'sent', // TODO: 카카오 API 연동 후 변경
      sent_by: user.id,
    });

    setShowSendModal(false);
    fetchData();
    alert('알림톡이 발송되었습니다.');
  };

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
        <h3 className="font-semibold text-lg">알림톡 발송</h3>
        <button onClick={() => setShowSendModal(true)} className="btn-primary">
          + 알림톡 발송
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
              <th>템플릿</th>
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
                <td>{notif.phone}</td>
                <td className="max-w-xs truncate">{notif.message}</td>
                <td className="text-sm">{notif.template?.template_name || '-'}</td>
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
        <SendNotificationModal
          templates={templates}
          customers={customers}
          onClose={() => setShowSendModal(false)}
          onSend={handleSend}
        />
      )}
    </div>
  );
}

function SendNotificationModal({ templates, customers, onClose, onSend }: any) {
  const [customerId, setCustomerId] = useState('');
  const [phone, setPhone] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [phoneError, setPhoneError] = useState('');

  const selectedCustomer = customers.find((c: any) => c.id === customerId);

  useEffect(() => {
    if (selectedCustomer) {
      const formatted = formatPhone(selectedCustomer.phone);
      setPhone(formatted);
      setPhoneError('');
    }
  }, [selectedCustomer]);

  const selectedTemplate = templates.find((t: any) => t.id === templateId);

  const handleSendClick = () => {
    const error = validators.phone(phone);
    if (error) {
      setPhoneError(error);
      return;
    }
    onSend(customerId, phone, templateId, customMessage);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">알림톡 발송</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">수신 고객</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 input">
              <option value="">직접 입력</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">연락처</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(formatPhone(e.target.value));
                setPhoneError('');
              }}
              required
              placeholder="010-0000-0000"
              className={`mt-1 input ${phoneError ? 'border-red-500' : ''}`}
            />
            {phoneError && <p className="mt-1 text-xs text-red-500">{phoneError}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">알림 템플릿</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 input">
              <option value="">템플릿 선택 (선택사항)</option>
              {templates.map((t: any) => (
                <option key={t.id} value={t.id}>{t.template_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">메시지</label>
            <textarea
              value={selectedTemplate?.message_template || customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              disabled={!!templateId}
              rows={5}
              className="mt-1 input"
              placeholder="전송할 메시지를 입력하세요..."
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button onClick={handleSendClick} className="flex-1 btn-primary">
              발송
            </button>
            <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}
