'use server';

import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { sendMessages, sendKakaoMessages } from '@/lib/solapi/client';

export interface SendTarget {
  customerId: string | null;
  phone: string;
  name?: string;
}

interface SendSmsParams {
  targets: SendTarget[];
  message: string;
}

interface SendKakaoParams {
  targets: SendTarget[];
  templateId: string;       // Solapi 템플릿 ID (KA01TP...)
  message: string;          // 미리보기/기록용 렌더링된 메시지
  variables?: Record<string, string>;   // 수동 입력 변수 (공통)
  nameVariableKey?: string; // 고객명 자동입력 변수 키 (예: #{홍길동})
}

// ─── SMS 발송 ──────────────────────────────────────────────────────────────────

export async function sendSmsAction(params: SendSmsParams) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const { targets, message } = params;
  if (!targets.length || !message.trim()) return { error: '발송 대상 또는 메시지가 없습니다.' };

  // Solapi 발송
  const result = await sendMessages(
    targets.map(t => ({ to: t.phone, text: message, customerId: t.customerId || undefined }))
  );

  // DB 기록 (성공/실패 모두)
  const supabase = await createClient();
  const db = supabase as any;
  const rows = targets.map((t, i) => {
    const r = result.results[i];
    return {
      customer_id: t.customerId,
      notification_type: 'SMS',
      phone: t.phone,
      message,
      status: r.success ? 'sent' : 'failed',
      external_message_id: r.messageId || null,
      error_message: r.error || null,
      sent_by: session.id,
    };
  });

  await db.from('notifications').insert(rows);

  return {
    success: true,
    successCount: result.successCount,
    failCount: result.failCount,
  };
}

// ─── 알림톡 발송 ───────────────────────────────────────────────────────────────

export async function sendKakaoAction(params: SendKakaoParams) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const { targets, templateId, message, variables = {}, nameVariableKey } = params;
  if (!targets.length) return { error: '발송 대상이 없습니다.' };

  const result = await sendKakaoMessages(
    targets.map(t => ({
      to: t.phone,
      templateId,
      variables: nameVariableKey && (t as any).name
        ? { ...variables, [nameVariableKey]: (t as any).name }
        : variables,
      customerId: t.customerId || undefined,
    }))
  );

  const supabase = await createClient();
  const db = supabase as any;
  const rows = targets.map((t, i) => {
    const r = result.results[i];
    return {
      customer_id: t.customerId,
      notification_type: 'KAKAO',
      template_id: templateId || null,
      template_code: templateId,
      phone: t.phone,
      message,
      status: r.success ? 'sent' : 'failed',
      external_message_id: r.messageId || null,
      error_message: r.error || null,
      sent_by: session.id,
    };
  });

  await db.from('notifications').insert(rows);

  return {
    success: true,
    successCount: result.successCount,
    failCount: result.failCount,
  };
}

// ─── 발송 이력 조회 ────────────────────────────────────────────────────────────

export async function getNotifications(filters?: { status?: string; type?: string }) {
  const supabase = await createClient();
  let q = (supabase as any)
    .from('notifications')
    .select('*, customer:customers(name, phone), template:notification_templates(template_name)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.type)   q = q.eq('notification_type', filters.type);

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}
