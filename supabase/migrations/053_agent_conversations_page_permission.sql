-- AI 대화 기록 화면 권한
-- 각 사용자 본인 대화만 표시하므로 전 역할에 view 허용.
-- RLS(기존 agent_conversations 정책) + 앱 쿼리에서 user_id 필터로 본인만 조회.
INSERT INTO screen_permissions (role, screen_path, can_view, can_edit) VALUES
  ('SUPER_ADMIN',    '/agent-conversations', true, true),
  ('HQ_OPERATOR',    '/agent-conversations', true, true),
  ('EXECUTIVE',      '/agent-conversations', true, false),
  ('PHARMACY_STAFF', '/agent-conversations', true, true),
  ('BRANCH_STAFF',   '/agent-conversations', true, true)
ON CONFLICT DO NOTHING;
