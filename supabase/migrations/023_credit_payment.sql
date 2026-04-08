-- 외상 / 카드 키인 결제 수단 추가 (migration 023)

-- 1. payment_method CHECK 조건 확장
ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_payment_method_check;
ALTER TABLE public.sales_orders ADD CONSTRAINT sales_orders_payment_method_check
  CHECK (payment_method IN ('cash', 'card', 'kakao', 'card_keyin', 'credit'));

-- 2. 외상 수금 추적 컬럼 추가
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS credit_settled        BOOLEAN     DEFAULT FALSE;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS credit_settled_at     TIMESTAMPTZ;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS credit_settled_method VARCHAR(20)
  CHECK (credit_settled_method IN ('cash', 'card', 'kakao', 'card_keyin'));

-- 3. 외상매출금 GL 계정 추가
INSERT INTO public.gl_accounts (code, name, account_type, is_active)
VALUES ('1115', '외상매출금', 'ASSET', true)
ON CONFLICT (code) DO NOTHING;
