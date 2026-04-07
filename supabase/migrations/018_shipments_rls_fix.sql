-- shipments RLS 수정
-- 이 시스템은 Custom Session Auth (Supabase Auth JWT 미사용).
-- 서버 액션도 anon 키로 연결되므로 TO authenticated 정책은 INSERT를 차단함.
-- → TO authenticated 제거하고 USING (true) WITH CHECK (true) 로 변경.

DROP POLICY IF EXISTS shipments_all ON shipments;
CREATE POLICY shipments_all ON shipments FOR ALL USING (true) WITH CHECK (true);
