-- ═════════════════════════════════════════════════════════════════════════
-- 079_inventory_usage_types: 재고 "사용유형" 코드 테이블 + movements 연결
--
-- 배경:
--   판매가 아닌 재고 소모(로스/자가사용/시음용 등)를 사용유형으로 구분해
--   OUT 차감한다. reference_type(VARCHAR free-form)만으로는 보고/필터가
--   불안정 → 관리형 코드 테이블 + FK 컬럼으로 구조화한다.
--
-- 정책:
--   · inventory_usage_types = 관리형 코드(추가/수정/비활성). is_system=true 는
--     삭제 금지(비활성만 허용) — '기타' 같은 폴백 보존용.
--   · inventory_movements.usage_type_id 추가(NULL 허용). 소모 기록만 값을 가짐.
--     판매/이동/조정/생산 등 기존 movement 은 NULL.
--   · 소모는 movement_type='OUT', reference_type='USAGE' 로 기록하고
--     usage_type_id 로 어떤 유형인지 식별 → reference_type+usage_type_id 이중표식.
--   · RLS: Custom Session Auth(anon role) → 064 패턴(anon,authenticated FOR ALL).
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE TABLE IF NOT EXISTS inventory_usage_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(30) NOT NULL UNIQUE,
  name        VARCHAR(50) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_usage_types_active
  ON inventory_usage_types (sort_order) WHERE is_active = TRUE;

COMMENT ON TABLE inventory_usage_types IS
  '재고 소모 사용유형 코드(로스/자가사용/시음용 등). 판매 아님. is_system=삭제금지.';
COMMENT ON COLUMN inventory_usage_types.is_system IS
  'true 면 삭제 불가(비활성만). 기타 등 폴백 유형 보존.';

-- movements 연결 컬럼
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS usage_type_id UUID REFERENCES inventory_usage_types(id);

COMMENT ON COLUMN inventory_movements.usage_type_id IS
  '재고 소모(reference_type=USAGE) 시 사용유형. 그 외 movement 은 NULL.';

CREATE INDEX IF NOT EXISTS idx_inventory_movements_usage_type
  ON inventory_movements (usage_type_id) WHERE usage_type_id IS NOT NULL;

-- 초기 시드 (멱등)
INSERT INTO inventory_usage_types (code, name, sort_order, is_system) VALUES
  ('LOSS',      '로스',     10, FALSE),
  ('SELF_USE',  '자가사용', 20, FALSE),
  ('SAMPLE',    '시음용',   30, FALSE),
  ('ETC',       '기타',     90, TRUE)
ON CONFLICT (code) DO NOTHING;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_inventory_usage_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_usage_types_updated_at ON inventory_usage_types;
CREATE TRIGGER trg_inventory_usage_types_updated_at
  BEFORE UPDATE ON inventory_usage_types
  FOR EACH ROW EXECUTE FUNCTION update_inventory_usage_types_updated_at();

-- RLS (064 패턴)
ALTER TABLE inventory_usage_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_usage_types_all ON inventory_usage_types;
CREATE POLICY inventory_usage_types_all ON inventory_usage_types
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- PostgreSQL 테이블 권한 — Supabase 가 신규 테이블에 자동 grant 안 함.
-- RLS 정책이 있어도 GRANT 가 없으면 anon/authenticated 모두 접근 거부.
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_usage_types TO anon, authenticated;
