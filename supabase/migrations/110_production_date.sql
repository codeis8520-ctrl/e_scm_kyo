-- ═════════════════════════════════════════════════════════════════════════
-- 110_production_date → 생산전표 생산(입고)일자 (#95)
--
-- 배경: 생산 지시/완료 시 생산일자를 못 골라 produced_at·재고이력이 전표 생성시각으로 박힘.
--   #95: 사용자가 생산입고일자를 직접 선택 → 완제품 입고·부자재 차감·생산이력 모두 그 일자 기준.
--   전표 생성시각(created_at)은 내부 로그로만. production_date = 생산(입고) 기준일자.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS production_date date;   -- 생산(입고) 기준일자. 지시=예정, 완료=실제 입고일.

CREATE INDEX IF NOT EXISTS idx_production_orders_pdate ON production_orders(production_date);
