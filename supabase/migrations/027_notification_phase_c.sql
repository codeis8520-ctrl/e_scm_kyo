-- ═══════════════════════════════════════════════════════════════════════
-- Phase C: 자동/수동 구분 + 변수 기본값 + 스케줄 배치 지원
-- ═══════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- 1) notifications.trigger_source — 발송 출처 추적 (수동/자동/배치)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS trigger_source varchar(20) NOT NULL DEFAULT 'MANUAL';
-- 값: MANUAL | AUTO_EVENT | SCHEDULED

CREATE INDEX IF NOT EXISTS idx_notif_trigger_source ON notifications(trigger_source);

COMMENT ON COLUMN notifications.trigger_source IS
  'MANUAL: 수동 발송 / AUTO_EVENT: 이벤트 자동 발송 / SCHEDULED: 배치 자동 발송';

-- 2) notification_template_mappings.variable_defaults — 변수 fallback 값
ALTER TABLE notification_template_mappings
  ADD COLUMN IF NOT EXISTS variable_defaults jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN notification_template_mappings.variable_defaults IS
  '변수별 기본값. 예: {"#{상품명}": "경옥고", "#{결제금액}": "주문확인"}';

-- 3) 스케줄 배치 실행 로그
CREATE TABLE IF NOT EXISTS notification_batch_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_type varchar(30) NOT NULL,  -- BIRTHDAY | DORMANT | ...
  target_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  detail jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_nbl_type_time ON notification_batch_logs(batch_type, started_at DESC);

ALTER TABLE notification_batch_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nbl_all ON notification_batch_logs;
CREATE POLICY nbl_all ON notification_batch_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4) customers.birthday (생일 축하 배치용)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS birthday date;

COMMENT ON COLUMN customers.birthday IS '생일 (연도 무관 MM-DD 매칭용)';
