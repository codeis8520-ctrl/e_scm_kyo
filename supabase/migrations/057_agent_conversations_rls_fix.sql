-- =====================================================
-- Migration 057: agent_conversations RLS 수정
-- =====================================================
-- 증상: AI 대화 기록이 저장되지 않음 (테이블에 INSERT 안 됨)
-- 원인: 039_agent_conversations.sql의 정책이 두 가지 결함을 가짐
--   1) WITH CHECK 절 누락 → INSERT 자체를 허용하지 않음
--   2) TO authenticated 로 제한 → 본 시스템은 Custom Session Auth(anon key)를
--      쓰므로 Supabase 기준에는 anon 역할로 보여 정책 매칭 실패
--
-- 해결: 동일 패턴의 다른 RLS 수정 마이그레이션(049 등)과 일치하게
--      USING (true) WITH CHECK (true) 로 단순 허용 정책으로 교체.

DROP POLICY IF EXISTS agent_conversations_all ON agent_conversations;
CREATE POLICY agent_conversations_all ON agent_conversations
  FOR ALL USING (true) WITH CHECK (true);
