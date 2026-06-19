-- ═════════════════════════════════════════════════════════════════════════
-- 094_shipments_sales_order_unique: 전표당 배송 1건 강제 (#48 Phase 2a)
--
-- 배경:
--   1전표=1발송지(분할배송 불가) 정합(#48). shipments.sales_order_id 는
--   비고유 FK 라 한 전표에 배송이 2건 생길 수 있었다(직접배송입력 더블클릭/stale).
--   → 단일원장 1:1 위반. backfill 로 과거 NULL링크를 정확매칭 연결한 뒤
--     sales_order_id 부분 UNIQUE 를 강제해 DB 레벨에서 1:1 을 보장한다.
--   (092 의 cafe24_order_id UNIQUE 와 키가 달라 무충돌. NULL 다건은 계속 허용.)
--
-- 선행조건(⚠️ 필수):
--   1) /api/cafe24/backfill-shipment-link?dry=0 백필 완료(NULL링크 정확매칭 연결).
--   2) "전표당 다중배송" 점검 — 발송완료(SHIPPED/DELIVERED) 2건 동시 전표가 있으면
--      이 마이그(중복 DELETE) 적용 보류하고 Arch 수동검수. 자동삭제 금지.
--
-- 작업:
--   1) 기존 중복 정리 — sales_order_id 당 1건만 보존(진행상태/송장/최신 우선), 나머지 삭제.
--   2) shipments.sales_order_id 부분 UNIQUE 추가(WHERE NOT NULL) — DB 레벨 1:1 강제.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- 1) 중복 정리: sales_order_id 당 "가장 진행된" 배송 1건만 남기고 삭제.
--    우선순위: 상태(DELIVERED>SHIPPED>PRINTED>PENDING) → 송장有 → 최신 created_at.
--    ⚠️ 비가역(복구불가). PARTITION BY 는 sales_order_id (092 의 cafe24_order_id 아님).
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY sales_order_id
      ORDER BY
        CASE status WHEN 'DELIVERED' THEN 4 WHEN 'SHIPPED' THEN 3 WHEN 'PRINTED' THEN 2 ELSE 1 END DESC,
        (tracking_number IS NOT NULL) DESC,
        created_at DESC
    ) AS rn
  FROM shipments
  WHERE sales_order_id IS NOT NULL
)
DELETE FROM shipments WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) 부분 UNIQUE 추가 — 한 전표에 배송 1건만 허용(NULL 다건은 허용).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_sales_order_id
  ON shipments(sales_order_id)
  WHERE sales_order_id IS NOT NULL;
