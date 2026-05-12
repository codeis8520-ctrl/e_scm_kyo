-- ═════════════════════════════════════════════════════════════════════════
-- 064_legacy_purchases: 외부 엑셀에서 임포트되는 과거 구매내역 보존 테이블
--
-- 정책:
--   · sales_orders 와 분리 — 매출/재고/회계 영향 0.
--   · 품목은 원본 텍스트 그대로 보존(자동 매핑 안 함). 사람이 시간 두고
--     legacy_item_aliases 사전 만들면서 mapped_to_sales_order_id 채워 승격.
--   · 고객 상세 페이지의 "과거 구매" 탭에서 조회.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE legacy_purchases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_purchase_no       VARCHAR(20),                                    -- 원본 ID (예: P000001)
  customer_id              UUID REFERENCES customers(id) ON DELETE SET NULL,
  phone                    VARCHAR(20),                                    -- 정규화된 phone (검색/JOIN 용)
  ordered_at               DATE NOT NULL,
  channel_text             VARCHAR(50),                                    -- 매출처(자사몰/청담점/신세계몰 등 원본)
  branch_id                UUID REFERENCES branches(id),                   -- 매핑된 출고 지점
  branch_code_raw          VARCHAR(80),                                    -- 출고처 원본 텍스트(예: A1(본사))
  item_text                TEXT NOT NULL,                                  -- 품목 원본 (매핑 안 함)
  quantity                 NUMERIC(10,2),
  total_amount             NUMERIC(14,0),
  payment_status           VARCHAR(30),                                    -- 결제 완료 / 미결 / 미승인(카드) / null
  source_file              VARCHAR(20),                                    -- 2024~2026 등 연도구간
  mapped_to_sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  metadata                 JSONB DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  legacy_purchases IS '엑셀 임포트로 보존하는 과거 구매 이력. sales_orders 와 분리.';
COMMENT ON COLUMN legacy_purchases.item_text IS '품목 원본 텍스트(예: "십전10선*2,쌍화10선"). 자동 매핑 안 함.';
COMMENT ON COLUMN legacy_purchases.mapped_to_sales_order_id IS '향후 사람이 매핑 검수해 sales_orders 로 승격한 경우 그 ID. NULL이면 legacy 전용.';

CREATE INDEX idx_lp_customer    ON legacy_purchases(customer_id);
CREATE INDEX idx_lp_phone       ON legacy_purchases(phone);
CREATE INDEX idx_lp_ordered_at  ON legacy_purchases(ordered_at DESC);
CREATE INDEX idx_lp_branch      ON legacy_purchases(branch_id);
CREATE INDEX idx_lp_mapped      ON legacy_purchases(mapped_to_sales_order_id) WHERE mapped_to_sales_order_id IS NOT NULL;

ALTER TABLE legacy_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legacy_purchases_all ON legacy_purchases;
CREATE POLICY legacy_purchases_all ON legacy_purchases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
