-- ===========================================================================
-- 1회성 정리 스크립트 — 미확정 ONLINE(카페24/자사몰) 주문 전표 삭제 (#25, 방식 A 전환)
--
-- 배경: 매출 인식 분리(#25) 이전 크론(syncCafe24PaidOrdersCore)이 결제완료 카페24 주문을
--       자동으로 sales_order + items + 매출분개로 만들었다. 이제는 배송화면 "배송 추가"
--       확정 시점에만 매출이 생성된다. 따라서 과거 자동 생성되었지만 아직 배송(shipments)
--       이 없는 = 실제로는 미확정인 약 293건의 전표를 "없던 일"로 완전 삭제(clean slate)한다.
--       카페24 원본 주문은 그대로 남으므로, 추후 배송 추가 시 재확정으로 다시 생성된다.
--
-- 대상: channel='ONLINE' sales_orders 중 매칭되는 shipments 가 하나도 없는 행.
--
-- 멱등: 재실행 시 대상 0건이면 아무것도 삭제하지 않는다(0건 처리).
--
-- 마감 가드: 대상 주문의 매출분개(journal_entries source_type LIKE 'SALE%') 중
--            entry_date 가 마감된 회계기간(accounting_period_closes.period, YYYY-MM)에
--            속한 것이 하나라도 있으면 전체 중단(RAISE EXCEPTION) → 트랜잭션 롤백.
--            (현재 accounting_period_closes 는 0건이므로 실제로 걸리지 않으나 안전장치로 유지.)
--
-- 삭제 순서(FK 의존): journal_entry_lines → journal_entries → sales_order_items → sales_orders.
--                     (방어적으로 point_history / inventory_movements 도 제거 — 현재 0건 예상.)
--
-- ※ 이 스크립트는 Architect 가 직접 실행한다.
-- ===========================================================================

BEGIN;

-- 대상 sales_orders id 집합 (임시 테이블, 트랜잭션 종료 시 자동 삭제).
-- ⚠️ 연결 키 주의: 과거 카페24 shipments 는 sales_order_id 가 NULL 이고 cafe24_order_id 로만
--    연결된다(86건 전부 sales_order_id=NULL). 따라서 "배송 있음" 판정은 반드시 cafe24_order_id
--    매칭으로 한다. sales_order_id 로 판정하면 확정된 74건까지 전부 삭제되는 치명적 오류.
-- ⚠️ cafe24_order_id IS NOT NULL 로 자동수집 주문만 한정(수기 SA-ONLINE 등 제외).
CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT so.id
FROM sales_orders so
WHERE so.channel = 'ONLINE'
  AND so.cafe24_order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM shipments sh WHERE sh.cafe24_order_id = so.cafe24_order_id
  );

-- ── 마감 가드: 마감된 기간에 속한 대상 매출분개가 있으면 중단 ──────────────────
DO $$
DECLARE
  blocked_count int;
  blocked_orders text;
BEGIN
  SELECT count(*),
         string_agg(DISTINCT so.order_number, ', ')
    INTO blocked_count, blocked_orders
  FROM journal_entries je
  JOIN _targets t        ON t.id = je.source_id
  JOIN sales_orders so   ON so.id = t.id
  JOIN accounting_period_closes apc
       ON apc.period = to_char(je.entry_date, 'YYYY-MM')
  WHERE je.source_type LIKE 'SALE%';

  IF blocked_count > 0 THEN
    RAISE EXCEPTION
      '마감된 회계기간에 속한 매출분개가 있어 중단합니다(% 건). 대상 주문: %',
      blocked_count, blocked_orders;
  END IF;
END $$;

-- ── 삭제 (FK 순서) ──────────────────────────────────────────────────────────

-- 1) 매출분개 라인(journal_entry_lines) — 대상 주문의 SALE 분개에 속한 라인.
DELETE FROM journal_entry_lines jel
USING journal_entries je
JOIN _targets t ON t.id = je.source_id
WHERE jel.journal_entry_id = je.id
  AND je.source_type LIKE 'SALE%';

-- 2) 매출분개 헤더(journal_entries).
DELETE FROM journal_entries je
USING _targets t
WHERE je.source_id = t.id
  AND je.source_type LIKE 'SALE%';

-- 3) 방어적: 포인트/재고 movements(현재 0건 예상이나 FK·잔존 방지).
DELETE FROM point_history ph
USING _targets t
WHERE ph.sales_order_id = t.id;

DELETE FROM inventory_movements im
WHERE im.reference_id IN (
  SELECT soi.id FROM sales_order_items soi
  JOIN _targets t ON t.id = soi.sales_order_id
);

-- 4) 주문 품목(sales_order_items).
DELETE FROM sales_order_items soi
USING _targets t
WHERE soi.sales_order_id = t.id;

-- 5) 주문 헤더(sales_orders).
DELETE FROM sales_orders so
USING _targets t
WHERE so.id = t.id;

COMMIT;
