-- 089 판매전표 중심 구조개편 Phase 1 — 판매관리(/pos) 허브 권한 확장
-- 배송(/shipping)·보고서 매출(/reports)을 /pos 5탭으로 흡수함에 따라,
-- 기존 /shipping·/reports 를 보던 HQ_OPERATOR(본부운영자)·EXECUTIVE(임원)가
-- 온라인몰관리·매출관리 접근을 잃지 않도록 /pos 권한을 확장한다.
--   - HQ_OPERATOR: 조회+편집
--   - EXECUTIVE  : 조회 전용
-- 기존 역할(SUPER_ADMIN/PHARMACY_STAFF/BRANCH_STAFF)은 upsert 로 보존.
-- /shipping·/reports 권한 행은 직접접근 호환을 위해 그대로 둔다(이 마이그에서 미변경).

INSERT INTO public.screen_permissions (role, screen_path, can_view, can_edit)
VALUES
  ('SUPER_ADMIN',    '/pos', true, true),
  ('HQ_OPERATOR',    '/pos', true, true),
  ('PHARMACY_STAFF', '/pos', true, true),
  ('BRANCH_STAFF',   '/pos', true, true),
  ('EXECUTIVE',      '/pos', true, false)
ON CONFLICT (role, screen_path) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;
