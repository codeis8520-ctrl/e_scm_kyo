-- ═════════════════════════════════════════════════════════════════════════
-- 096: sales_orders.ship_from_branch_id — 출고처(재고 차감 지점) override
--
-- 출고처(재고가 차감된 지점)를 매출처(branch_id)와 별개로 정정할 수 있게 하는 컬럼.
-- 배송 없는(방문) 전표는 그동안 출고처를 매출처로 폴백 표시했는데, 잘못 등록한
-- 출고처를 사후 교정하려면 매출처와 분리해 저장할 곳이 필요해 추가.
--
-- 출고처 도출 우선순위(표시·재고기준 공통):
--   shipments.branch_id (배송 있으면) ?? sales_orders.ship_from_branch_id ?? sales_orders.branch_id
--
-- NULL = override 없음(매출처로 폴백). changeSalesOrderShipFromBranch 가 값 기록 +
-- inventory_movements 를 새 지점으로 이전(옛 지점 복원/새 지점 차감)한다.
-- 멱등: ADD COLUMN IF NOT EXISTS.
--
-- ⚠ FK 미설정(plain UUID): sales_orders 는 이미 branch_id→branches FK 가 있어,
--    branches 로의 FK 를 하나 더 추가하면 기존 PostgREST 임베드 `branch:branches(id,name)`
--    가 전 앱에서 모호성(ambiguous embedding) 으로 깨진다. 그래서 참조무결성 대신
--    plain UUID 로 두고 출고처명은 코드에서 별도 조회로 해결한다.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS ship_from_branch_id UUID;

CREATE INDEX IF NOT EXISTS idx_sales_orders_ship_from
  ON sales_orders(ship_from_branch_id) WHERE ship_from_branch_id IS NOT NULL;
