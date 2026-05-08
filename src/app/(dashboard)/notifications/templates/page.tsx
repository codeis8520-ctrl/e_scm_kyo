'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { EVENT_TYPES, type EventTypeKey, type TemplateMapping } from '@/lib/notification-event-types';
import { upsertTemplateMapping, getTemplateMappings } from '@/lib/notification-template-mapping-actions';
import KakaoAlimtalkPreview from '@/components/KakaoAlimtalkPreview';

// 이벤트별 자동 발송 트리거 위치 안내
//   notification-triggers.ts / fireNotificationTrigger 호출 지점 기준
const EVENT_TRIGGER_HINTS: Record<string, { auto: boolean; where: string }> = {
  MANUAL:         { auto: false, where: '자동 트리거 없음 — /알림 화면에서 수동 발송 전용' },
  WELCOME:        { auto: true,  where: 'POS 신규 고객 등록 / 일괄 등록 / QR 회원가입 시' },
  ORDER_COMPLETE: { auto: true,  where: 'POS 결제 완료 시 / Cafe24 주문 동기화 시' },
  SHIPMENT:       { auto: true,  where: '운송장 등록 또는 주문 상태가 "출고"로 변경될 때' },
  DELIVERY:       { auto: false, where: '※ 현재 자동 트리거 미연결 (배송완료 이벤트는 SweetTracker 웹훅 수신 시점 필요)' },
  REFUND:         { auto: true,  where: '반품 주문 환불 처리 완료 시' },
  AUTH:           { auto: false, where: '※ 현재 인증번호 발급 플로우 없음 (도입 시 별도 호출 필요)' },
  POINT:          { auto: false, where: '※ 현재 자동 트리거 미연결 (포인트 적립/사용 시 호출 추가 필요)' },
  BIRTHDAY:       { auto: true,  where: '/알림 화면 "🎂 생일 배치" 또는 매일 자정 크론' },
  DORMANT:        { auto: true,  where: '/알림 화면 "💤 휴면 배치" 또는 정기 크론' },
  OTHER:          { auto: false, where: '자동 트리거 없음' },
};

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
  const manualCount = templates.filter(t => mappings[t.templateId]?.is_manual_sendable).length;
  const autoCount = templates.filter(t => mappings[t.templateId]?.auto_trigger_enabled).length;

  // 이벤트 유형별로 그룹화 (미분류는 별도 그룹)
  const grouped: Record<string, any[]> = {};
  for (const t of templates) {
    const m = mappings[t.templateId];
    const key = m?.event_type ? String(m.event_type) : '_UNCLASSIFIED';
    (grouped[key] ||= []).push(t);
  }
  // 표시 순서 — EVENT_TYPES 키 순서 + 미분류 마지막
  const orderedKeys = [
    ...Object.keys(EVENT_TYPES).filter(k => grouped[k]?.length),
    ...(grouped._UNCLASSIFIED?.length ? ['_UNCLASSIFIED'] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="font-semibold text-lg">Solapi 알림톡 템플릿 분류</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Solapi에 등록·승인된 템플릿을 가져와 (1) <b>이벤트 유형</b>으로 묶고 (2) <b>수동 발송 가능</b>으로 표시할지,
              (3) 해당 이벤트가 시스템에서 발생할 때 <b>자동 발송할지</b>를 설정합니다.
              수동 발송 가능으로 지정된 템플릿만 <Link href="/notifications" className="text-blue-600 underline">/알림</Link> 화면에 기본 노출됩니다.
            </p>
          </div>
        </div>

        {/* 헤더 요약 통계 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">전체 템플릿</p>
            <p className="text-lg font-bold text-slate-700">{templates.length}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 px-3 py-2">
            <p className="text-xs text-emerald-600">분류 완료</p>
            <p className="text-lg font-bold text-emerald-700">{classified}</p>
          </div>
          <div className="rounded-lg bg-blue-50 px-3 py-2">
            <p className="text-xs text-blue-600">수동 발송 가능</p>
            <p className="text-lg font-bold text-blue-700">{manualCount}</p>
          </div>
          <div className="rounded-lg bg-purple-50 px-3 py-2">
            <p className="text-xs text-purple-600">자동 발송 활성</p>
            <p className="text-lg font-bold text-purple-700">{autoCount}</p>
          </div>
        </div>

        {unclassified > 0 && (
          <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
            ⚠️ <b>미분류 {unclassified}개</b> — 분류하기 전에는 <code>/알림</code> 발송 화면에서 표시되지 않을 수 있습니다.
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      {loading ? (
        <div className="card text-center py-8 text-slate-400">Solapi 템플릿 로딩 중...</div>
      ) : templates.length === 0 ? (
        <div className="card text-center py-8 text-slate-400">
          Solapi에 승인된 알림톡 템플릿이 없거나 API 키가 설정되지 않았습니다.
        </div>
      ) : (
        // 이벤트 유형별 그룹 카드
        orderedKeys.map(eventKey => {
          const list = grouped[eventKey];
          const isUnclassifiedGroup = eventKey === '_UNCLASSIFIED';
          const eventLabel = isUnclassifiedGroup
            ? '미분류'
            : EVENT_TYPES[eventKey as EventTypeKey] || eventKey;
          const hint = isUnclassifiedGroup
            ? null
            : EVENT_TRIGGER_HINTS[eventKey];

          return (
            <div key={eventKey} className={`card ${isUnclassifiedGroup ? 'border-amber-300 bg-amber-50/40' : ''}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div>
                  <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                    <span className={`inline-block w-1.5 h-5 rounded-sm ${isUnclassifiedGroup ? 'bg-amber-400' : 'bg-blue-500'}`} />
                    {eventLabel}
                    <span className="text-xs font-normal text-slate-400">({list.length}개)</span>
                  </h4>
                  {hint && (
                    <p className={`text-xs mt-1 ${hint.auto ? 'text-slate-500' : 'text-amber-600'}`}>
                      {hint.auto ? '🟢 자동 트리거: ' : '⚪ '}{hint.where}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {list.map((tpl: any) => {
                  const cur = getCurrent(tpl.templateId);
                  const dirty = isDirty(tpl.templateId);
                  const autoTriggerable = !!hint?.auto || ['ORDER_COMPLETE', 'SHIPMENT', 'DELIVERY', 'REFUND', 'WELCOME', 'AUTH', 'POINT', 'BIRTHDAY', 'DORMANT'].includes(cur.event_type);
                  return (
                    <div key={tpl.templateId} className="rounded-lg border border-slate-200 p-3 bg-white">
                      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
                        {/* 좌측 — 메타 + 컨트롤 */}
                        <div className="space-y-3">
                          <div>
                            <div className="text-sm font-medium text-slate-800">{tpl.name || '(이름 없음)'}</div>
                            <div className="text-[11px] font-mono text-slate-400 truncate" title={tpl.templateId}>
                              {tpl.templateId}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-0.5">이벤트 유형</label>
                              <select
                                value={cur.event_type}
                                onChange={e => setField(tpl.templateId, 'event_type', e.target.value)}
                                className="input text-xs py-1 w-full"
                              >
                                {Object.entries(EVENT_TYPES).map(([k, v]) => (
                                  <option key={k} value={k}>{v}</option>
                                ))}
                              </select>
                            </div>
                            <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer mt-4">
                              <input
                                type="checkbox"
                                checked={cur.is_manual_sendable}
                                onChange={e => setField(tpl.templateId, 'is_manual_sendable', e.target.checked)}
                                className="w-4 h-4"
                              />
                              수동 발송 가능
                            </label>
                            <label className={`flex items-center gap-1.5 text-xs mt-4 ${autoTriggerable ? 'text-slate-700 cursor-pointer' : 'text-slate-400 cursor-not-allowed'}`}>
                              <input
                                type="checkbox"
                                checked={cur.auto_trigger_enabled && autoTriggerable}
                                disabled={!autoTriggerable}
                                onChange={e => setField(tpl.templateId, 'auto_trigger_enabled', e.target.checked)}
                                className="w-4 h-4"
                                title={autoTriggerable ? '이벤트 발생 시 자동 발송' : '이 이벤트 유형은 자동 트리거가 연결되어 있지 않습니다'}
                              />
                              자동 발송
                            </label>
                          </div>

                          <div className="flex justify-end">
                            <button
                              onClick={() => handleSave(tpl)}
                              disabled={!dirty || savingId === tpl.templateId}
                              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                                dirty
                                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                              }`}
                            >
                              {savingId === tpl.templateId ? '저장 중...' : (dirty ? '저장' : '저장됨')}
                            </button>
                          </div>
                        </div>

                        {/* 우측 — 카카오 미리보기 */}
                        <div>
                          <KakaoAlimtalkPreview message={tpl.content || ''} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

