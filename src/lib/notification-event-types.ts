// 알림톡 템플릿 이벤트 유형 상수
// notification_template_mappings.event_type 컬럼과 매칭

export const EVENT_TYPES = {
  MANUAL:         '수동 발송 (공지·프로모션)',
  WELCOME:        '회원가입 환영',
  ORDER_COMPLETE: '주문 · 결제 완료',
  SHIPMENT:       '배송 시작 · 송장 등록',
  DELIVERY:       '배송 완료',
  REFUND:         '환불 완료',
  AUTH:           '인증번호',
  POINT:          '포인트 적립 · 사용',
  BIRTHDAY:       '생일 축하',
  DORMANT:        '휴면 재유치',
  OTHER:          '기타',
} as const;

export type EventTypeKey = keyof typeof EVENT_TYPES;

// 수동 발송 화면에서 기본적으로 "수동 발송 가능"으로 표기되는 추천 이벤트
export const MANUAL_SENDABLE_DEFAULTS: EventTypeKey[] = [
  'MANUAL',
  'WELCOME',
  'BIRTHDAY',
  'DORMANT',
];

// 이벤트 전용(수동 발송 비권장) — 선택 시 경고 표시
export const EVENT_ONLY_KEYS: EventTypeKey[] = [
  'ORDER_COMPLETE',
  'SHIPMENT',
  'DELIVERY',
  'REFUND',
  'AUTH',
  'POINT',
];

export interface TemplateMapping {
  solapi_template_id: string;
  event_type: EventTypeKey | string;
  is_manual_sendable: boolean;
  auto_trigger_enabled?: boolean;
  description?: string | null;
  template_content?: string | null;
  template_variables?: string[] | null;
}
