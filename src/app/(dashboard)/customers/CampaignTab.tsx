'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  CAMPAIGN_STATUS, CAMPAIGN_STATUS_BADGE,
  TARGET_GRADE_OPTIONS,
  type Campaign,
} from '@/lib/campaign-types';
import {
  getCampaigns, createCampaign, updateCampaign, deleteCampaign,
  activateCampaign, cancelCampaign, sendCampaign,
  copyCampaignForNextYear, getRecurringSuggestions,
} from '@/lib/campaign-actions';

export default function CampaignTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [suggestions, setSuggestions] = useState<Campaign[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [solapiTemplates, setSolapiTemplates] = useState<any[]>([]);
  // DB에서 이벤트 유형 로드
  const [eventTypes, setEventTypes] = useState<Record<string, { name: string; emoji: string }>>({});

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient() as any;
    const [res, sugRes, tplRes, etRes] = await Promise.all([
      getCampaigns({ status: statusFilter || undefined, event_type: eventFilter || undefined }),
      getRecurringSuggestions(),
      fetch('/api/solapi/templates').then(r => r.json()).then(d => d.templates ?? []),
      supabase.from('campaign_event_types').select('code, name, emoji').eq('is_active', true).order('sort_order'),
    ]);
    setCampaigns(res.data || []);
    setSuggestions(sugRes.data || []);
    setSolapiTemplates(tplRes);
    const etMap: Record<string, { name: string; emoji: string }> = {};
    for (const et of (etRes.data || []) as any[]) { etMap[et.code] = { name: et.name, emoji: et.emoji || '📢' }; }
    setEventTypes(etMap);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [statusFilter, eventFilter]);

  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    active: campaigns.filter(c => c.status === 'ACTIVE').length,
    draft: campaigns.filter(c => c.status === 'DRAFT').length,
    sent: campaigns.filter(c => c.status === 'SENT').length,
    completed: campaigns.filter(c => c.status === 'COMPLETED').length,
  };

  const fmtScheduled = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtRecurring = (c: Campaign) => {
    if (!c.is_recurring || !c.recurring_month || !c.recurring_day) return null;
    const hh = c.recurring_hour ?? 0;
    const mm = c.recurring_minute ?? 0;
    return `매년 ${c.recurring_month}/${c.recurring_day} ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  };

  const handleSend = async (campaign: Campaign) => {
    if (!confirm(
      `"${campaign.name}" 캠페인을 발송하시겠습니까?\n\n` +
      `대상: ${TARGET_GRADE_OPTIONS.find(o => o.value === campaign.target_grade)?.label || '전체'}\n` +
      `템플릿: ${campaign.solapi_template_id || '미지정'}\n\n` +
      `발송 후 취소할 수 없습니다.`
    )) return;
    setSendingId(campaign.id);
    const res = await sendCampaign(campaign.id);
    setSendingId(null);
    if (res.error) {
      alert('발송 실패: ' + res.error);
    } else {
      alert(`발송 완료 — 성공 ${res.successCount || 0}건, 실패 ${res.failCount || 0}건`);
      fetchData();
    }
  };

  const handleActivate = async (id: string) => {
    if (!confirm('이 캠페인을 활성화하시겠습니까?')) return;
    const res = await activateCampaign(id);
    if (res.error) alert(res.error);
    else fetchData();
  };

  const handleCancel = async (id: string) => {
    if (!confirm('이 캠페인을 취소하시겠습니까?')) return;
    const res = await cancelCampaign(id);
    if (res.error) alert(res.error);
    else fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 캠페인을 삭제하시겠습니까? (복구 불가)')) return;
    const res = await deleteCampaign(id);
    if (res.error) alert(res.error);
    else fetchData();
  };

  const handleCopy = async (id: string) => {
    const res = await copyCampaignForNextYear(id);
    if (res.error) alert(res.error);
    else {
      alert('다음 연도 캠페인이 생성되었습니다 (준비중 상태).');
      fetchData();
    }
  };

  return (
    <div className="space-y-4">
      {/* 통계 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="stat-card">
          <p className="text-sm text-slate-500">진행중</p>
          <p className="text-2xl font-bold text-emerald-600">{stats.active}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">준비중</p>
          <p className="text-2xl font-bold text-slate-600">{stats.draft}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">발송완료</p>
          <p className="text-2xl font-bold text-blue-600">{stats.sent}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">종료</p>
          <p className="text-2xl font-bold text-slate-400">{stats.completed}</p>
        </div>
      </div>

      {/* 반복 캠페인 제안 */}
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800 mb-2">📅 작년 캠페인 재사용 제안</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <button
                key={s.id}
                onClick={() => handleCopy(s.id)}
                className="px-3 py-1.5 rounded bg-amber-100 text-amber-800 text-xs font-medium hover:bg-amber-200"
              >
                {eventTypes[s.event_type]?.emoji || '📢'} {s.name} → 올해 복사
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 헤더 */}
      <div className="card">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex gap-2 flex-wrap">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm py-1.5 w-28">
              <option value="">전체 상태</option>
              {Object.entries(CAMPAIGN_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={eventFilter} onChange={e => setEventFilter(e.target.value)} className="input text-sm py-1.5 w-36">
              <option value="">전체 유형</option>
              {Object.entries(eventTypes).map(([k, v]) => (
                <option key={k} value={k}>{v.emoji} {v.name}</option>
              ))}
            </select>
          </div>
          <button onClick={() => { setEditingCampaign(null); setShowForm(true); }} className="btn-primary text-sm">
            + 캠페인 생성
          </button>
        </div>

        {/* 캠페인 카드 리스트 */}
        {loading ? (
          <div className="py-8 text-center text-slate-400">로딩 중...</div>
        ) : campaigns.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            {statusFilter || eventFilter ? '조건에 맞는 캠페인이 없습니다.' : '등록된 캠페인이 없습니다. 첫 캠페인을 만들어보세요!'}
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map(c => {
              const isPast = !!c.end_date && c.end_date < today;
              const isFuture = !!c.start_date && c.start_date > today;
              const isNow = !isPast && !isFuture;
              const scheduledDisplay = fmtScheduled(c.scheduled_at);
              const recurringDisplay = fmtRecurring(c);
              return (
                <div
                  key={c.id}
                  className={`border rounded-lg p-4 transition-colors ${
                    c.status === 'ACTIVE' && isNow ? 'border-emerald-300 bg-emerald-50/50' :
                    c.status === 'CANCELLED' ? 'border-red-200 bg-red-50/30 opacity-60' :
                    'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg">{eventTypes[c.event_type]?.emoji || '📢'}</span>
                        <h4 className="font-semibold text-slate-800 truncate">{c.name}</h4>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CAMPAIGN_STATUS_BADGE[c.status] || ''}`}>
                          {CAMPAIGN_STATUS[c.status as keyof typeof CAMPAIGN_STATUS] || c.status}
                        </span>
                        {c.is_recurring && <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">🔄 매년</span>}
                        {c.auto_send && <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">⚡ 자동</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 flex-wrap">
                        {scheduledDisplay ? (
                          <span className="font-medium text-slate-700">📅 {scheduledDisplay} 예약</span>
                        ) : recurringDisplay ? (
                          <span className="font-medium text-slate-700">🔄 {recurringDisplay}</span>
                        ) : (c.start_date || c.end_date) ? (
                          <span>{c.start_date || '—'} ~ {c.end_date || '—'}</span>
                        ) : (
                          <span className="text-slate-400">시각 미지정</span>
                        )}
                        <span>·</span>
                        <span>대상: {TARGET_GRADE_OPTIONS.find(o => o.value === c.target_grade)?.label || '전체'}</span>
                        {c.target_branch && <><span>·</span><span>{c.target_branch.name}</span></>}
                        {c.sent_count > 0 && (
                          <><span>·</span><span className="text-blue-600">발송 {c.sent_count}건{c.failed_count > 0 ? ` (실패 ${c.failed_count})` : ''}</span></>
                        )}
                      </div>
                      {c.description && <p className="text-xs text-slate-400 mt-1 truncate">{c.description}</p>}
                    </div>

                    <div className="flex gap-1.5 flex-wrap shrink-0">
                      {c.status === 'ACTIVE' && (
                        <button
                          onClick={() => handleSend(c)}
                          disabled={sendingId === c.id}
                          className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {sendingId === c.id ? '발송 중...' : '📤 발송'}
                        </button>
                      )}
                      {c.status === 'DRAFT' && (
                        <button onClick={() => handleActivate(c.id)} className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700">
                          활성화
                        </button>
                      )}
                      {(c.status === 'DRAFT' || c.status === 'ACTIVE') && (
                        <button onClick={() => { setEditingCampaign(c); setShowForm(true); }} className="px-3 py-1.5 rounded text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">
                          수정
                        </button>
                      )}
                      {c.is_recurring && c.status !== 'CANCELLED' && (
                        <button onClick={() => handleCopy(c.id)} className="px-3 py-1.5 rounded text-xs font-medium bg-purple-50 text-purple-600 hover:bg-purple-100">
                          복사
                        </button>
                      )}
                      {(c.status === 'DRAFT' || c.status === 'ACTIVE') && (
                        <button onClick={() => handleCancel(c.id)} className="px-3 py-1.5 rounded text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100">
                          취소
                        </button>
                      )}
                      {c.status === 'DRAFT' && (
                        <button onClick={() => handleDelete(c.id)} className="px-3 py-1.5 rounded text-xs font-medium text-red-400 hover:text-red-600">
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 생성/수정 모달 */}
      {showForm && (
        <CampaignFormModal
          campaign={editingCampaign}
          solapiTemplates={solapiTemplates}
          eventTypes={eventTypes}
          onClose={() => { setShowForm(false); setEditingCampaign(null); }}
          onSuccess={() => { setShowForm(false); setEditingCampaign(null); fetchData(); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 캠페인 생성/수정 모달
// ═══════════════════════════════════════════════════════════════════════

function CampaignFormModal({ campaign, solapiTemplates, eventTypes, onClose, onSuccess }: {
  campaign: Campaign | null;
  solapiTemplates: any[];
  eventTypes: Record<string, { name: string; emoji: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!campaign?.id;
  // DB의 timestamptz(UTC ISO) → datetime-local input 형식('YYYY-MM-DDTHH:MM', 로컬 TZ)
  const toDTLocal = (iso: string | null | undefined) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [form, setForm] = useState({
    name: campaign?.name || '',
    description: campaign?.description || '',
    event_type: campaign?.event_type || 'CUSTOM',
    scheduled_at_local: toDTLocal(campaign?.scheduled_at),
    start_date: campaign?.start_date || '',
    end_date: campaign?.end_date || '',
    is_recurring: campaign?.is_recurring ?? false,
    recurring_month: campaign?.recurring_month ?? null as number | null,
    recurring_day: campaign?.recurring_day ?? null as number | null,
    recurring_duration_days: campaign?.recurring_duration_days ?? null as number | null,
    recurring_hour: campaign?.recurring_hour ?? null as number | null,
    recurring_minute: campaign?.recurring_minute ?? null as number | null,
    target_grade: campaign?.target_grade || 'ALL',
    target_branch_id: campaign?.target_branch_id || '',
    solapi_template_id: campaign?.solapi_template_id || '',
    auto_send: campaign?.auto_send ?? false,
    variable_overrides: campaign?.variable_overrides || {} as Record<string, string>,
  });
  const [showPeriod, setShowPeriod] = useState(!!(campaign?.start_date || campaign?.end_date));
  const [branches, setBranches] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
      setBranches(data || []);
    })();
  }, []);

  // 템플릿 선택 시 변수 키 추출
  const selectedTemplate = solapiTemplates.find((t: any) => t.templateId === form.solapi_template_id);
  const templateVarKeys: string[] = selectedTemplate?.variables?.map((v: any) => typeof v === 'string' ? v : v?.name).filter(Boolean) || [];
  // 자동 처리 불가 변수만 표시
  const AUTO_PATTERN = /^(고객명|이름|성함|회원명|고객|전화번호|연락처|등급|상점명|매장명|브랜드명|업체명|회사명|url|링크)$/i;
  const manualVarKeys = templateVarKeys.map(k => k.replace(/^#\{/, '').replace(/\}$/, '').trim()).filter(k => !AUTO_PATTERN.test(k));

  // is_recurring 변경 시 자동 채움 (scheduled_at 우선, 없으면 start_date 사용)
  const handleRecurringChange = (checked: boolean) => {
    if (!checked) {
      setForm({
        ...form,
        is_recurring: false,
        recurring_month: null,
        recurring_day: null,
        recurring_duration_days: null,
        recurring_hour: null,
        recurring_minute: null,
      });
      return;
    }
    const srcDate = form.scheduled_at_local
      ? new Date(form.scheduled_at_local)
      : form.start_date ? new Date(form.start_date) : null;
    if (!srcDate || isNaN(srcDate.getTime())) {
      setForm({ ...form, is_recurring: true });
      return;
    }
    setForm({
      ...form,
      is_recurring: true,
      recurring_month: srcDate.getMonth() + 1,
      recurring_day: srcDate.getDate(),
      recurring_hour: form.scheduled_at_local ? srcDate.getHours() : (form.recurring_hour ?? null),
      recurring_minute: form.scheduled_at_local ? srcDate.getMinutes() : (form.recurring_minute ?? null),
      recurring_duration_days: form.end_date && form.start_date
        ? Math.max(1, Math.ceil((new Date(form.end_date).getTime() - new Date(form.start_date).getTime()) / 86400000))
        : 7,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    // datetime-local 은 로컬 TZ 문자열 — Date 생성자가 로컬로 해석 → UTC ISO로 저장
    const scheduledAtISO = form.scheduled_at_local
      ? new Date(form.scheduled_at_local).toISOString()
      : null;

    // 예약 시각·기간·반복 중 최소 하나는 있어야 함 (자동 발송이면 scheduled_at 필수)
    if (form.auto_send && !scheduledAtISO) {
      setSubmitting(false);
      setError('⚡ 자동 발송을 체크했다면 발송 예약일시를 입력해주세요.');
      return;
    }

    const { scheduled_at_local, ...rest } = form;
    const params = {
      ...rest,
      scheduled_at: scheduledAtISO,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      target_branch_id: form.target_branch_id || null,
      solapi_template_id: form.solapi_template_id || null,
      template_content: selectedTemplate?.content || null,
      template_variables: templateVarKeys,
      variable_overrides: form.variable_overrides,
    };

    const res = isEdit
      ? await updateCampaign(campaign!.id, params as any)
      : await createCampaign(params as any);

    setSubmitting(false);
    if (res.error) {
      setError(res.error);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-lg mx-auto max-h-[92vh] overflow-y-auto rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{isEdit ? '캠페인 수정' : '캠페인 생성'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {error && <div className="mb-3 p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">캠페인명 *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="input" placeholder="2026 추석 감사 이벤트" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">이벤트 유형 *</label>
              <select value={form.event_type} onChange={e => setForm({ ...form, event_type: e.target.value })} className="input">
                {Object.entries(eventTypes).map(([k, v]) => (
                  <option key={k} value={k}>{v.emoji} {v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">대상 등급</label>
              <select value={form.target_grade} onChange={e => setForm({ ...form, target_grade: e.target.value })} className="input">
                {TARGET_GRADE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">발송 예약일시 {form.auto_send && '*'}</label>
              <input
                type="datetime-local"
                value={form.scheduled_at_local}
                onChange={e => setForm({ ...form, scheduled_at_local: e.target.value })}
                step={600}
                className="input"
              />
              <p className="text-xs text-slate-400 mt-1">
                10분 단위로 입력 (스케줄러 주기 = 10분). 미지정 시 수동 발송만 가능.
              </p>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">대상 지점</label>
              <select value={form.target_branch_id} onChange={e => setForm({ ...form, target_branch_id: e.target.value })} className="input">
                <option value="">전체 지점</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {/* 기간 설정 (선택) — 반복 캠페인 윈도우 표시용 */}
          <div className="rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setShowPeriod(v => !v)}
              className="w-full px-3 py-2 flex items-center justify-between text-sm text-slate-600 hover:bg-slate-50"
            >
              <span>기간 설정 (선택)</span>
              <span className="text-xs text-slate-400">{showPeriod ? '▲' : '▼'}</span>
            </button>
            {showPeriod && (
              <div className="px-3 pb-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1 text-slate-500">시작일</label>
                  <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="input text-sm py-1.5" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-slate-500">종료일</label>
                  <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="input text-sm py-1.5" />
                </div>
                <p className="col-span-2 text-xs text-slate-400">
                  반복 캠페인의 유효 범위 또는 기간성 이벤트 표시용. 단일 예약 발송만 필요하면 비워두세요.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">설명 (선택)</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="input" placeholder="캠페인 상세 내용..." />
          </div>

          {/* Solapi 템플릿 */}
          <div>
            <label className="block text-sm font-medium mb-1">알림톡 템플릿</label>
            {solapiTemplates.length === 0 ? (
              <p className="text-sm text-amber-600">⚠️ Solapi 템플릿을 불러올 수 없습니다.</p>
            ) : (
              <select value={form.solapi_template_id} onChange={e => setForm({ ...form, solapi_template_id: e.target.value })} className="input">
                <option value="">템플릿 선택</option>
                {solapiTemplates.map((t: any) => <option key={t.templateId} value={t.templateId}>{t.name}</option>)}
              </select>
            )}
            {selectedTemplate && (
              <div className="mt-2 p-2 bg-slate-50 rounded text-xs text-slate-600 whitespace-pre-wrap line-clamp-3">
                {selectedTemplate.content}
              </div>
            )}
          </div>

          {/* 변수 오버라이드 (수동 입력 필요 변수) */}
          {manualVarKeys.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-amber-700">캠페인별 변수 설정</p>
              {manualVarKeys.map(k => (
                <div key={k}>
                  <label className="text-xs text-slate-600">{`#{${k}}`}</label>
                  <input
                    type="text"
                    value={form.variable_overrides[`#{${k}}`] || ''}
                    onChange={e => setForm({
                      ...form,
                      variable_overrides: { ...form.variable_overrides, [`#{${k}}`]: e.target.value },
                    })}
                    className="input text-sm py-1"
                    placeholder={`${k} 값 입력`}
                  />
                </div>
              ))}
            </div>
          )}

          {/* 옵션 */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_recurring} onChange={e => handleRecurringChange(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm">🔄 매년 반복 캠페인</span>
            </label>
            {form.is_recurring && (
              <div className="ml-6 grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">월</label>
                  <input type="number" min={1} max={12}
                    value={form.recurring_month ?? ''}
                    onChange={e => setForm({ ...form, recurring_month: e.target.value ? Number(e.target.value) : null })}
                    className="input text-sm py-1" placeholder="예) 9" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">일</label>
                  <input type="number" min={1} max={31}
                    value={form.recurring_day ?? ''}
                    onChange={e => setForm({ ...form, recurring_day: e.target.value ? Number(e.target.value) : null })}
                    className="input text-sm py-1" placeholder="예) 28" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">시</label>
                  <input type="number" min={0} max={23}
                    value={form.recurring_hour ?? ''}
                    onChange={e => setForm({ ...form, recurring_hour: e.target.value !== '' ? Number(e.target.value) : null })}
                    className="input text-sm py-1" placeholder="예) 10" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">분</label>
                  <input type="number" min={0} max={59} step={10}
                    value={form.recurring_minute ?? ''}
                    onChange={e => setForm({ ...form, recurring_minute: e.target.value !== '' ? Number(e.target.value) : null })}
                    className="input text-sm py-1" placeholder="0" />
                </div>
                <p className="col-span-4 text-xs text-slate-400">
                  다음 해 복사 시 이 월/일/시각으로 scheduled_at이 자동 설정됩니다.
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.auto_send} onChange={e => setForm({ ...form, auto_send: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm">⚡ 예약 시각에 자동 발송 <span className="text-xs text-slate-400">(체크 시 scheduled_at 도달하면 스케줄러가 자동 발송. 체크 해제 시 수동 발송 버튼 필요)</span></span>
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={submitting} className="flex-1 btn-primary">
              {submitting ? '처리 중...' : isEdit ? '수정' : '생성'}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
