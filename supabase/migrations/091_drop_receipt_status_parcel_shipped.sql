-- ═════════════════════════════════════════════════════════════════════════
-- 091_drop_receipt_status_parcel_shipped: 수령상태 PARCEL_SHIPPED 제거 (#43)
--
-- 배경:
--   #19/#85에서 배송 SHIPPED→판매현황 자동연동용으로 'PARCEL_SHIPPED(택배발송완료)'
--   수령상태를 신설했으나, 스펙 §2(판매현황=수령+결제 2축, 발송 디테일은 택배관리
--   shipment.status만 담당)와 충돌. 발송 사실은 shipments.status=SHIPPED + 📦 아이콘으로
--   충분히 표현되므로 RECEIPT 단계의 PARCEL_SHIPPED 값을 제거하고 PARCEL_PLANNED로 통일.
--   (발송됐어도 고객 미수령이면 = 택배예정. 최종 수령상태는 RECEIVED만.)
--
--   ⚠️ 이번 변경은 RECEIPT status(sales_orders/items.receipt_status)만 대상.
--      택배관리 2버킷(shipments.status PENDING/PRINTED/SHIPPED/DELIVERED)은 무손상.
--
-- 작업:
--   1) 기존 데이터 PARCEL_SHIPPED → PARCEL_PLANNED (sales_orders·sales_order_items)
--   2) CHECK 제약에서 PARCEL_SHIPPED 제거(085 패턴 교체)
--   3) COMMENT 갱신
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- 1) 데이터 이전: 발송됐지만 미수령 = 택배예정
UPDATE sales_order_items
  SET receipt_status = 'PARCEL_PLANNED'
  WHERE receipt_status = 'PARCEL_SHIPPED';

UPDATE sales_orders
  SET receipt_status = 'PARCEL_PLANNED'
  WHERE receipt_status = 'PARCEL_SHIPPED';

-- 2) CHECK 제약 교체 — PARCEL_SHIPPED 제거
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_receipt_status_check;
ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_receipt_status_check
  CHECK (receipt_status IN ('RECEIVED', 'PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED'));

ALTER TABLE sales_order_items DROP CONSTRAINT IF EXISTS sales_order_items_receipt_status_check;
ALTER TABLE sales_order_items
  ADD CONSTRAINT sales_order_items_receipt_status_check
  CHECK (receipt_status IN ('RECEIVED', 'PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED'));

-- 3) COMMENT 갱신
COMMENT ON COLUMN sales_orders.receipt_status IS
  'RECEIVED=수령완료, PICKUP_PLANNED=방문예정, QUICK_PLANNED=퀵예정, PARCEL_PLANNED=택배예정. 발송 사실은 shipments.status=SHIPPED + 판매현황 📦 아이콘으로 표현(#43).';

COMMENT ON COLUMN sales_order_items.receipt_status IS
  '품목별 수령 상태(RECEIVED/PICKUP_PLANNED/QUICK_PLANNED/PARCEL_PLANNED). delivery_type과 쌍으로 움직임. 발송완료는 RECEIPT 아닌 shipment.status로만 추적(#43).';
