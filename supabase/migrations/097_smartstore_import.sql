-- ═════════════════════════════════════════════════════════════════════════
-- 097: 네이버 스마트스토어 주문 엑셀 임포트 토대
--
--  - 채널 'SMARTSTORE'(스마트스토어) 추가. sales_orders.channel 은 마이그093에서
--    channels(id) FK 가 됐으므로, 새 채널값을 쓰려면 channels 행이 먼저 있어야 함.
--  - smartstore_product_map: (상품번호, 옵션) → 내부 product_id. 카페24 product_map 과
--    동일 메커니즘(상품명+옵션 문자열을 내부 제품/팬텀으로 변환).
--  - sales_orders.smartstore_order_id(주문번호): 재업로드 중복방지(부분 unique).
--  - sales_order_items.smartstore_product_order_no(상품주문번호): 품목 멱등/감사.
--  멱등: IF NOT EXISTS / ON CONFLICT.
-- ═════════════════════════════════════════════════════════════════════════

-- 1) 채널
INSERT INTO channels (id, name, color, sort_order, is_active)
VALUES ('SMARTSTORE', '스마트스토어', '#22c55e', 6, true)
ON CONFLICT (id) DO NOTHING;

-- 2) 상품 매핑 테이블 (cafe24_product_map 대응)
CREATE TABLE IF NOT EXISTS smartstore_product_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  smartstore_product_no TEXT NOT NULL,           -- 네이버 상품번호(안정 키)
  option_value TEXT NOT NULL DEFAULT '',         -- 옵션정보(단일상품은 '')
  product_id UUID NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT,                    -- 매핑 당시 상품명(참고용)
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (smartstore_product_no, option_value)
);

-- 3) 주문/품목 dedup 컬럼
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS smartstore_order_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_smartstore_order
  ON sales_orders(smartstore_order_id) WHERE smartstore_order_id IS NOT NULL;

ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS smartstore_product_order_no TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_order_items_ss_pon
  ON sales_order_items(smartstore_product_order_no) WHERE smartstore_product_order_no IS NOT NULL;

-- 4) RLS: 신규 테이블 (cafe24_product_map 패턴 — authenticated 전체 허용 + 익명 select 가능하게)
ALTER TABLE smartstore_product_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS smartstore_product_map_all ON smartstore_product_map;
CREATE POLICY smartstore_product_map_all ON smartstore_product_map FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON smartstore_product_map TO anon, authenticated;
