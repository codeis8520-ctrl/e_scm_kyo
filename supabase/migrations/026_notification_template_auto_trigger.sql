-- ═══════════════════════════════════════════════════════════════════════
-- Phase B: 이벤트 자동 발송 지원
--
-- notification_template_mappings에 자동 발송 on/off 스위치와
-- 템플릿 내용 캐시(content·variables)를 추가하여, 이벤트 발생 시점에
-- Solapi API를 다시 호출하지 않고도 즉시 알림톡 발송이 가능하도록 함.
-- ═══════════════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE notification_template_mappings
  ADD COLUMN IF NOT EXISTS auto_trigger_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_content     text,
  ADD COLUMN IF NOT EXISTS template_variables   jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ntm_auto_trigger ON notification_template_mappings(auto_trigger_enabled);

COMMENT ON COLUMN notification_template_mappings.auto_trigger_enabled IS
  'true면 해당 event_type의 업무 이벤트 발생 시 자동으로 알림톡 발송';
COMMENT ON COLUMN notification_template_mappings.template_content IS
  'Solapi 템플릿의 content(변수 치환 전 원문). 자동 발송 시 사용.';
COMMENT ON COLUMN notification_template_mappings.template_variables IS
  'Solapi 템플릿의 변수 키 목록 (예: ["#{고객명}","#{주문번호}"])';
