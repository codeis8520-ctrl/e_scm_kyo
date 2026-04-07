-- shipments INSERT RLS 수정: WITH CHECK 추가
DROP POLICY IF EXISTS shipments_all ON shipments;
CREATE POLICY shipments_all ON shipments FOR ALL TO authenticated USING (true) WITH CHECK (true);
