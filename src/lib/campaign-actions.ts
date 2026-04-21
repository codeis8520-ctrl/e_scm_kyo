'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { sendCampaignCore } from '@/lib/campaign-send-core';
import type { Campaign } from '@/lib/campaign-types';

// ─── 권한 체크 ─────────────────────────────────────────────────────────────────

const HQ_ROLES = ['SUPER_ADMIN', 'HQ_OPERATOR', 'EXECUTIVE'];

async function requireHQ() {
  const session = await requireSession();
  if (!HQ_ROLES.includes(session.role)) {
    throw new Error('본사 권한이 필요합니다.');
  }
  return session;
}

// ─── 목록 조회 ─────────────────────────────────────────────────────────────────

interface CampaignFilters {
  status?: string;
  event_type?: string;
}

export async function getCampaigns(filters?: CampaignFilters): Promise<{ data?: Campaign[]; error?: string }> {
  try {
    await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }

  const supabase = await createClient();
  let query = (supabase as any)
    .from('notification_campaigns')
    .select('*, target_branch:branches!target_branch_id(name)')
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.event_type) {
    query = query.eq('event_type', filters.event_type);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return { data: data as Campaign[] };
}

// ─── 신규 생성 ─────────────────────────────────────────────────────────────────

interface CreateCampaignParams {
  name: string;
  description?: string;
  event_type?: string;
  // scheduled_at: ISO 8601 (예: "2026-05-08T10:00" 혹은 "2026-05-08T10:00:00Z")
  scheduled_at?: string | null;
  // start_date/end_date: 옵션(반복 캠페인 윈도우 표시 등)
  start_date?: string | null;
  end_date?: string | null;
  is_recurring?: boolean;
  recurring_month?: number | null;
  recurring_day?: number | null;
  recurring_duration_days?: number | null;
  recurring_hour?: number | null;
  recurring_minute?: number | null;
  target_grade?: string;
  target_branch_id?: string | null;
  solapi_template_id?: string;
  template_content?: string;
  template_variables?: string[];
  variable_overrides?: Record<string, string>;
  auto_send?: boolean;
}

export async function createCampaign(params: CreateCampaignParams): Promise<{ success?: boolean; data?: Campaign; error?: string }> {
  let session;
  try { session = await requireHQ(); } catch (e: any) { return { error: e.message }; }

  // scheduled_at 있고 start_date 비어있으면 자동 채움(목록 필터/정렬용)
  const startDate = params.start_date
    || (params.scheduled_at ? params.scheduled_at.slice(0, 10) : null);
  const endDate = params.end_date || startDate;

  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from('notification_campaigns')
    .insert({
      name: params.name,
      description: params.description || null,
      event_type: params.event_type || 'CUSTOM',
      scheduled_at: params.scheduled_at || null,
      start_date: startDate,
      end_date: endDate,
      is_recurring: params.is_recurring ?? false,
      recurring_month: params.recurring_month ?? null,
      recurring_day: params.recurring_day ?? null,
      recurring_duration_days: params.recurring_duration_days ?? null,
      recurring_hour: params.recurring_hour ?? null,
      recurring_minute: params.recurring_minute ?? null,
      target_grade: params.target_grade || 'ALL',
      target_branch_id: params.target_branch_id || null,
      solapi_template_id: params.solapi_template_id || null,
      template_content: params.template_content || null,
      template_variables: params.template_variables || [],
      variable_overrides: params.variable_overrides || {},
      auto_send: params.auto_send ?? false,
      status: 'DRAFT',
      created_by: session.id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath('/customers');
  return { success: true, data: data as Campaign };
}

// ─── 수정 ──────────────────────────────────────────────────────────────────────

export async function updateCampaign(
  id: string,
  params: Partial<CreateCampaignParams>,
): Promise<{ success?: boolean; data?: Campaign; error?: string }> {
  try { await requireHQ(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();

  // DRAFT 또는 ACTIVE 상태만 수정 가능
  const { data: existing, error: fetchErr } = await (supabase as any)
    .from('notification_campaigns')
    .select('status')
    .eq('id', id)
    .single();

  if (fetchErr) return { error: fetchErr.message };
  if (!existing) return { error: '캠페인을 찾을 수 없습니다.' };
  if (!['DRAFT', 'ACTIVE'].includes(existing.status)) {
    return { error: `현재 상태(${existing.status})에서는 수정할 수 없습니다.` };
  }

  // scheduled_at 재지정 시 start_date 자동 반영(비어있으면)
  const patch: any = { ...params };
  if (params.scheduled_at && !params.start_date) {
    patch.start_date = params.scheduled_at.slice(0, 10);
    if (!params.end_date) patch.end_date = patch.start_date;
  }

  const { data, error } = await (supabase as any)
    .from('notification_campaigns')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath('/customers');
  return { success: true, data: data as Campaign };
}

// ─── 삭제 ──────────────────────────────────────────────────────────────────────

export async function deleteCampaign(id: string): Promise<{ success?: boolean; error?: string }> {
  try { await requireHQ(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();

  // DRAFT 상태만 삭제 가능
  const { data: existing, error: fetchErr } = await (supabase as any)
    .from('notification_campaigns')
    .select('status')
    .eq('id', id)
    .single();

  if (fetchErr) return { error: fetchErr.message };
  if (!existing) return { error: '캠페인을 찾을 수 없습니다.' };
  if (existing.status !== 'DRAFT') {
    return { error: 'DRAFT 상태의 캠페인만 삭제할 수 있습니다.' };
  }

  const { error } = await (supabase as any)
    .from('notification_campaigns')
    .delete()
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/customers');
  return { success: true };
}

// ─── 활성화 (DRAFT → ACTIVE) ──────────────────────────────────────────────────

export async function activateCampaign(id: string): Promise<{ success?: boolean; error?: string }> {
  try { await requireHQ(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await (supabase as any)
    .from('notification_campaigns')
    .select('status')
    .eq('id', id)
    .single();

  if (fetchErr) return { error: fetchErr.message };
  if (!existing) return { error: '캠페인을 찾을 수 없습니다.' };
  if (existing.status !== 'DRAFT') {
    return { error: 'DRAFT 상태의 캠페인만 활성화할 수 있습니다.' };
  }

  const { error } = await (supabase as any)
    .from('notification_campaigns')
    .update({ status: 'ACTIVE' })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/customers');
  return { success: true };
}

// ─── 취소 (ACTIVE/DRAFT → CANCELLED) ──────────────────────────────────────────

export async function cancelCampaign(id: string): Promise<{ success?: boolean; error?: string }> {
  try { await requireHQ(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await (supabase as any)
    .from('notification_campaigns')
    .select('status')
    .eq('id', id)
    .single();

  if (fetchErr) return { error: fetchErr.message };
  if (!existing) return { error: '캠페인을 찾을 수 없습니다.' };
  if (!['DRAFT', 'ACTIVE'].includes(existing.status)) {
    return { error: `현재 상태(${existing.status})에서는 취소할 수 없습니다.` };
  }

  const { error } = await (supabase as any)
    .from('notification_campaigns')
    .update({ status: 'CANCELLED' })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/customers');
  return { success: true };
}

// ─── 발송 (ACTIVE → SENT) — UI 수동 경로 ─────────────────────────────────────
// 스케줄러는 sendCampaignCore 를 직접 호출한다.

export async function sendCampaign(id: string): Promise<{
  success?: boolean;
  successCount?: number;
  failCount?: number;
  error?: string;
}> {
  let session;
  try { session = await requireHQ(); } catch (e: any) { return { error: e.message }; }

  const r = await sendCampaignCore({ campaignId: id, sentByUserId: session.id });
  if (!r.success) return { error: r.error };

  revalidatePath('/customers');
  return {
    success: true,
    successCount: r.successCount,
    failCount: r.failCount,
  };
}

// ─── 다음 해 복사 ─────────────────────────────────────────────────────────────

export async function copyCampaignForNextYear(id: string): Promise<{
  success?: boolean;
  data?: Campaign;
  error?: string;
}> {
  try { await requireHQ(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  const { data: source, error: fetchErr } = await db
    .from('notification_campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr) return { error: fetchErr.message };
  if (!source) return { error: '원본 캠페인을 찾을 수 없습니다.' };
  if (!source.is_recurring) return { error: '반복 캠페인만 복사할 수 있습니다.' };

  // 날짜를 1년 후로 이동
  const nextStart = new Date(source.start_date);
  nextStart.setFullYear(nextStart.getFullYear() + 1);
  const nextEnd = new Date(source.end_date);
  nextEnd.setFullYear(nextEnd.getFullYear() + 1);

  // 발송 시각은 반복 스펙(recurring_hour/minute)이 있으면 해당 시각으로, 없으면 자정으로
  const nextStartDateStr = nextStart.toISOString().slice(0, 10);
  let nextScheduledAt: string | null = null;
  if (source.recurring_month && source.recurring_day) {
    const hh = source.recurring_hour ?? 0;
    const mm = source.recurring_minute ?? 0;
    // KST(+09:00) 기준 로컬 시각을 ISO로 구성 → DB는 UTC로 저장
    const local = new Date(`${nextStartDateStr}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00+09:00`);
    nextScheduledAt = local.toISOString();
  }

  const { data: newCampaign, error: insertErr } = await db
    .from('notification_campaigns')
    .insert({
      name: source.name.replace(/\d{4}/, String(nextStart.getFullYear())),
      description: source.description,
      event_type: source.event_type,
      scheduled_at: nextScheduledAt,
      start_date: nextStartDateStr,
      end_date: nextEnd.toISOString().slice(0, 10),
      is_recurring: true,
      recurring_month: source.recurring_month,
      recurring_day: source.recurring_day,
      recurring_duration_days: source.recurring_duration_days,
      recurring_hour: source.recurring_hour,
      recurring_minute: source.recurring_minute,
      target_grade: source.target_grade,
      target_branch_id: source.target_branch_id,
      solapi_template_id: source.solapi_template_id,
      template_content: source.template_content,
      template_variables: source.template_variables,
      variable_overrides: source.variable_overrides,
      auto_send: source.auto_send,
      status: 'DRAFT',
      created_by: source.created_by,
    })
    .select()
    .single();

  if (insertErr) return { error: insertErr.message };

  revalidatePath('/customers');
  return { success: true, data: newCampaign as Campaign };
}

// ─── 반복 캠페인 추천 (올해 버전 미생성) ──────────────────────────────────────

export async function getRecurringSuggestions(): Promise<{
  data?: Campaign[];
  error?: string;
}> {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  // 반복 캠페인 중 올해 시작일 범위에 해당 버전이 없는 것
  const { data: recurring, error: recErr } = await db
    .from('notification_campaigns')
    .select('*')
    .eq('is_recurring', true)
    .lt('start_date', yearStart); // 작년 이전 캠페인

  if (recErr) return { error: recErr.message };
  if (!recurring || recurring.length === 0) return { data: [] };

  // 올해 이미 생성된 캠페인의 event_type 목록
  const { data: thisYear, error: tyErr } = await db
    .from('notification_campaigns')
    .select('event_type, name')
    .gte('start_date', yearStart)
    .lte('start_date', yearEnd);

  if (tyErr) return { error: tyErr.message };

  const thisYearKeys = new Set(
    (thisYear || []).map((c: any) => `${c.event_type}::${c.name.replace(/\d{4}/, '')}`)
  );

  const suggestions = recurring.filter((c: any) => {
    const key = `${c.event_type}::${c.name.replace(/\d{4}/, '')}`;
    return !thisYearKeys.has(key);
  });

  return { data: suggestions as Campaign[] };
}
