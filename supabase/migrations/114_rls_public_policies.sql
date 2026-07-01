-- ═════════════════════════════════════════════════════════════════════════
-- 114_rls_public_policies → anon(public) RLS 정책 누락 보정 (#103)
--
-- 배경: 앱은 커스텀 세션 인증(Supabase Auth 아님) → anon 키로 접속. 대부분 테이블은
--   'Allow all ... FOR ALL USING(true) WITH CHECK(true)'(TO public) 정책으로 앱레벨 RBAC.
--   그런데 아래 3개는 정책이 {authenticated}에만 걸려 있어 anon 접속 시 RLS 위반:
--     "new row violates row-level security policy for table ...".
--   → 품목 추가 시 sales_order_payments INSERT 실패(결제 차액 기록). audit_logs·
--     supplier_product_prices도 동일 위험. public 정책 추가로 097 패턴에 정합화.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- sales_order_payments — 품목 추가/수정 시 결제 차액 기록(#103 보고 버그)
DROP POLICY IF EXISTS "Allow all for sales_order_payments" ON sales_order_payments;
CREATE POLICY "Allow all for sales_order_payments" ON sales_order_payments FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON sales_order_payments TO anon, authenticated;

-- audit_logs — 수정 이력(현재 best-effort로 조용히 실패 중)
DROP POLICY IF EXISTS "Allow all for audit_logs" ON audit_logs;
CREATE POLICY "Allow all for audit_logs" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON audit_logs TO anon, authenticated;

-- supplier_product_prices — 매입 단가 관리
DROP POLICY IF EXISTS "Allow all for supplier_product_prices" ON supplier_product_prices;
CREATE POLICY "Allow all for supplier_product_prices" ON supplier_product_prices FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON supplier_product_prices TO anon, authenticated;
