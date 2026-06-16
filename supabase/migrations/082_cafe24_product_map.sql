-- ═════════════════════════════════════════════════════════════════════════
-- 082_cafe24_product_map: 카페24 상품코드+옵션 → ERP products 매핑 테이블
--
-- 배경:
--   카페24 주문 라인은 자사 product_code + option_value 조합으로 식별된다.
--   이를 ERP products(id)로 결정적으로 연결해야 매출·재고 집계가 정확해진다.
--   문자열 매칭(이름/코드 추정)은 옵션 다중·이름 변경에 취약 → 명시적 매핑 테이블.
--
-- 정책:
--   · (cafe24_product_code, option_value) 가 매핑 키. 옵션 없는 단품은 option_value=''.
--     NULL 대신 빈 문자열로 통일 → UNIQUE 가 NULL 을 distinct 취급하는 함정 회피.
--   · product_id → products(id) FK, ON DELETE CASCADE (상품 삭제 시 매핑도 정리).
--   · UNIQUE(cafe24_product_code, option_value) 가 lookup 인덱스 역할도 겸함
--     → 별도 인덱스 불필요.
--   · RLS: Custom Session Auth(anon role) → 064/079 패턴(anon,authenticated FOR ALL).
--     LOAD-BEARING: GRANT 없으면 RLS 정책이 있어도 anon 키 접근 거부 → 기능 무음 실패.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE TABLE IF NOT EXISTS cafe24_product_map (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe24_product_code TEXT NOT NULL,
  option_value        TEXT NOT NULL DEFAULT '',
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (cafe24_product_code, option_value)
);

COMMENT ON TABLE cafe24_product_map IS
  '카페24 상품코드+옵션 → ERP products 매핑. option_value 없는 단품은 빈 문자열.';
COMMENT ON COLUMN cafe24_product_map.option_value IS
  '옵션 값. 단품/무옵션은 빈 문자열 (NULL 금지 — UNIQUE NULL distinct 함정 회피).';

-- (cafe24_product_code, option_value) 조회 인덱스는 위 UNIQUE 제약이 겸함 → 별도 인덱스 불필요.

-- RLS (064/079 패턴)
ALTER TABLE cafe24_product_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cafe24_product_map_all ON cafe24_product_map;
CREATE POLICY cafe24_product_map_all ON cafe24_product_map
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- PostgreSQL 테이블 권한 — Supabase 가 신규 테이블에 자동 grant 안 함.
-- RLS 정책이 있어도 GRANT 가 없으면 anon/authenticated 모두 접근 거부 (079 Must Fix 재발 방지).
GRANT SELECT, INSERT, UPDATE, DELETE ON cafe24_product_map TO anon, authenticated;
