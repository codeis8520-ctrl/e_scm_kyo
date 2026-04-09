'use client';

import { useState, useEffect } from 'react';
import { EVENT_TYPES, type EventTypeKey, type TemplateMapping } from '@/lib/notification-event-types';
import { upsertTemplateMapping, getTemplateMappings } from '@/lib/notification-template-mapping-actions';

export default function NotificationTemplatesPage() {
  // Solapi 템플릿 + 매핑 상태
  const [solapiTemplates, setSolapiTemplates] = useState<any[]>([]);
  const [mappings, setMappings] = useState<Record<string, TemplateMapping>>({});
  const [solapiLoading, setSolapiLoading] = useState(true);

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
    fetchSolapiTemplatesAndMappings();
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Solapi 템플릿 분류 섹션 ─────────────────────────────────────── */}
      <SolapiTemplateClassification
        templates={solapiTemplates}
        mappings={mappings}
        loading={solapiLoading}
        onRefresh={fetchSolapiTemplatesAndMappings}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 참고: 이전에 존재했던 내부 notification_templates CRUD UI는
// 실제 알림톡 발송 플로우(Solapi 직접 연동)와 무관한 레거시라서 제거했습니다.
// 테이블 자체는 notifications.template_id FK 호환을 위해 DB에 유지합니다.
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// Solapi 템플릿 분류 섹션
// ═══════════════════════════════════════════════════════════════════════

interface ClassificationProps {
  templates: any[];
  mappings: Record<string, TemplateMapping>;
  loading: boolean;
  onRefresh: () => void;
}

interface RowEdit {
  event_type: string;
  is_manual_sendable: boolean;
  auto_trigger_enabled: boolean;
}

function SolapiTemplateClassification({ templates, mappings, loading, onRefresh }: ClassificationProps) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // 로컬 변경사항 임시 저장 (각 행 개별 저장)
  const [localEdits, setLocalEdits] = useState<Record<string, RowEdit>>({});

  const getCurrent = (tplId: string): RowEdit => {
    if (localEdits[tplId]) return localEdits[tplId];
    const m = mappings[tplId];
    return {
      event_type: (m?.event_type as string) || 'OTHER',
      is_manual_sendable: m?.is_manual_sendable ?? false,
      auto_trigger_enabled: (m?.auto_trigger_enabled as boolean) ?? false,
    };
  };

  const setField = (
    tplId: string,
    field: keyof RowEdit,
    value: any
  ) => {
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
      local.is_manual_sendable !== (m?.is_manual_sendable ?? false) ||
      local.auto_trigger_enabled !== ((m?.auto_trigger_enabled as boolean) ?? false)
    );
  };

  const handleSave = async (tpl: any) => {
    const tplId = tpl.templateId;
    setSavingId(tplId);
    setError('');
    const cur = getCurrent(tplId);
    // 변수 키 배열 정규화
    const varKeys: string[] = Array.isArray(tpl.variables)
      ? tpl.variables.map((v: any) => (typeof v === 'string' ? v : v?.name)).filter(Boolean)
      : [];
    const result = await upsertTemplateMapping({
      solapi_template_id: tplId,
      event_type: cur.event_type as EventTypeKey,
      is_manual_sendable: cur.is_manual_sendable,
      auto_trigger_enabled: cur.auto_trigger_enabled,
      description: tpl.name,
      template_content: tpl.content || null,
      template_variables: varKeys,
    });
    setSavingId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
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
          <table className="table min-w-[900px]">
            <thead>
              <tr>
                <th className="w-56">템플릿명</th>
                <th>내용 미리보기</th>
                <th className="w-36">이벤트 유형</th>
                <th className="w-24 text-center">수동 발송</th>
                <th className="w-24 text-center">자동 발송</th>
                <th className="w-20 text-center">저장</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl: any) => {
                const cur = getCurrent(tpl.templateId);
                const dirty = isDirty(tpl.templateId);
                const isUnclassified = !mappings[tpl.templateId] && !localEdits[tpl.templateId];
                // 자동 발송 가능 조건: 이벤트 유형이 자동 트리거 가능한 종류
                const autoTriggerable = ['ORDER_COMPLETE', 'SHIPMENT', 'DELIVERY', 'REFUND', 'WELCOME', 'AUTH', 'POINT', 'BIRTHDAY'].includes(cur.event_type);
                return (
                  <tr key={tpl.templateId} className={isUnclassified ? 'bg-amber-50/40' : ''}>
                    <td>
                      <div className="text-sm font-medium">{tpl.name || '(이름 없음)'}</div>
                      <div className="text-xs font-mono text-slate-400 truncate max-w-[220px]" title={tpl.templateId}>
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
                      </label>
                    </td>
                    <td className="text-center">
                      <label className={`inline-flex items-center gap-1 ${autoTriggerable ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                        <input
                          type="checkbox"
                          checked={cur.auto_trigger_enabled && autoTriggerable}
                          disabled={!autoTriggerable}
                          onChange={e => setField(tpl.templateId, 'auto_trigger_enabled', e.target.checked)}
                          className="w-4 h-4"
                          title={autoTriggerable ? '이벤트 발생 시 자동 발송' : '이 이벤트 유형은 자동 발송을 지원하지 않습니다'}
                        />
                      </label>
                    </td>
                    <td className="text-center">
                      <button
                        onClick={() => handleSave(tpl)}
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

