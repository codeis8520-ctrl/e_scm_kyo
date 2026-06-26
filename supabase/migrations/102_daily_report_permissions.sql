-- 102 판매일보(/daily-report) 화면 권한 시드
-- 백화점 매장 판매사원이 휴대폰으로 일보를 입력하는 화면.
-- nav 는 screen_permissions(role, screen_path) 정확매칭 필터를 타므로,
-- 권한 시드가 없으면 모든 역할에서 '판매일보' 탭이 안 보인다.
--   - SUPER_ADMIN/HQ_OPERATOR/PHARMACY_STAFF/BRANCH_STAFF: 조회+편집(입력 주체)
--   - EXECUTIVE: 조회 전용
-- 멱등(재실행 안전): ON CONFLICT 으로 보존/갱신.

INSERT INTO public.screen_permissions (role, screen_path, can_view, can_edit)
VALUES
  ('SUPER_ADMIN',    '/daily-report', true, true),
  ('HQ_OPERATOR',    '/daily-report', true, true),
  ('PHARMACY_STAFF', '/daily-report', true, true),
  ('BRANCH_STAFF',   '/daily-report', true, true),
  ('EXECUTIVE',      '/daily-report', true, false)
ON CONFLICT (role, screen_path) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;
