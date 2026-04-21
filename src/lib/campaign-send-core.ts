// 캠페인 발송 — 순수 로직 (인증 없음)
// 세션 검증은 호출자 책임: UI 경로는 campaign-actions.ts, 크론은 CRON_SECRET 라우트.

import { createClient as createSbClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendKakaoMessages } from '@/lib/solapi/client';
import { resolveAllVariables } from '@/lib/solapi/variable-resolver';

function sbAdmin(): SupabaseClient {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export interface SendCampaignCoreResult {
  success: boolean;
  successCount?: number;
  failCount?: number;
  targetCount?: number;
  error?: string;
}

export async function sendCampaignCore(params: {
  campaignId: string;
  sentByUserId?: string | null;
  supabase?: SupabaseClient;
}): Promise<SendCampaignCoreResult> {
  const db = (params.supabase ?? sbAdmin()) as any;

  const { data: campaign, error: campErr } = await db
    .from('notification_campaigns')
    .select('*')
    .eq('id', params.campaignId)
    .single();

  if (campErr) return { success: false, error: campErr.message };
  if (!campaign) return { success: false, error: '캠페인을 찾을 수 없습니다.' };
  if (campaign.status !== 'ACTIVE') {
    return { success: false, error: `ACTIVE 상태의 캠페인만 발송할 수 있습니다. (현재: ${campaign.status})` };
  }
  if (!campaign.solapi_template_id || !campaign.template_content) {
    return { success: false, error: '템플릿 ID와 내용이 설정되어야 합니다.' };
  }

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
  if (custErr) return { success: false, error: `고객 조회 실패: ${custErr.message}` };
  if (!customers || customers.length === 0) {
    return { success: false, error: '발송 대상 고객이 없습니다.', targetCount: 0 };
  }

  const templateVariables: string[] = campaign.template_variables || [];
  const variableOverrides: Record<string, string> = campaign.variable_overrides || {};

  const result = await sendKakaoMessages(
    (customers as any[]).map((c: any) => {
      const vars = resolveAllVariables(templateVariables, {
        customerName: c.name,
        customerPhone: c.phone,
      });
      const mergedVars = { ...vars, ...variableOverrides };
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

  const notifRows = (customers as any[]).map((c: any, i: number) => {
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
      sent_by: params.sentByUserId ?? null,
      trigger_source: 'SCHEDULED',
    };
  });

  const { error: insertErr } = await db.from('notifications').insert(notifRows);
  if (insertErr) {
    console.error('[sendCampaignCore] notifications insert 실패:', insertErr);
  }

  const { error: updateErr } = await db
    .from('notification_campaigns')
    .update({
      status: 'SENT',
      sent_at: new Date().toISOString(),
      sent_count: result.successCount,
      failed_count: result.failCount,
    })
    .eq('id', params.campaignId);

  if (updateErr) {
    console.error('[sendCampaignCore] campaign update 실패:', updateErr);
  }

  return {
    success: true,
    successCount: result.successCount,
    failCount: result.failCount,
    targetCount: customers.length,
  };
}
