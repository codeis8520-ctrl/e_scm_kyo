-- /shipping 경로 권한 추가
INSERT INTO public.screen_permissions (role, screen_path, can_view, can_edit)
VALUES
  ('SUPER_ADMIN',    '/shipping', true, true),
  ('HQ_OPERATOR',    '/shipping', true, true),
  ('PHARMACY_STAFF', '/shipping', true, true),
  ('BRANCH_STAFF',   '/shipping', true, true),
  ('EXECUTIVE',      '/shipping', true, false)
ON CONFLICT (role, screen_path) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit  = EXCLUDED.can_edit;
