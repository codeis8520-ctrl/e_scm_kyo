'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { sendKakaoMessages } from '@/lib/solapi/client';
import { resolveAllVariables } from '@/lib/solapi/variable-resolver';
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
  start_date: string;
  end_date: string;
  is_recurring?: boolean;
  recurring_month?: number;
  recurring_day?: number;
  recurring_duration_days?: number;
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

  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from('notification_campaigns')
    .insert({
      name: params.name,
      description: params.description || null,
      event_type: params.event_type || 'CUSTOM',
      start_date: params.start_date,
      end_date: params.end_date,
      is_recurring: params.is_recurring ?? false,
      recurring_month: params.recurring_month ?? null,
      recurring_day: params.recurring_day ?? null,
      recurring_duration_days: params.recurring_duration_days ?? null,
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

  const { data, error } = await (supabase as any)
    .from('notification_campaigns')
    .update(params)
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

// ─── 발송 (ACTIVE → SENT) ─────────────────────────────────────────────────────

export async function sendCampaign(id: string): Promise<{
  success?: boolean;
  successCount?: number;
  failCount?: number;
  error?: string;
}> {
  let session;
  try { session = await requireHQ(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  // 캠페인 조회
  const { data: campaign, error: campErr } = await db
    .from('notification_campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (campErr) return { error: campErr.message };
  if (!campaign) return { error: '캠페인을 찾을 수 없습니다.' };
  if (campaign.status !== 'ACTIVE') {
    return { error: 'ACTIVE 상태의 캠페인만 발송할 수 있습니다.' };
  }
  if (!campaign.solapi_template_id || !campaign.template_content) {
    return { error: '템플릿 ID와 내용이 설정되어야 합니다.' };
  }

  // 대상 고객 조회
  let customerQuery = db
    .from('customers')
    .select('id, name, phone')
    .eq('is_active', true)
    .not('phone', 'like', 'cafe24_%');

  if (campaign.target_grade !== 'ALL') {
    customerQuery = customerQuery.eq('grade', campaign.target_grade);
  }
  if (campaign.target_branch_id) {
    customerQuery = customerQuery.eq('branch_id', campaign.target_branch_id);
  }

  const { data: customers, error: custErr } = await customerQuery;
  if (custErr) return { error: `고객 조회 실패: ${custErr.message}` };
  if (!customers || customers.length === 0) {
    return { error: '발송 대상 고객이 없습니다.' };
  }

  const templateVariables: string[] = campaign.template_variables || [];
  const variableOverrides: Record<string, string> = campaign.variable_overrides || {};

  // 알림톡 일괄 발송
  const result = await sendKakaoMessages(
    customers.map((c: any) => {
      const vars = resolveAllVariables(templateVariables, {
        customerName: c.name,
        customerPhone: c.phone,
      });
      // variable_overrides 머지
      const mergedVars = { ...vars, ...variableOverrides };

      // 텍스트 변수 치환
      let text = campaign.template_content as string;
      Object.entries(mergedVars).forEach(([k, v]) => {
        text = text.replaceAll(k, v);
      });

      return {
        to: c.phone,
        templateId: campaign.solapi_template_id!,
        variables: mergedVars,
        text,
        customerId: c.id,
      };
    }),
  );

  // notifications 테이블에 기록
  const notifRows = customers.map((c: any, i: number) => {
    const r = result.results[i];
    const vars = resolveAllVariables(templateVariables, {
      customerName: c.name,
      customerPhone: c.phone,
    });
    const mergedVars = { ...vars, ...variableOverrides };
    let msg = campaign.template_content as string;
    Object.entries(mergedVars).forEach(([k, v]) => {
      msg = msg.replaceAll(k, v);
    });

    return {
      customer_id: c.id,
      notification_type: 'KAKAO',
      template_id: null,
      template_code: campaign.solapi_template_id,
      phone: c.phone,
      message: msg,
      status: r.success ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      external_message_id: r.messageId || null,
      error_message: r.error || null,
      sent_by: session.id,
      trigger_source: 'SCHEDULED',
    };
  });

  const { error: insertErr } = await db.from('notifications').insert(notifRows);
  if (insertErr) {
    console.error('[sendCampaign] notifications insert 실패:', insertErr);
  }

  // 캠페인 상태 업데이트
  const { error: updateErr } = await db
    .from('notification_campaigns')
    .update({
      status: 'SENT',
      sent_at: new Date().toISOString(),
      sent_count: result.successCount,
      failed_count: result.failCount,
    })
    .eq('id', id);

  if (updateErr) {
    console.error('[sendCampaign] campaign update 실패:', updateErr);
    return {
      success: true,
      successCount: result.successCount,
      failCount: result.failCount,
    };
  }

  revalidatePath('/customers');
  return {
    success: true,
    successCount: result.successCount,
    failCount: result.failCount,
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

  const { data: newCampaign, error: insertErr } = await db
    .from('notification_campaigns')
    .insert({
      name: source.name.replace(/\d{4}/, String(nextStart.getFullYear())),
      description: source.description,
      event_type: source.event_type,
      start_date: nextStart.toISOString().slice(0, 10),
      end_date: nextEnd.toISOString().slice(0, 10),
      is_recurring: true,
      recurring_month: source.recurring_month,
      recurring_day: source.recurring_day,
      recurring_duration_days: source.recurring_duration_days,
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
