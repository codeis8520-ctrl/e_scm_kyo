-- ═══════════════════════════════════════════════════════════════
-- 제품 원가 산정 방식 구분
--   - cost_source = 'MANUAL' : 사용자가 직접 입력 (기본)
--   - cost_source = 'BOM'    : BOM 합계에서 자동 산정 (완제품만)
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'cost_source'
  ) THEN
    ALTER TABLE products
      ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'MANUAL';
    ALTER TABLE products
      ADD CONSTRAINT products_cost_source_chk
      CHECK (cost_source IN ('MANUAL','BOM'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_cost_source ON products(cost_source);

COMMENT ON COLUMN products.cost_source IS
  'MANUAL=수동 입력, BOM=BOM 기반 자동 산정. 완제품만 BOM 선택 가능.';
