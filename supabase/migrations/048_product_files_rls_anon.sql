-- =====================================================
-- Migration 048: product_files · oem_factories RLS — anon 접근 허용
-- =====================================================
-- 배경: 이 시스템은 Custom Session Auth + NEXT_PUBLIC_SUPABASE_ANON_KEY 사용.
-- migration 015(product_files), 047(oem_factories)에서 `TO authenticated`로
-- 제한을 건 탓에 서버 액션(anon role) INSERT 시 RLS 거부.
-- migration 010과 동일한 USING (true) / WITH CHECK (true) 로 복구.

-- product_files (migration 015)
DROP POLICY IF EXISTS product_files_select ON product_files;
DROP POLICY IF EXISTS product_files_all ON product_files;
CREATE POLICY product_files_all ON product_files
  FOR ALL USING (true) WITH CHECK (true);

-- oem_factories (migration 047)
DROP POLICY IF EXISTS oem_factories_all ON oem_factories;
CREATE POLICY oem_factories_all ON oem_factories
  FOR ALL USING (true) WITH CHECK (true);
