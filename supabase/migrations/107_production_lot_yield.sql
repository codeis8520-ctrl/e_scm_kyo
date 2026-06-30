-- ═════════════════════════════════════════════════════════════════════════
-- 107_production_lot_yield → 생산전표 LOT·수율 base 보강 (#89)
--
-- 배경: 기존 completeProductionOrder는 지시수량을 그대로 입고 → "지시=산출"이라 수율 개념 부재.
--   #89 생산 로스/수율 분석의 base로, 실제 산출수량(produced_quantity)과 LOT번호를 기록.
--   수율 = produced_quantity / quantity (조회 시 계산, 저장 안 함). 원재료 실투입은 BOM 이론치 사용.
--   둘 다 NULL 허용(과거 완료분·미완 지시 호환). 완료 시점에 채워짐.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS lot_no            varchar(40),   -- 제조번호 LOT-YYYYMMDD-rand (완료 시 부여)
  ADD COLUMN IF NOT EXISTS produced_quantity numeric;       -- 실제 산출수량 (완료 시 입력; NULL=과거/미완)

CREATE INDEX IF NOT EXISTS idx_production_orders_lot ON production_orders(lot_no);
