-- ═══════════════════════════════════════════════════════════════
-- Phase 1: BOM 강화 + 제품 타입 구분
--   - products.product_type (완제품/원자재/부자재)
--   - product_bom.loss_rate / notes / sort_order
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- 1) 제품 타입 (FINISHED=완제품, RAW=원자재, SUB=부자재)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'product_type'
  ) THEN
    ALTER TABLE products
      ADD COLUMN product_type TEXT NOT NULL DEFAULT 'FINISHED';
    ALTER TABLE products
      ADD CONSTRAINT products_product_type_chk
      CHECK (product_type IN ('FINISHED','RAW','SUB'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type);

COMMENT ON COLUMN products.product_type IS
  'FINISHED=완제품, RAW=원자재, SUB=부자재. BOM 조립/필터링의 기준.';

-- 2) BOM 행 필드 보강
ALTER TABLE product_bom
  ADD COLUMN IF NOT EXISTS loss_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_bom_loss_rate_chk'
  ) THEN
    ALTER TABLE product_bom
      ADD CONSTRAINT product_bom_loss_rate_chk
      CHECK (loss_rate >= 0 AND loss_rate <= 100);
  END IF;
END $$;

COMMENT ON COLUMN product_bom.loss_rate IS
  '공정 손실률(%). 실제 소요량 = quantity × (1 + loss_rate/100)';
COMMENT ON COLUMN product_bom.notes IS '규격·비고 (예: 200mg 캡슐용, 1차 혼합 후 투입)';
COMMENT ON COLUMN product_bom.sort_order IS 'BOM 편집 화면에서의 정렬 순서';

CREATE INDEX IF NOT EXISTS idx_product_bom_product
  ON product_bom(product_id, sort_order);
