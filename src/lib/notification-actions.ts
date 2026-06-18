'use server';

import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { sendMessages, sendKakaoMessages } from '@/lib/solapi/client';
import { resolveAllVariables, type VariableContext } from '@/lib/solapi/variable-resolver';
import { kstTodayString, kstDaysAgoStart } from '@/lib/date';

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
      trigger_source: 'MANUAL',
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
      trigger_source: 'MANUAL',
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

// ─── 수동 배치 실행 (생일/휴면) ────────────────────────────────────────────────

export async function runNotificationBatch(batchType: 'BIRTHDAY' | 'DORMANT', options?: { days?: number; limit?: number }) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  // HQ 권한 체크 (일반 직원이 배치 돌리면 안 됨)
  const HQ = new Set(['SUPER_ADMIN', 'HQ_OPERATOR', 'EXECUTIVE']);
  if (session.role && !HQ.has(session.role)) {
    return { error: '본사 권한이 필요합니다.' };
  }

  const supabase = await createClient();
  const db = supabase as any;

  // 배치 로그 시작
  const { data: logRow } = await db
    .from('notification_batch_logs')
    .insert({
      batch_type: batchType,
      detail: options ? { ...options, manual: true, userId: session.id } : { manual: true, userId: session.id },
    })
    .select('id')
    .single();
  const logId = logRow?.id;

  // 동적 import로 순환 의존 방지
  const { triggerEventNotification } = await import('@/lib/notification-triggers');

  let target = 0, sent = 0, failed = 0, skipped = 0;

  try {
    if (batchType === 'BIRTHDAY') {
      // KST 오늘 기준 MM-DD
      const mmdd = kstTodayString().slice(5);

      const { data: customers } = await db
        .from('customers')
        .select('id, name, phone, grade, birthday')
        .eq('is_active', true)
        .not('birthday', 'is', null);

      const todayBirthdays = ((customers || []) as any[]).filter((c: any) => {
        if (!c.birthday) return false;
        try {
          const d = new Date(c.birthday);
          const cmm = String(d.getMonth() + 1).padStart(2, '0');
          const cdd = String(d.getDate()).padStart(2, '0');
          return `${cmm}-${cdd}` === mmdd;
        } catch { return false; }
      });

      target = todayBirthdays.length;
      for (const cust of todayBirthdays) {
        if (!cust.phone || !cust.name) { skipped++; continue; }
        try {
          await triggerEventNotification({
            eventType: 'BIRTHDAY',
            customer: { id: cust.id, name: cust.name, phone: cust.phone },
            context: { customerGrade: cust.grade || 'NORMAL' },
            triggerSource: 'SCHEDULED',
          });
          sent++;
        } catch { failed++; }
      }
    } else if (batchType === 'DORMANT') {
      const days = options?.days ?? 90;
      const limit = options?.limit ?? 100;

      // "최근 N일 구매 고객" — KST 자정 기준 N일 전
      const cutoffIso = kstDaysAgoStart(days);

      const { data: recentOrders } = await db
        .from('sales_orders')
        .select('customer_id')
        .gte('ordered_at', cutoffIso)
        .eq('status', 'COMPLETED')
        .not('customer_id', 'is', null);
      const activeIds = new Set(((recentOrders || []) as any[]).map(r => r.customer_id));

      const { data: allCust } = await db
        .from('customers')
        .select('id, name, phone, grade')
        .eq('is_active', true);

      const candidates = ((allCust || []) as any[])
        .filter(c => !activeIds.has(c.id) && c.name && c.phone)
        .slice(0, limit);

      // 최근 30일 내 DORMANT 알림 받은 고객 제외 (KST 기준 30일)
      const recentBlockIso = kstDaysAgoStart(30);
      const candidateIds = candidates.map(c => c.id);
      if (candidateIds.length > 0) {
        const { data: recentNotif } = await db
          .from('notifications')
          .select('customer_id')
          .in('customer_id', candidateIds)
          .eq('notification_type', 'KAKAO')
          .eq('status', 'sent')
          .gte('sent_at', recentBlockIso);
        const already = new Set(((recentNotif || []) as any[]).map(n => n.customer_id));
        for (let i = candidates.length - 1; i >= 0; i--) {
          if (already.has(candidates[i].id)) { candidates.splice(i, 1); skipped++; }
        }
      }

      target = candidates.length;
      for (const cust of candidates) {
        try {
          await triggerEventNotification({
            eventType: 'DORMANT',
            customer: { id: cust.id, name: cust.name, phone: cust.phone },
            context: { customerGrade: cust.grade || 'NORMAL' },
            triggerSource: 'SCHEDULED',
          });
          sent++;
        } catch { failed++; }
      }
    }
  } catch (e: any) {
    if (logId) {
      await db.from('notification_batch_logs').update({
        target_count: target, sent_count: sent, failed_count: failed, skipped_count: skipped,
        detail: { error: e?.message || String(e), manual: true },
        finished_at: new Date().toISOString(),
      }).eq('id', logId);
    }
    return { error: e?.message || String(e) };
  }

  if (logId) {
    await db.from('notification_batch_logs').update({
      target_count: target,
      sent_count: sent,
      failed_count: failed,
      skipped_count: skipped,
      finished_at: new Date().toISOString(),
    }).eq('id', logId);
  }

  return { success: true, target, sent, failed, skipped };
}

// 배치 로그 조회
export async function getBatchLogs(batchType?: string, limit = 20) {
  const supabase = await createClient();
  let q = (supabase as any)
    .from('notification_batch_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (batchType) q = q.eq('batch_type', batchType);
  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

// ─── 실패 건 재발송 ────────────────────────────────────────────────────────────

export async function resendFailedNotification(notificationId: string) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  const { data: notif } = await db
    .from('notifications')
    .select('*')
    .eq('id', notificationId)
    .maybeSingle();

  if (!notif) return { error: '발송 이력을 찾을 수 없습니다.' };
  if (notif.status !== 'failed') return { error: '실패 상태의 건만 재발송 가능합니다.' };

  // SMS 재발송
  if (notif.notification_type === 'SMS') {
    const r = await sendMessages([{ to: notif.phone, text: notif.message, customerId: notif.customer_id || undefined }]);
    const res = r.results[0];
    await db.from('notifications').insert({
      customer_id: notif.customer_id,
      notification_type: 'SMS',
      phone: notif.phone,
      message: notif.message,
      status: res?.success ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      external_message_id: res?.messageId || null,
      error_message: res?.error || null,
      sent_by: session.id,
      trigger_source: 'MANUAL',
    });
    return { success: true, resent: res?.success };
  }

  // 알림톡 재발송 — template_code 기준으로 매핑 조회 후 동일 내용으로 재전송
  if (notif.notification_type === 'KAKAO') {
    const { data: mapping } = await db
      .from('notification_template_mappings')
      .select('*')
      .eq('solapi_template_id', notif.template_code)
      .maybeSingle();

    if (!mapping?.template_content) {
      return { error: '해당 템플릿의 매핑 정보가 없어 재발송 불가.' };
    }

    // 이미 치환된 메시지를 그대로 재전송 (원본 변수 값은 복원 불가하므로 저장된 message 사용)
    const r = await sendKakaoMessages([{
      to: notif.phone,
      templateId: notif.template_code,
      variables: {},  // 이미 치환된 text를 그대로 보냄
      text: notif.message,
      customerId: notif.customer_id || undefined,
    }]);
    const res = r.results[0];
    await db.from('notifications').insert({
      customer_id: notif.customer_id,
      notification_type: 'KAKAO',
      template_id: null,
      template_code: notif.template_code,
      phone: notif.phone,
      message: notif.message,
      status: res?.success ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      external_message_id: res?.messageId || null,
      error_message: res?.error || null,
      sent_by: session.id,
      trigger_source: 'MANUAL',
    });
    return { success: true, resent: res?.success };
  }

  return { error: '알 수 없는 알림 유형입니다.' };
}

// ─── 발송 이력 조회 ────────────────────────────────────────────────────────────

export async function getNotifications(filters?: { status?: string; type?: string }) {
  const supabase = await createClient();
  let q = (supabase as any)
    .from('notifications')
    .select('*, customer:customers(name, phone)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.type)   q = q.eq('notification_type', filters.type);

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

// ─── 발송 대상 해석 (모드별 서버측 대상 산출) ─────────────────────────────────────

export type SendAudienceMode = 'ids' | 'grade' | 'all';

export interface ResolveTargetsParams {
  mode: SendAudienceMode;
  customerIds?: string[];   // mode='ids'
  grade?: string;           // mode='grade' ('NORMAL'|'VIP'|'VVIP')
}

interface CustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  grade: string | null;
}

const HQ_ROLES = new Set(['SUPER_ADMIN', 'HQ_OPERATOR', 'EXECUTIVE']);

// 전화번호 정규화 (하이픈/공백 제거) — 중복 판정용
function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '');
}

export async function resolveSendTargets(
  params: ResolveTargetsParams,
): Promise<{ targets: SendTarget[]; total: number; skipped: number } | { error: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const { mode, customerIds, grade } = params;

  // RBAC: 대량발송(등급/전체)은 본사 전용
  const isHQ = !session.role || HQ_ROLES.has(session.role);
  if ((mode === 'grade' || mode === 'all') && !isHQ) {
    return { error: '대량 발송은 본사 권한이 필요합니다.' };
  }

  // 지점 사용자 스코프 (자기 지점 고객만) — HQ는 무제한
  const branchScope = !isHQ ? session.branch_id : null;

  const supabase = await createClient();
  const db = supabase as any;

  let rows: CustomerRow[] = [];

  try {
    if (mode === 'ids') {
      const ids = customerIds || [];
      if (!ids.length) return { error: '선택된 고객이 없습니다.' };

      // PostgREST URL 한도 회피: .in() 200개씩 청크
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        let q = db
          .from('customers')
          .select('id, name, phone, grade')
          .eq('is_active', true)
          .not('phone', 'is', null)
          .in('id', slice);
        if (branchScope) q = q.eq('primary_branch_id', branchScope);
        const { data, error } = await q;
        if (error) return { error: error.message };
        rows.push(...((data || []) as CustomerRow[]));
      }
    } else {
      // mode='grade' | 'all' — 1000캡 우회 .range() 페이지네이션 루프
      if (mode === 'grade' && !grade) return { error: '등급이 지정되지 않았습니다.' };

      const PAGE = 1000;
      let start = 0;
      while (true) {
        let q = db
          .from('customers')
          .select('id, name, phone, grade')
          .eq('is_active', true)
          .not('phone', 'is', null);
        if (mode === 'grade') q = q.eq('grade', grade);
        if (branchScope) q = q.eq('primary_branch_id', branchScope);
        q = q.order('id').range(start, start + PAGE - 1);
        const { data, error } = await q;
        if (error) return { error: error.message };
        const page = (data || []) as CustomerRow[];
        rows.push(...page);
        if (page.length < PAGE) break;
        start += PAGE;
      }
    }
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  // 전화없음 제외 + 중복제거 (정규화 번호 기준)
  let skipped = 0;
  const seen = new Set<string>();
  const targets: SendTarget[] = [];
  for (const r of rows) {
    const phone = (r.phone || '').trim();
    if (!phone) { skipped++; continue; }
    const key = normalizePhone(phone);
    if (!key || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    targets.push({ customerId: r.id, phone, name: r.name || undefined });
  }

  return { targets, total: targets.length, skipped };
}
