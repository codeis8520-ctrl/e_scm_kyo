'use server';

import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { sendMessages, sendKakaoMessages } from '@/lib/solapi/client';
import { resolveAllVariables, type VariableContext } from '@/lib/solapi/variable-resolver';

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
  templateContent: string;  // 원본 템플릿 내용 (변수 치환용)
  variableKeys: string[];   // 템플릿 변수 키 목록 (예: ['#{홍길동}', '#{url}'])
  context?: Omit<VariableContext, 'customerName' | 'customerPhone'>;  // 공통 컨텍스트 (주문번호 등)
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
      sent_at: new Date().toISOString(),
      external_message_id: r.messageId || null,
      error_message: r.error || null,
      sent_by: session.id,
    };
  });

  const { error: insertErr } = await db.from('notifications').insert(rows);
  if (insertErr) {
    console.error('[sendSmsAction] notifications insert 실패:', insertErr);
    return {
      success: true,
      successCount: result.successCount,
      failCount: result.failCount,
      warning: `발송은 완료되었으나 이력 저장 실패: ${insertErr.message}`,
    };
  }

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

  const { targets, templateId, templateContent, variableKeys, context: extraContext = {} } = params;
  if (!targets.length) return { error: '발송 대상이 없습니다.' };

  // 지점명 자동 조회 (#{상점명} 변수용)
  const supabase = await createClient();
  let branchName = process.env.NEXT_PUBLIC_BRAND_NAME ?? '';
  if (session.branch_id) {
    const { data: branch } = await (supabase as any)
      .from('branches').select('name').eq('id', session.branch_id).maybeSingle();
    branchName = branch?.name ?? branchName;
  }
  const context = { ...extraContext, branchName };

  const result = await sendKakaoMessages(
    targets.map(t => {
      const vars = resolveAllVariables(variableKeys, {
        ...context,
        customerName:  t.name,
        customerPhone: t.phone,
      });
      // 변수 치환된 최종 메시지
      let text = templateContent;
      Object.entries(vars).forEach(([k, v]) => { text = text.replaceAll(k, v); });
      console.log('[sendKakaoAction] variableKeys:', variableKeys, '| vars:', vars, '| text:', text);
      return {
        to: t.phone,
        templateId,
        variables: vars,
        text,
        customerId: t.customerId || undefined,
      };
    })
  );

  const db = supabase as any;
  // 각 수신자별 렌더링된 메시지 재계산 (DB 기록용)
  const renderedMessages = targets.map(t => {
    const vars = resolveAllVariables(variableKeys, { ...context, customerName: t.name, customerPhone: t.phone });
    let msg = templateContent;
    Object.entries(vars).forEach(([k, v]) => { msg = msg.replaceAll(k, v); });
    return msg;
  });

  // notifications.template_id는 내부 notification_templates(id) UUID FK.
  // Solapi의 templateId("KA01TP...")는 문자열이라 template_code에만 저장.
  const rows = targets.map((t, i) => {
    const r = result.results[i];
    return {
      customer_id: t.customerId,
      notification_type: 'KAKAO',
      template_id: null,          // 내부 템플릿 UUID가 아니면 null
      template_code: templateId,  // Solapi 템플릿 ID 문자열
      phone: t.phone,
      message: renderedMessages[i],
      status: r.success ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      external_message_id: r.messageId || null,
      error_message: r.error || null,
      sent_by: session.id,
    };
  });

  const { error: insertErr } = await db.from('notifications').insert(rows);
  if (insertErr) {
    console.error('[sendKakaoAction] notifications insert 실패:', insertErr);
    return {
      success: true,
      successCount: result.successCount,
      failCount: result.failCount,
      warning: `발송은 완료되었으나 이력 저장 실패: ${insertErr.message}`,
    };
  }

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
