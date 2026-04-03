-- =====================================================
-- Migration 008: AI 에이전트 메모리 시스템
-- =====================================================
-- 에이전트가 업무를 처리하면서 축적하는 지식 저장소
-- memory_type: alias(이름→ID 매핑), pattern(반복 패턴), error(오류 패턴), insight(업무 통찰)

CREATE TABLE IF NOT EXISTS agent_memories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_type    TEXT NOT NULL CHECK (memory_type IN ('alias', 'pattern', 'error', 'insight')),
  category       TEXT NOT NULL,   -- customer | branch | inventory | order | production | general
  source_key     TEXT NOT NULL,   -- 중복 방지용 stable key (upsert 기준)
  content        TEXT NOT NULL,   -- 실제 기억 내용 (시스템 프롬프트에 주입)
  source_query   TEXT,            -- 이 기억을 생성한 원래 쿼리
  usage_count    INTEGER NOT NULL DEFAULT 1,
  last_used_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active      BOOLEAN NOT NULL DEFAULT true,

  UNIQUE (source_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_active_usage
  ON agent_memories (is_active, usage_count DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memories_category
  ON agent_memories (category, memory_type);

COMMENT ON TABLE agent_memories IS
  'AI 에이전트가 업무 처리 중 축적한 지식. 자주 쓰일수록 usage_count 증가. 시스템 프롬프트에 자동 주입됨.';
