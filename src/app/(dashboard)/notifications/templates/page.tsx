'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EVENT_TYPES, type EventTypeKey, type TemplateMapping } from '@/lib/notification-event-types';
import { upsertTemplateMapping, getTemplateMappings } from '@/lib/notification-template-mapping-actions';

export default function NotificationTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTemplate, setEditTemplate] = useState<any>(null);

  // Solapi 템플릿 + 매핑 상태
  const [solapiTemplates, setSolapiTemplates] = useState<any[]>([]);
  const [mappings, setMappings] = useState<Record<string, TemplateMapping>>({});
  const [solapiLoading, setSolapiLoading] = useState(true);

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

  const fetchSolapiTemplatesAndMappings = async () => {
    setSolapiLoading(true);
    const [solapiRes, mapRes] = await Promise.all([
      fetch('/api/solapi/templates').then(r => r.json()).then(d => d.templates ?? []),
      getTemplateMappings(),
    ]);
    setSolapiTemplates(solapiRes);
    setMappings(mapRes.data || {});
    setSolapiLoading(false);
  };

  useEffect(() => {
    fetchTemplates();
    fetchSolapiTemplatesAndMappings();
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
    <div className="space-y-6">
      {/* ── Solapi 템플릿 분류 섹션 ─────────────────────────────────────── */}
      <SolapiTemplateClassification
        templates={solapiTemplates}
        mappings={mappings}
        loading={solapiLoading}
        onRefresh={fetchSolapiTemplatesAndMappings}
      />

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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Solapi 템플릿 분류 섹션
// ═══════════════════════════════════════════════════════════════════════

interface ClassificationProps {
  templates: any[];
  mappings: Record<string, TemplateMapping>;
  loading: boolean;
  onRefresh: () => void;
}

function SolapiTemplateClassification({ templates, mappings, loading, onRefresh }: ClassificationProps) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // 로컬 변경사항 임시 저장 (각 행 개별 저장)
  const [localEdits, setLocalEdits] = useState<Record<string, { event_type: string; is_manual_sendable: boolean }>>({});

  const getCurrent = (tplId: string) => {
    if (localEdits[tplId]) return localEdits[tplId];
    const m = mappings[tplId];
    return {
      event_type: (m?.event_type as string) || 'OTHER',
      is_manual_sendable: m?.is_manual_sendable ?? false,
    };
  };

  const setField = (tplId: string, field: 'event_type' | 'is_manual_sendable', value: any) => {
    const cur = getCurrent(tplId);
    setLocalEdits(prev => ({
      ...prev,
      [tplId]: { ...cur, [field]: value },
    }));
  };

  const isDirty = (tplId: string) => {
    const local = localEdits[tplId];
    if (!local) return false;
    const m = mappings[tplId];
    return (
      local.event_type !== ((m?.event_type as string) || 'OTHER') ||
      local.is_manual_sendable !== (m?.is_manual_sendable ?? false)
    );
  };

  const handleSave = async (tplId: string, tplName: string) => {
    setSavingId(tplId);
    setError('');
    const cur = getCurrent(tplId);
    const result = await upsertTemplateMapping({
      solapi_template_id: tplId,
      event_type: cur.event_type as EventTypeKey,
      is_manual_sendable: cur.is_manual_sendable,
      description: tplName,
    });
    setSavingId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    // 저장 성공 → 로컬 편집 초기화하고 전체 매핑 재조회
    setLocalEdits(prev => {
      const next = { ...prev };
      delete next[tplId];
      return next;
    });
    onRefresh();
  };

  const classified = templates.filter(t => !!mappings[t.templateId]).length;
  const unclassified = templates.length - classified;

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div>
          <h3 className="font-semibold text-lg">Solapi 알림톡 템플릿 분류</h3>
          <p className="text-xs text-slate-500 mt-1">
            각 템플릿의 용도(이벤트 유형)와 수동 발송 가능 여부를 설정합니다.
            수동 발송 가능으로 지정된 템플릿만 <code className="text-blue-600">/notifications</code> 발송 화면에 기본 노출됩니다.
          </p>
        </div>
        <div className="flex gap-2 items-center text-sm">
          <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700">
            분류 완료 {classified}
          </span>
          {unclassified > 0 && (
            <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">
              미분류 {unclassified}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-400">Solapi 템플릿 로딩 중...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          Solapi에 승인된 알림톡 템플릿이 없거나 API 키가 설정되지 않았습니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[800px]">
            <thead>
              <tr>
                <th className="w-64">템플릿명</th>
                <th>내용 미리보기</th>
                <th className="w-40">이벤트 유형</th>
                <th className="w-32 text-center">수동 발송</th>
                <th className="w-20 text-center">저장</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl: any) => {
                const cur = getCurrent(tpl.templateId);
                const dirty = isDirty(tpl.templateId);
                const isUnclassified = !mappings[tpl.templateId] && !localEdits[tpl.templateId];
                return (
                  <tr key={tpl.templateId} className={isUnclassified ? 'bg-amber-50/40' : ''}>
                    <td>
                      <div className="text-sm font-medium">{tpl.name || '(이름 없음)'}</div>
                      <div className="text-xs font-mono text-slate-400 truncate max-w-[240px]" title={tpl.templateId}>
                        {tpl.templateId}
                      </div>
                    </td>
                    <td>
                      <div className="text-xs text-slate-600 line-clamp-2 max-w-md">
                        {tpl.content || '-'}
                      </div>
                    </td>
                    <td>
                      <select
                        value={cur.event_type}
                        onChange={e => setField(tpl.templateId, 'event_type', e.target.value)}
                        className="input text-xs py-1"
                      >
                        {Object.entries(EVENT_TYPES).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-center">
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cur.is_manual_sendable}
                          onChange={e => setField(tpl.templateId, 'is_manual_sendable', e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className="text-xs text-slate-500">허용</span>
                      </label>
                    </td>
                    <td className="text-center">
                      <button
                        onClick={() => handleSave(tpl.templateId, tpl.name)}
                        disabled={!dirty || savingId === tpl.templateId}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          dirty
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {savingId === tpl.templateId ? '...' : '저장'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
