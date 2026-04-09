-- ═══════════════════════════════════════════════════════════════════════
-- Solapi 알림톡 템플릿을 이벤트 유형별로 분류하고, 수동 발송 화면에서
-- 노출 여부를 제어하기 위한 매핑 테이블.
--
-- 배경:
--   - /notifications 수동 발송 화면은 Solapi의 모든 템플릿을 그대로 노출하여
--     주문완료/배송/인증번호 등 '이벤트 자동 발송 전용' 템플릿이 수동 발송
--     후보에 섞여 변수 오입력·혼란 발생
--   - 각 Solapi 템플릿(solapi_template_id 문자열: KA01TP...)에 메타데이터를
--     붙여 수동 발송 가능 여부와 용도를 명시적으로 관리
-- ═══════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE TABLE IF NOT EXISTS notification_template_mappings (
  solapi_template_id  varchar(100) PRIMARY KEY,
  -- 이벤트 유형 (MANUAL/WELCOME/ORDER_COMPLETE/SHIPMENT/DELIVERY/
  --             REFUND/AUTH/POINT/BIRTHDAY/DORMANT/OTHER)
  event_type          varchar(30)  NOT NULL DEFAULT 'OTHER',
  -- 수동 발송 화면(/notifications)에서 선택 가능 여부
  is_manual_sendable  boolean      NOT NULL DEFAULT false,
  description         text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ntm_event_type ON notification_template_mappings(event_type);
CREATE INDEX IF NOT EXISTS idx_ntm_manual_sendable ON notification_template_mappings(is_manual_sendable);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ntm_updated_at ON notification_template_mappings;
CREATE TRIGGER trg_ntm_updated_at
BEFORE UPDATE ON notification_template_mappings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE notification_template_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ntm_all ON notification_template_mappings;
CREATE POLICY ntm_all ON notification_template_mappings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 화면 권한
INSERT INTO screen_permissions (role, screen_path, can_view, can_edit) VALUES
  ('SUPER_ADMIN',    '/notifications/templates', true, true),
  ('HQ_OPERATOR',    '/notifications/templates', true, true)
ON CONFLICT DO NOTHING;
