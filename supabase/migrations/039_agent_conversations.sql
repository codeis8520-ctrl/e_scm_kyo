-- =====================================================
-- Migration 039: AI 에이전트 대화 로그 + 메모리 타입 확장
-- =====================================================

CREATE TABLE IF NOT EXISTS agent_conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        TEXT,
  user_id           TEXT,
  user_role         TEXT,
  branch_id         TEXT,
  user_message      TEXT NOT NULL,
  assistant_response TEXT,
  tools_used        JSONB DEFAULT '[]',
  success           BOOLEAN DEFAULT true,
  error_note        TEXT,
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens      INTEGER DEFAULT 0,
  cached_tokens     INTEGER DEFAULT 0,
  model             TEXT,
  rounds            INTEGER DEFAULT 1,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_conv_session ON agent_conversations(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_conv_date ON agent_conversations(created_at DESC);

-- 메모리 타입에 summary 추가
ALTER TABLE agent_memories DROP CONSTRAINT IF EXISTS agent_memories_memory_type_check;
ALTER TABLE agent_memories ADD CONSTRAINT agent_memories_memory_type_check
  CHECK (memory_type IN ('alias', 'pattern', 'error', 'insight', 'summary'));

-- RLS
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_conversations_all ON agent_conversations FOR ALL TO authenticated USING (true);
