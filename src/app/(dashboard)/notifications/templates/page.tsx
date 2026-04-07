'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function NotificationTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTemplate, setEditTemplate] = useState<any>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('notification_templates')
      .select('*')
      .order('created_at');
    setTemplates(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleEdit = (template: any) => {
    setEditTemplate(template);
    setShowModal(true);
  };

  const handleSuccess = () => {
    setShowModal(false);
    setEditTemplate(null);
    fetchTemplates();
  };

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h3 className="font-semibold text-lg">알림톡 템플릿</h3>
        <button
          onClick={() => {
            setEditTemplate(null);
            setShowModal(true);
          }}
          className="btn-primary"
        >
          + 템플릿 추가
        </button>
      </div>

      <div className="overflow-x-auto">
      <table className="table min-w-[500px]">
        <thead>
          <tr>
            <th>템플릿 코드</th>
            <th>템플릿명</th>
            <th>Solapi 템플릿 ID</th>
            <th>메시지 미리보기</th>
            <th>상태</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={6} className="text-center text-slate-400 py-8">로딩 중...</td>
            </tr>
          ) : templates.map((template) => (
            <tr key={template.id}>
              <td className="font-mono text-sm">{template.template_code}</td>
              <td>{template.template_name}</td>
              <td>
                {template.solapi_template_id
                  ? <span className="font-mono text-xs text-slate-600">{template.solapi_template_id}</span>
                  : <span className="text-xs text-amber-500">⚠️ 미등록</span>}
              </td>
              <td className="max-w-xs text-sm truncate">{template.message_template}</td>
              <td>
                <span className={template.is_active ? 'badge badge-success' : 'badge badge-error'}>
                  {template.is_active ? '활성' : '비활성'}
                </span>
              </td>
              <td>
                <button onClick={() => handleEdit(template)} className="text-blue-600 hover:underline mr-2">수정</button>
              </td>
            </tr>
          ))}
          {!loading && templates.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center text-slate-400 py-8">등록된 템플릿이 없습니다</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {showModal && (
        <TemplateModal
          template={editTemplate}
          onClose={() => { setShowModal(false); setEditTemplate(null); }}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}

function TemplateModal({ template, onClose, onSuccess }: any) {
  const supabase = createClient();
  const [formData, setFormData] = useState({
    template_code: template?.template_code || '',
    template_name: template?.template_name || '',
    solapi_template_id: template?.solapi_template_id || '',
    message_template: template?.message_template || '',
  } as any);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const db = supabase as any;
      if (template?.id) {
        await db.from('notification_templates').update(formData).eq('id', template.id);
      } else {
        await db.from('notification_templates').insert({ ...formData, is_active: true });
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || '오류가 발생했습니다.');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!template?.id) return;
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await supabase.from('notification_templates').delete().eq('id', template.id);
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl p-4 sm:p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{template?.id ? '템플릿 수정' : '템플릿 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">템플릿 코드 *</label>
            <input
              type="text"
              value={formData.template_code}
              onChange={(e) => setFormData({ ...formData, template_code: e.target.value })}
              required
              disabled={!!template?.id}
              className="mt-1 input"
              placeholder="ORDER_COMPLETE"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">템플릿명 *</label>
            <input
              type="text"
              value={formData.template_name}
              onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
              required
              className="mt-1 input"
              placeholder="주문 완료 알림"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Solapi 템플릿 ID
              <span className="ml-1 text-xs text-slate-400">(알림톡 발송 시 필수 — KA01TP...)</span>
            </label>
            <input
              type="text"
              value={formData.solapi_template_id}
              onChange={(e) => setFormData({ ...formData, solapi_template_id: e.target.value })}
              className="mt-1 input font-mono"
              placeholder="KA01TP..."
            />
            <p className="text-xs text-slate-400 mt-1">솔라피 콘솔 → 알림톡 → 템플릿 관리에서 확인</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">메시지 템플릿 *</label>
            <textarea
              value={formData.message_template}
              onChange={(e) => setFormData({ ...formData, message_template: e.target.value })}
              required
              rows={6}
              className="mt-1 input"
              placeholder="{{customer_name}}님, 안녕하세요..."
            />
            <p className="text-xs text-slate-500 mt-1">
              변수: {'{{customer_name}}'}, {'{{product_name}}'}, {'{{amount}}'}, {'{{event_name}}'} 등
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (template?.id ? '수정' : '등록')}
            </button>
            {template?.id && (
              <button type="button" onClick={handleDelete} className="px-4 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200">
                삭제
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
