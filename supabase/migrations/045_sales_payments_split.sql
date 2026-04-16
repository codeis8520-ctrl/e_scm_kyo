-- ═══════════════════════════════════════════════════════════════
-- 판매 개편
--   - sales_order_payments: 한 주문의 다중 결제(분할) 기록
--   - sales_orders.payment_method CHECK 확장: 'cod'(수령시수금), 'mixed'(복합)
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- 1) sales_orders.payment_method CHECK 확장
DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'sales_orders'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%payment_method%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE sales_orders DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;

ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_payment_method_chk
  CHECK (payment_method IN ('cash','card','card_keyin','kakao','credit','cod','mixed'));

COMMENT ON COLUMN sales_orders.payment_method IS
  'cash/card/card_keyin/kakao/credit(외상)/cod(수령시수금)/mixed(분할). mixed면 sales_order_payments에 세부 내역.';

-- 2) sales_order_payments: 분할 결제 기록
CREATE TABLE IF NOT EXISTS sales_order_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cash','card','card_keyin','kakao','credit','cod')),
  amount NUMERIC(12,0) NOT NULL CHECK (amount >= 0),
  approval_no TEXT,
  card_info TEXT,
  memo TEXT,
  paid_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_order_payments_order
  ON sales_order_payments(sales_order_id);

ALTER TABLE sales_order_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_order_payments_all ON sales_order_payments;
CREATE POLICY sales_order_payments_all
  ON sales_order_payments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE sales_order_payments IS
  '한 판매 주문의 다중 결제 기록. 합계 < sales_orders.total_amount 이면 잔액이 외상/미수.';
