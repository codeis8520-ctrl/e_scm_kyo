SET search_path TO public;

-- production_orders에 branch_id, started_at 추가
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;

-- screen_permissions: 생산 관리 경로 등록
INSERT INTO public.screen_permissions (role, screen_path, screen_name)
VALUES
  ('SUPER_ADMIN',  '/production', '생산관리'),
  ('HQ_OPERATOR',  '/production', '생산관리'),
  ('PHARMACY_STAFF', '/production', '생산관리'),
  ('BRANCH_STAFF', '/production', '생산관리')
ON CONFLICT DO NOTHING;
