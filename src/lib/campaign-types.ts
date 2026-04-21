export const CAMPAIGN_EVENT_TYPES = {
  SEOLLAL: '설날',
  CHUSEOK: '추석',
  PARENTS_DAY: '어버이날',
  TEACHERS_DAY: '스승의날',
  CHRISTMAS: '크리스마스',
  NEW_YEAR: '새해 인사',
  VALENTINES: '발렌타인/화이트데이',
  SUMMER: '여름 보양식 시즌',
  VIP_EXCLUSIVE: 'VIP 전용 이벤트',
  PRODUCT_LAUNCH: '신제품 출시',
  SEASONAL: '계절 프로모션',
  CUSTOM: '기타',
} as const;

export type CampaignEventType = keyof typeof CAMPAIGN_EVENT_TYPES;

export const CAMPAIGN_STATUS = {
  DRAFT: '준비중',
  ACTIVE: '진행중',
  SENT: '발송완료',
  COMPLETED: '종료',
  CANCELLED: '취소',
} as const;

export type CampaignStatus = keyof typeof CAMPAIGN_STATUS;

export const CAMPAIGN_STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  SENT: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-slate-100 text-slate-500',
  CANCELLED: 'bg-red-100 text-red-600',
};

export const CAMPAIGN_EVENT_EMOJI: Record<string, string> = {
  SEOLLAL: '\uD83E\uDDE7',
  CHUSEOK: '\uD83C\uDF91',
  PARENTS_DAY: '\uD83D\uDC90',
  TEACHERS_DAY: '\uD83C\uDF93',
  CHRISTMAS: '\uD83C\uDF84',
  NEW_YEAR: '\uD83C\uDF86',
  VALENTINES: '\uD83D\uDC9D',
  SUMMER: '\u2600\uFE0F',
  VIP_EXCLUSIVE: '\uD83D\uDC51',
  PRODUCT_LAUNCH: '\uD83C\uDD95',
  SEASONAL: '\uD83C\uDF42',
  CUSTOM: '\uD83D\uDCE2',
};

export const TARGET_GRADE_OPTIONS = [
  { value: 'ALL', label: '전체 고객' },
  { value: 'NORMAL', label: '일반' },
  { value: 'VIP', label: 'VIP' },
  { value: 'VVIP', label: 'VVIP' },
];

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  // 기간은 옵션(반복 캠페인의 윈도우 표시용으로만 의미있음)
  start_date: string | null;
  end_date: string | null;
  // 예약 발송 시각 (단일 발송 경로). auto_send=true + 상태 ACTIVE + scheduled_at <= now() 이면 스케줄러가 자동 발송
  scheduled_at: string | null;
  is_recurring: boolean;
  recurring_month: number | null;
  recurring_day: number | null;
  recurring_duration_days: number | null;
  recurring_hour: number | null;
  recurring_minute: number | null;
  target_grade: string;
  target_branch_id: string | null;
  solapi_template_id: string | null;
  template_content: string | null;
  template_variables: string[] | null;
  variable_overrides: Record<string, string> | null;
  auto_send: boolean;
  status: string;
  sent_at: string | null;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  target_branch?: { name: string } | null;
}
