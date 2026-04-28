-- =====================================================
-- Migration 058: sales_orders 과세/면세 스냅샷
-- =====================================================
-- 배경: products.is_taxable로 사후 집계만 가능한 상태였음. 한 전표에
--      과세/면세 품목이 혼합되면 영수증·거래시점 보고가 정확하지 않음.
--
-- 처리: 거래 시점에 결정된 값을 스냅샷으로 저장.
--   taxable_amount  = 과세 매출 (VAT 포함, 주문 할인·포인트 차감 후 비례 배분)
--   exempt_amount   = 면세 매출 (할인 차감 후 비례 배분)
--   vat_amount      = 부가세 (= round(taxable_amount × 10 / 110))
--   세 값의 합 ≒ final_amount(고객 실수령액). 반올림 차이는 1원 이내.
--
-- ※ 기존 데이터(NULL/0)는 reports 페이지가 사후 집계로 폴백.
-- ※ 세금계산서 발행 단계가 아니므로 라인별 스냅샷은 보류 — 주문 레벨만.

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS taxable_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exempt_amount  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount     INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_orders.taxable_amount IS '과세 매출 (VAT 포함, 할인 비례 배분 후)';
COMMENT ON COLUMN sales_orders.exempt_amount  IS '면세 매출 (할인 비례 배분 후)';
COMMENT ON COLUMN sales_orders.vat_amount     IS '부가세 (=round(taxable_amount × 10/110))';
