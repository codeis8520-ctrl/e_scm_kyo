-- =====================================================
-- Migration 048: product_files RLS — anon 접근 허용
-- =====================================================
-- 배경: 이 시스템은 Custom Session Auth + NEXT_PUBLIC_SUPABASE_ANON_KEY 사용.
-- migration 015에서 product_files 정책을 `TO authenticated`로 설정한 탓에
-- 서버 액션(anon role)이 INSERT 시 "row-level security policy" 에러 발생.
-- migration 010과 동일하게 USING (true) / WITH CHECK (true) 로 복구.

DROP POLICY IF EXISTS product_files_select ON product_files;
DROP POLICY IF EXISTS product_files_all ON product_files;

CREATE POLICY product_files_all ON product_files
  FOR ALL USING (true) WITH CHECK (true);
