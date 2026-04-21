-- 052: sales_order_items 품목별 배송/수령 추적
-- 수령지는 여전히 주문당 1곳(shipments 1:1 유지). 품목별 현장/택배/퀵 구분만 추가.
-- 같은 전표 내 3품목 중 1품목만 택배 같은 혼합 시나리오 대응.
SET search_path TO public;

-- 품목별 배송 방식
ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(10)
    CHECK (delivery_type IN ('PICKUP', 'PARCEL', 'QUICK'))
    DEFAULT 'PICKUP';
COMMENT ON COLUMN sales_order_items.delivery_type IS
  'PICKUP=현장/방문수령, PARCEL=택배, QUICK=퀵. 한 주문의 shipments는 1건 전제(수령지 1곳)이나 품목별로 배송 여부가 다를 수 있음.';

-- 품목별 수령 현황
ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(20)
    CHECK (receipt_status IN ('RECEIVED', 'PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED'))
    DEFAULT 'RECEIVED';
COMMENT ON COLUMN sales_order_items.receipt_status IS
  '품목별 수령 상태. delivery_type과 쌍으로 움직임(PICKUP→RECEIVED 기본, PARCEL→PARCEL_PLANNED 등). 품목별 완료 처리 가능.';

-- 품목별 수령(예정) 일자
ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS receipt_date DATE;
COMMENT ON COLUMN sales_order_items.receipt_date IS
  '품목별 수령(예정) 일자. 같은 주문이라도 일부는 오늘, 일부는 내일 택배 도착 같은 시나리오 대응.';

-- 미완료 품목 운영 필터 인덱스
CREATE INDEX IF NOT EXISTS idx_sales_order_items_receipt_status
  ON sales_order_items(receipt_status) WHERE receipt_status <> 'RECEIVED';
