-- =====================================================
-- Migration 019: Cafe24 주문 매출 정확화
-- =====================================================
-- 배경:
--   한국 이커머스에서 "매출 확정"은 배송완료가 아닌 구매확정(order.confirmed) 시점.
--   배송완료(order.delivered) 후 고객이 환불 신청 가능. 구매확정 후에야 정산 확정.
--
-- 변경:
--   1. DELIVERED 상태 추가 (배송완료, 구매확정 전)
--   2. purchase_confirmed_at 컬럼 추가 (구매확정 시점 기록)
--   3. refund_amount 컬럼 추가 (부분환불 금액 추적)

-- 1. status CHECK 제약 확장 (DELIVERED 추가)
ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check;
ALTER TABLE public.sales_orders
  ADD CONSTRAINT sales_orders_status_check
  CHECK (status IN (
    'PENDING', 'CONFIRMED', 'SHIPPED',
    'DELIVERED',              -- 배송완료 (구매확정 전, 환불 가능)
    'COMPLETED',              -- 구매확정 완료 = 매출 확정
    'CANCELLED',
    'REFUNDED',               -- 전체 환불
    'PARTIALLY_REFUNDED'      -- 부분 환불
  ));

-- 2. 구매확정 시점 기록
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS purchase_confirmed_at TIMESTAMPTZ;

-- 3. 환불 금액 추적
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(12,0) DEFAULT 0;
