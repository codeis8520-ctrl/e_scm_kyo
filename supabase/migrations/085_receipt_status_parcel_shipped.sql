-- ═════════════════════════════════════════════════════════════════════════
-- 085_receipt_status_parcel_shipped: 수령상태에 '택배발송완료' 추가 (#19)
--
-- 배경:
--   배송목록에서 발송완료(shipments.status=SHIPPED) 처리해도 판매현황 수령상태는
--   'PARCEL_PLANNED(택배예정)'으로 남아 이중 처리가 필요했다. 배송 처리가 판매현황에
--   자동 연동되도록 'PARCEL_SHIPPED(택배발송완료)' 상태를 신설한다.
--
--   자동 연동(updateShipment 서버액션):
--     · shipment SHIPPED  → 연결 sales_order/PARCEL items receipt_status = PARCEL_SHIPPED
--     · shipment DELIVERED → receipt_status = RECEIVED(수령완료) + receipt_date
--   발송 ≠ 수령을 구분(발송완료여도 고객 수령 전일 수 있음).
--
--   051/052에서 inline CHECK로 추가된 제약(자동명 {table}_receipt_status_check)을
--   교체한다. CHECK 집합에 PARCEL_SHIPPED만 추가, 나머지 값 동일.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- sales_orders.receipt_status
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_receipt_status_check;
ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_receipt_status_check
  CHECK (receipt_status IN ('RECEIVED', 'PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED', 'PARCEL_SHIPPED'));

COMMENT ON COLUMN sales_orders.receipt_status IS
  'RECEIVED=수령완료, PICKUP_PLANNED=방문예정, QUICK_PLANNED=퀵예정, PARCEL_PLANNED=택배예정, PARCEL_SHIPPED=택배발송완료(배송 SHIPPED 자동연동)';

-- sales_order_items.receipt_status
ALTER TABLE sales_order_items DROP CONSTRAINT IF EXISTS sales_order_items_receipt_status_check;
ALTER TABLE sales_order_items
  ADD CONSTRAINT sales_order_items_receipt_status_check
  CHECK (receipt_status IN ('RECEIVED', 'PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED', 'PARCEL_SHIPPED'));

COMMENT ON COLUMN sales_order_items.receipt_status IS
  '품목별 수령 상태. PARCEL_SHIPPED=택배발송완료(배송 SHIPPED 자동연동). delivery_type과 쌍으로 움직임.';
