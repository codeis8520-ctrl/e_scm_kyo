-- session_tokens: anon도 접근 가능하도록 수정
-- 서버 액션은 anon 역할로 Supabase에 접속하므로 TO authenticated 제거
DROP POLICY IF EXISTS session_tokens_all ON session_tokens;
CREATE POLICY session_tokens_all ON session_tokens FOR ALL USING (true) WITH CHECK (true);
