-- 017_cafe24_tokens_rls.sql
-- cafe24_tokens는 서버-to-서버 내부 설정값이므로 anon(서버키) 접근 허용

CREATE POLICY cafe24_tokens_anon ON cafe24_tokens
  FOR ALL TO anon USING (true) WITH CHECK (true);
