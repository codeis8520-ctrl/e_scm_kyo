-- ═══════════════════════════════════════════════════════════════════════════
-- 075_sales_orders_cafe24_order_id_unique
--
-- sales_orders.cafe24_order_id 에 부분 UNIQUE 인덱스 추가.
-- 자사몰 주문 1건 = sales_orders 1행 보장 → 카페24 동기화 중복 insert 방지 +
-- 주문자 수동 고객등록(registerCafe24Customers)의 customer_id 연결이
-- 항상 단일 행만 갱신하도록 DB 레벨 보장.
--
-- 적용 전 중복 없음 확인됨(2026-06). NULL 은 다수 허용(WHERE 절).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_cafe24_order_id
  ON sales_orders (cafe24_order_id)
  WHERE cafe24_order_id IS NOT NULL;
