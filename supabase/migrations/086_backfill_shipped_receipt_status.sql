-- ═════════════════════════════════════════════════════════════════════════
-- 086_backfill_shipped_receipt_status: 기존 발송완료 누적 불일치 보정 (#19)
--
-- 085 이전에 배송목록에서 발송완료/배송완료 처리됐지만 판매현황 수령상태가
-- 'PARCEL_PLANNED(택배예정)'으로 멈춰 있던 건을 일괄 정리한다.
--   · shipment SHIPPED  → 택배예정 품목/주문 = PARCEL_SHIPPED(택배발송완료)
--   · shipment DELIVERED → 택배 품목 = RECEIVED + receipt_date(배송일=shipments.updated_at KST)
-- 멱등: 가드(receipt_status 조건)로 이미 보정된 건은 재실행해도 무변경.
-- 취소/환불 주문 제외. 방문/퀵/이미수령 품목 무손상.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- ── (1) SHIPPED → 택배발송완료 ────────────────────────────────────────────
WITH shipped_orders AS (
  SELECT DISTINCT so.id
  FROM sales_orders so
  JOIN shipments sh ON sh.sales_order_id = so.id
  WHERE sh.status = 'SHIPPED'
    AND so.receipt_status = 'PARCEL_PLANNED'
    AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
)
UPDATE sales_order_items i
  SET receipt_status = 'PARCEL_SHIPPED'
  FROM shipped_orders s
  WHERE i.sales_order_id = s.id
    AND i.receipt_status = 'PARCEL_PLANNED';

UPDATE sales_orders so
  SET receipt_status = 'PARCEL_SHIPPED'
  WHERE so.receipt_status = 'PARCEL_PLANNED'
    AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    AND EXISTS (
      SELECT 1 FROM shipments sh
      WHERE sh.sales_order_id = so.id AND sh.status = 'SHIPPED'
    );

-- ── (2) DELIVERED → 수령완료 ──────────────────────────────────────────────
-- 택배 품목을 RECEIVED + 배송일(shipments.updated_at의 KST 일자)로.
UPDATE sales_order_items i
  SET receipt_status = 'RECEIVED',
      receipt_date = COALESCE(
        (SELECT (sh.updated_at AT TIME ZONE 'Asia/Seoul')::date
         FROM shipments sh
         WHERE sh.sales_order_id = i.sales_order_id AND sh.status = 'DELIVERED'
         ORDER BY sh.updated_at DESC LIMIT 1),
        i.receipt_date
      )
  WHERE i.receipt_status IN ('PARCEL_PLANNED', 'PARCEL_SHIPPED')
    AND EXISTS (
      SELECT 1 FROM shipments sh JOIN sales_orders so ON so.id = sh.sales_order_id
      WHERE sh.sales_order_id = i.sales_order_id AND sh.status = 'DELIVERED'
        AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    );

-- 전 품목 RECEIVED인 주문만 주문레벨도 RECEIVED + receipt_date.
UPDATE sales_orders so
  SET receipt_status = 'RECEIVED',
      receipt_date = COALESCE(so.receipt_date, (
        SELECT (sh.updated_at AT TIME ZONE 'Asia/Seoul')::date
        FROM shipments sh
        WHERE sh.sales_order_id = so.id AND sh.status = 'DELIVERED'
        ORDER BY sh.updated_at DESC LIMIT 1
      ))
  WHERE so.receipt_status IN ('PARCEL_PLANNED', 'PARCEL_SHIPPED')
    AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    AND EXISTS (
      SELECT 1 FROM shipments sh
      WHERE sh.sales_order_id = so.id AND sh.status = 'DELIVERED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM sales_order_items i
      WHERE i.sales_order_id = so.id
        AND i.receipt_status IS NOT NULL
        AND i.receipt_status <> 'RECEIVED'
    );
