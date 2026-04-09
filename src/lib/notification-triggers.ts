'use server';

// ═══════════════════════════════════════════════════════════════════════
// 이벤트 기반 자동 알림톡 발송
//
// 업무 로직의 특정 이벤트(주문완료, 배송, 환불, 회원가입 등) 발생 시점에서
// notification_template_mappings 테이블을 조회하여
//   - event_type === 이벤트 유형
//   - auto_trigger_enabled === true
// 조건의 템플릿을 자동으로 카카오 알림톡 발송한다.
//
// 중요: 이 함수는 절대 throw하지 않는다. 업무 로직을 블로킹해서는 안 된다.
//       실패하면 console.error + notifications 테이블에 'failed'로 기록.
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from '@/lib/supabase/server';
import { sendKakaoMessages } from '@/lib/solapi/client';
import { resolveAllVariables, type VariableContext } from '@/lib/solapi/variable-resolver';
import type { EventTypeKey } from './notification-event-types';

export interface TriggerNotificationParams {
  eventType: EventTypeKey | string;
  customer: { id?: string | null; name: string; phone: string };
  context?: {
    orderNo?: string;
    amount?: number | string;
    trackingNo?: string;
    productName?: string;
    authCode?: string;
    branchName?: string;
    customerGrade?: string;
  };
}

export async function triggerEventNotification(
  params: TriggerNotificationParams
): Promise<void> {
  try {
    if (!params.customer?.phone || !params.customer?.name) {
      console.warn('[notify-trigger] 고객 정보 부족 → 스킵:', params.eventType);
      return;
    }

    const supabase = (await createClient()) as any;

    // 자동 발송 활성화된 매핑 조회
    const { data: mappings, error: mapErr } = await supabase
      .from('notification_template_mappings')
      .select('*')
      .eq('event_type', params.eventType)
      .eq('auto_trigger_enabled', true);

    if (mapErr) {
      console.error('[notify-trigger] 매핑 조회 실패:', mapErr.message);
      return;
    }
    if (!mappings || mappings.length === 0) {
      // 자동 발송 매핑 없음 — 정상 종료 (조용히)
      return;
    }

    // 변수 해석 컨텍스트
    const ctx: VariableContext = {
      customerName: params.customer.name,
      customerPhone: params.customer.phone,
      customerGrade: params.context?.customerGrade,
      customerId: params.customer.id || undefined,
      orderNo: params.context?.orderNo,
      trackingNo: params.context?.trackingNo,
      amount: params.context?.amount !== undefined ? String(params.context.amount) : undefined,
      productName: params.context?.productName,
      branchName: params.context?.branchName,
      authCode: params.context?.authCode,
    };

    for (const mapping of mappings as any[]) {
      const content: string | null = mapping.template_content;
      const varKeys: string[] = Array.isArray(mapping.template_variables)
        ? mapping.template_variables
        : [];

      if (!content) {
        console.warn(
          '[notify-trigger] template_content 없음 — 관리 화면에서 저장 필요:',
          mapping.solapi_template_id
        );
        continue;
      }

      // 변수 해석
      const vars = resolveAllVariables(varKeys, ctx);

      // 변수 치환된 최종 텍스트
      let text = content;
      Object.entries(vars).forEach(([k, v]) => {
        text = text.split(k).join(String(v ?? ''));
      });

      // 미치환 변수 검출 (값 없는 플레이스홀더 남아있는지)
      const unresolved = text.match(/#\{[^}]+\}/g);
      if (unresolved && unresolved.length > 0) {
        console.warn(
          '[notify-trigger] 미치환 변수 존재 — 발송 스킵:',
          mapping.solapi_template_id,
          unresolved
        );
        // notifications에 skipped 사유로 기록 (failed로 기록)
        await supabase.from('notifications').insert({
          customer_id: params.customer.id || null,
          notification_type: 'KAKAO',
          template_id: null,
          template_code: mapping.solapi_template_id,
          phone: params.customer.phone,
          message: text,
          status: 'failed',
          sent_at: new Date().toISOString(),
          error_message: `변수 미치환: ${unresolved.join(', ')}`,
          sent_by: null,
        });
        continue;
      }

      // Solapi 발송
      const result = await sendKakaoMessages([
        {
          to: params.customer.phone,
          templateId: mapping.solapi_template_id,
          variables: vars,
          text,
          customerId: params.customer.id || undefined,
        },
      ]);
      const r = result.results[0];

      // 이력 저장
      await supabase.from('notifications').insert({
        customer_id: params.customer.id || null,
        notification_type: 'KAKAO',
        template_id: null,
        template_code: mapping.solapi_template_id,
        phone: params.customer.phone,
        message: text,
        status: r?.success ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        external_message_id: r?.messageId || null,
        error_message: r?.error || null,
        sent_by: null,
      });

      if (!r?.success) {
        console.error(
          '[notify-trigger] 발송 실패:',
          mapping.solapi_template_id,
          r?.error
        );
      }
    }
  } catch (err: any) {
    // 절대 throw 하지 않음 — 업무 로직 보호
    console.error('[notify-trigger] 예외:', params.eventType, err?.message || err);
  }
}

// fire-and-forget 헬퍼 (await 없이 사용 가능)
export async function fireNotificationTrigger(
  params: TriggerNotificationParams
): Promise<void> {
  // 내부에서 try/catch 하므로 await 해도 안전
  triggerEventNotification(params).catch(e => {
    console.error('[notify-trigger/fire] 예외:', e?.message || e);
  });
}
