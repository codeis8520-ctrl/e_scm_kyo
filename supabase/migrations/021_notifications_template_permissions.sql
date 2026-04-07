-- /notifications 및 /notifications/templates screen_permissions 등록
-- 기존에 /notifications가 없는 경우를 대비해 upsert

INSERT INTO screen_permissions (role, screen_path, can_view, can_edit) VALUES
  ('SUPER_ADMIN',    '/notifications',           true, true),
  ('HQ_OPERATOR',    '/notifications',           true, true),
  ('BRANCH_STAFF',   '/notifications',           true, false),
  ('SUPER_ADMIN',    '/notifications/templates', true, true),
  ('HQ_OPERATOR',    '/notifications/templates', true, true)
ON CONFLICT (role, screen_path) DO NOTHING;
