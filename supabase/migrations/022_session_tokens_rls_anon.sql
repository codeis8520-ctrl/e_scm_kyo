-- session_tokens + users: anon도 접근 가능하도록 수정
-- 서버 액션은 anon 역할로 Supabase에 접속하므로 TO authenticated 제거
-- getSession()이 session_tokens JOIN users 쿼리를 하므로 둘 다 필요

DROP POLICY IF EXISTS session_tokens_all ON session_tokens;
CREATE POLICY session_tokens_all ON session_tokens FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT USING (true);
