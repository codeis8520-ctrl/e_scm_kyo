-- ═════════════════════════════════════════════════════════════════════════
-- 068_branch_point_rates_rls
--
-- 067 에서 branch_point_rates 테이블 생성 시 RLS 정책을 누락 →
-- Supabase 기본 RLS 가 켜진 상태에서 anon role 로 들어오는 서버 액션이
-- INSERT/UPDATE/DELETE 시 모두 차단됨.
--
-- 본 시스템은 Custom Session Auth(Supabase Auth JWT 미사용)이므로
-- 서버/클라이언트 모두 ANON role 로 접속함 → anon 도 허용 필요.
-- 정책 패턴은 064_legacy_purchases 와 동일.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE branch_point_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branch_point_rates_all ON branch_point_rates;
CREATE POLICY branch_point_rates_all ON branch_point_rates
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
