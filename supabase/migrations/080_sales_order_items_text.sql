-- ═════════════════════════════════════════════════════════════════════════
-- 080_sales_order_items_text: 미매핑 텍스트 품목 허용 (product_id NULL + item_text)
--
-- 배경:
--   카페24 등 외부 채널 주문 라인은 우리 products 에 매핑되지 않는 품목이
--   존재한다. 기존 sales_order_items.product_id 는 NOT NULL 이라 텍스트 품목을
--   적재할 수 없었다. → product_id NULL 허용 + item_text 컬럼으로 상품명 보존.
--
-- 정책:
--   · product_id 매핑되면 종전대로 FK 로 연결. 매핑 안 된 외부 품목은
--     product_id=NULL + item_text 에 원본 상품명 텍스트 저장.
--   · 멱등: DROP NOT NULL 은 이미 nullable 이어도 PG 에서 에러 없음.
--     item_text 는 IF NOT EXISTS.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- product_id NULL 허용 (미매핑 카페24 텍스트 품목용). PG: 이미 nullable 이어도 무에러.
ALTER TABLE sales_order_items
  ALTER COLUMN product_id DROP NOT NULL;

-- 상품명 텍스트 (우리 products 에 매핑 안 된 외부 채널 품목용)
ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS item_text TEXT;

COMMENT ON COLUMN sales_order_items.product_id IS
  '매핑된 상품 FK. 카페24 등 외부 미매핑 품목은 NULL(이 경우 item_text 사용).';
COMMENT ON COLUMN sales_order_items.item_text IS
  '상품명 텍스트. product_id 가 NULL 인 미매핑(카페24 등) 품목의 원본 상품명.';
