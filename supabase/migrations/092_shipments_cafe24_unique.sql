-- ═════════════════════════════════════════════════════════════════════════
-- 092_shipments_cafe24_unique: 카페24 주문 배송 중복 방지 (#44)
--
-- 배경:
--   sales_orders.cafe24_order_id 는 부분 UNIQUE(uq_sales_orders_cafe24_order_id)로
--   전표 중복이 막혀 있으나, shipments.cafe24_order_id 는 비고유 INDEX 뿐이라
--   같은 카페24 주문에 배송이 2건 생성될 수 있었다(배송추가 더블클릭/stale 상태).
--   → 배송목록 중복 노출 위험. (재고/매출은 sales_order 단일이라 영향 없음.)
--
-- 작업:
--   1) 기존 중복 정리 — cafe24_order_id 당 1건만 보존(진행상태/송장/최신 우선), 나머지 삭제.
--   2) shipments.cafe24_order_id 부분 UNIQUE 추가(WHERE NOT NULL) — DB 레벨 중복 차단.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- 1) 중복 정리: cafe24_order_id 당 "가장 진행된" 배송 1건만 남기고 삭제.
--    우선순위: 상태(DELIVERED>SHIPPED>PRINTED>PENDING) → 송장有 → 최신 created_at.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY cafe24_order_id
      ORDER BY
        CASE status WHEN 'DELIVERED' THEN 4 WHEN 'SHIPPED' THEN 3 WHEN 'PRINTED' THEN 2 ELSE 1 END DESC,
        (tracking_number IS NOT NULL) DESC,
        created_at DESC
    ) AS rn
  FROM shipments
  WHERE cafe24_order_id IS NOT NULL
)
DELETE FROM shipments WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) 부분 UNIQUE 추가 — 같은 카페24 주문에 배송 1건만 허용.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_cafe24_order_id
  ON shipments(cafe24_order_id)
  WHERE cafe24_order_id IS NOT NULL;
