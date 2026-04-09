-- 외상 관리 화면 네비게이션 권한
INSERT INTO screen_permissions (role, screen_path, can_view, can_edit) VALUES
  ('SUPER_ADMIN',    '/credit', true, true),
  ('HQ_OPERATOR',    '/credit', true, true),
  ('EXECUTIVE',      '/credit', true, false),
  ('PHARMACY_STAFF', '/credit', true, true),
  ('BRANCH_STAFF',   '/credit', true, true)
ON CONFLICT DO NOTHING;
