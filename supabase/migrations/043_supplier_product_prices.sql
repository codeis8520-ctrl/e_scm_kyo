-- ═══════════════════════════════════════════════════════════════
-- Phase 2: 공급사별 제품 매입 단가 히스토리
--   - 발주 확정(CONFIRMED) 시점 단가를 이력으로 기록
--   - 입고(RECEIVED) 시 단가가 변경됐으면 추가 기록
--   - 수동 단가 등록도 지원
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE TABLE IF NOT EXISTS supplier_product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  product_id UUID NOT NULL REFERENCES products(id),
  unit_price NUMERIC(12,0) NOT NULL CHECK (unit_price >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('MANUAL', 'PO_CONFIRMED', 'PO_RECEIVED')),
  source_po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  memo TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 같은 공급사-제품-날짜 중복은 UPSERT로 방지 (최종 단가만 유지)
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_product_prices_day
  ON supplier_product_prices(supplier_id, product_id, effective_from);

-- 최근 단가 빠른 조회
CREATE INDEX IF NOT EXISTS idx_supplier_product_prices_lookup
  ON supplier_product_prices(supplier_id, product_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_product_prices_product
  ON supplier_product_prices(product_id, effective_from DESC);

-- RLS
ALTER TABLE supplier_product_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_product_prices_all ON supplier_product_prices;
CREATE POLICY supplier_product_prices_all
  ON supplier_product_prices FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE supplier_product_prices IS
  '공급사별 제품 매입 단가 히스토리. 발주 CONFIRMED/RECEIVED 시 자동 기록 + 수동 기록 가능.';
COMMENT ON COLUMN supplier_product_prices.source IS
  'MANUAL=수동, PO_CONFIRMED=발주확정시 자동, PO_RECEIVED=입고시 단가변경 자동';
