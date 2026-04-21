-- ═══════════════════════════════════════════════════════════════
-- 캠페인 예약 발송 확장
--   - scheduled_at: 단일 예약 시각 (날짜+시각 통합)
--   - recurring_hour/recurring_minute: 반복 캠페인 발송 시각
--   - start_date/end_date: nullable 로 완화 (기간은 옵션, 반복 범위 표기용)
--   - 스케줄러 조회 인덱스
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE notification_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

ALTER TABLE notification_campaigns
  ADD COLUMN IF NOT EXISTS recurring_hour int
    CHECK (recurring_hour IS NULL OR (recurring_hour BETWEEN 0 AND 23));

ALTER TABLE notification_campaigns
  ADD COLUMN IF NOT EXISTS recurring_minute int
    CHECK (recurring_minute IS NULL OR (recurring_minute BETWEEN 0 AND 59));

-- 기간은 옵션으로 — scheduled_at 단독 예약도 허용
ALTER TABLE notification_campaigns
  ALTER COLUMN start_date DROP NOT NULL,
  ALTER COLUMN end_date DROP NOT NULL;

-- 스케줄러가 매 10분 조회하는 조건 전용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_nc_scheduler_pending
  ON notification_campaigns(scheduled_at)
  WHERE status='ACTIVE'
    AND auto_send=true
    AND sent_at IS NULL
    AND scheduled_at IS NOT NULL;

COMMENT ON COLUMN notification_campaigns.scheduled_at IS '예약 발송 시각 (auto_send=true · ACTIVE · sent_at IS NULL 이면 이 시각 이후 스케줄러가 자동 발송)';
COMMENT ON COLUMN notification_campaigns.recurring_hour IS '반복 캠페인 발송 시(0~23). recurring_month/day 와 같이 사용';
COMMENT ON COLUMN notification_campaigns.recurring_minute IS '반복 캠페인 발송 분(0~59)';
