-- notification_templates에 solapi_template_id 추가
-- Solapi 알림톡 발송 시 필요한 실제 템플릿 ID (KA01TP...)

ALTER TABLE public.notification_templates
  ADD COLUMN IF NOT EXISTS solapi_template_id VARCHAR(100);

-- RLS: TO authenticated → anon 허용 (커스텀 세션 인증 시스템)
DROP POLICY IF EXISTS notification_templates_all ON notification_templates;
CREATE POLICY notification_templates_all ON notification_templates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS notifications_all ON notifications;
CREATE POLICY notifications_all ON notifications FOR ALL USING (true) WITH CHECK (true);
