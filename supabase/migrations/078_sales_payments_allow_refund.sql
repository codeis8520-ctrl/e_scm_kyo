-- ═══════════════════════════════════════════════════════════════
-- 전표 수정(수령 전 품목 추가/삭제) 결제 차액 기록 지원
--   045에서 sales_order_payments.amount >= 0 제약 → 부분환불(음수) insert 불가.
--   판매상세 드로어는 totalPaid = Σ amount 로 "미결제 잔액(외상)"을 계산하므로
--   환불은 음수 행으로 표현해야 Σ가 실제 수금액과 일치(abs 저장은 집계 왜곡).
--   → amount >= 0 제약 제거(음수 허용). amount=0은 코드에서 skip.
--
--   추가: 045 child CHECK에 'mixed' 누락 → mixed 원주문의 대표 결제수단을
--   차액 행에 그대로 넣으면 CHECK 위반. 'mixed' 허용 추가.
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- 1) amount >= 0 제약 제거 (음수=환불 허용)
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'sales_order_payments'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%amount%>=%0%'
  LOOP
    EXECUTE 'ALTER TABLE sales_order_payments DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;

-- 2) payment_method CHECK 재정의: 'mixed' 추가
DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'sales_order_payments'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%payment_method%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE sales_order_payments DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;

ALTER TABLE sales_order_payments
  ADD CONSTRAINT sales_order_payments_payment_method_chk
  CHECK (payment_method IN ('cash','card','card_keyin','kakao','credit','cod','mixed'));

COMMENT ON COLUMN sales_order_payments.amount IS
  '결제 금액. 양수=수금, 음수=환불(전표 수정 부분환불). Σ amount = 실제 순수금액. total_amount - Σ = 외상 잔액.';
