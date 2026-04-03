-- =====================================================
-- 매입 관리 + 반품/환불 스키마 마이그레이션
-- 실행: Supabase Dashboard > SQL Editor
-- =====================================================

-- Supabase search_path 이슈 해결 (branches 등을 public에서 찾도록)
SET search_path TO public;

-- ─── 공급업체 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    code           varchar(20)  UNIQUE NOT NULL,
    name           varchar(100) NOT NULL,
    business_number varchar(20),
    representative  varchar(50),
    phone          varchar(20),
    email          varchar(255),
    fax            varchar(20),
    address        text,
    payment_terms  int          DEFAULT 30,
    bank_name      varchar(50),
    bank_account   varchar(50),
    bank_holder    varchar(50),
    memo           text,
    is_active      boolean      NOT NULL DEFAULT true,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now()
);

-- ─── 발주서 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number     varchar(30) UNIQUE NOT NULL,
    supplier_id   uuid        NOT NULL REFERENCES public.suppliers(id),
    branch_id     uuid        NOT NULL REFERENCES public.branches(id),
    ordered_by    uuid        REFERENCES public.users(id),
    status        varchar(30) NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
    total_amount  decimal(12,0) NOT NULL DEFAULT 0,
    expected_date date,
    memo          text,
    ordered_at    timestamptz NOT NULL DEFAULT now(),
    confirmed_at  timestamptz,
    completed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── 발주 항목 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id   uuid        NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    product_id          uuid        NOT NULL REFERENCES public.products(id),
    ordered_quantity    int         NOT NULL CHECK (ordered_quantity > 0),
    received_quantity   int         NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    unit_price          decimal(12,0) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    total_price         decimal(12,0) NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── 입고 전표 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_receipts (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number      varchar(30) UNIQUE NOT NULL,
    purchase_order_id   uuid        NOT NULL REFERENCES public.purchase_orders(id),
    branch_id           uuid        REFERENCES public.branches(id),
    received_by         uuid        REFERENCES public.users(id),
    received_at         timestamptz NOT NULL DEFAULT now(),
    total_amount        decimal(12,0) NOT NULL DEFAULT 0,
    memo                text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── 입고 항목 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_receipt_items (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id              uuid        NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
    purchase_order_item_id  uuid        NOT NULL REFERENCES public.purchase_order_items(id),
    product_id              uuid        NOT NULL REFERENCES public.products(id),
    quantity                int         NOT NULL CHECK (quantity > 0),
    unit_price              decimal(12,0) NOT NULL DEFAULT 0,
    total_price             decimal(12,0) NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- ─── 환불 전표 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.return_orders (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number     varchar(30) UNIQUE NOT NULL,
    original_order_id uuid        NOT NULL REFERENCES public.sales_orders(id),
    branch_id         uuid        NOT NULL REFERENCES public.branches(id),
    customer_id       uuid        REFERENCES public.customers(id),
    processed_by      uuid        REFERENCES public.users(id),
    -- 프론트엔드(RefundModal) 값과 일치: DEFECTIVE, WRONG_ITEM, CHANGE_OF_MIND, DUPLICATE, OTHER
    reason            varchar(30) NOT NULL,
    reason_detail     text,
    refund_amount     decimal(12,0) NOT NULL DEFAULT 0,
    -- 'point' (단수) — RefundModal 전송값과 일치
    refund_method     varchar(20)  CHECK (refund_method IN ('cash','card','kakao','point')),
    points_restored   int          DEFAULT 0,
    status            varchar(20)  NOT NULL DEFAULT 'COMPLETED'
                      CHECK (status IN ('PENDING','COMPLETED','REJECTED')),
    processed_at      timestamptz  NOT NULL DEFAULT now(),
    created_at        timestamptz  NOT NULL DEFAULT now()
);

-- ─── 환불 항목 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.return_order_items (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    return_order_id       uuid        NOT NULL REFERENCES public.return_orders(id) ON DELETE CASCADE,
    sales_order_item_id   uuid        NOT NULL REFERENCES public.sales_order_items(id),
    product_id            uuid        NOT NULL REFERENCES public.products(id),
    quantity              int         NOT NULL CHECK (quantity > 0),
    unit_price            decimal(12,0) NOT NULL DEFAULT 0,
    total_price           decimal(12,0) NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now()
);

-- ─── sales_orders status 확장 ──────────────────────────
DO $$
BEGIN
    ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check;
    ALTER TABLE public.sales_orders
        ADD CONSTRAINT sales_orders_status_check
        CHECK (status IN (
            'PENDING','CONFIRMED','SHIPPED','COMPLETED','CANCELLED',
            'REFUNDED','PARTIALLY_REFUNDED'
        ));
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Constraint update skipped: %', SQLERRM;
END $$;

-- ─── 인덱스 ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_suppliers_code            ON public.suppliers(code);
CREATE INDEX IF NOT EXISTS idx_suppliers_active          ON public.suppliers(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier  ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_branch    ON public.purchase_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status    ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_date      ON public.purchase_orders(ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_items_po               ON public.purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_po      ON public.purchase_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items    ON public.purchase_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_original    ON public.return_orders(original_order_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_customer    ON public.return_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_branch      ON public.return_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_return_order_items_return ON public.return_order_items(return_order_id);

-- ─── RLS ───────────────────────────────────────────────
ALTER TABLE public.suppliers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_order_items    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_all             ON public.suppliers;
DROP POLICY IF EXISTS purchase_orders_all       ON public.purchase_orders;
DROP POLICY IF EXISTS purchase_order_items_all  ON public.purchase_order_items;
DROP POLICY IF EXISTS purchase_receipts_all     ON public.purchase_receipts;
DROP POLICY IF EXISTS purchase_receipt_items_all ON public.purchase_receipt_items;
DROP POLICY IF EXISTS return_orders_all         ON public.return_orders;
DROP POLICY IF EXISTS return_order_items_all    ON public.return_order_items;

CREATE POLICY suppliers_all              ON public.suppliers             FOR ALL USING (true);
CREATE POLICY purchase_orders_all        ON public.purchase_orders       FOR ALL USING (true);
CREATE POLICY purchase_order_items_all   ON public.purchase_order_items  FOR ALL USING (true);
CREATE POLICY purchase_receipts_all      ON public.purchase_receipts     FOR ALL USING (true);
CREATE POLICY purchase_receipt_items_all ON public.purchase_receipt_items FOR ALL USING (true);
CREATE POLICY return_orders_all          ON public.return_orders         FOR ALL USING (true);
CREATE POLICY return_order_items_all     ON public.return_order_items    FOR ALL USING (true);

-- ─── updated_at 트리거 ─────────────────────────────────
DO $$
BEGIN
    CREATE TRIGGER tr_suppliers_updated_at
        BEFORE UPDATE ON public.suppliers
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TRIGGER tr_purchase_orders_updated_at
        BEFORE UPDATE ON public.purchase_orders
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── screen_permissions ────────────────────────────────
INSERT INTO public.screen_permissions (role, screen_path, can_view, can_edit)
VALUES
    ('SUPER_ADMIN',    '/purchases', true, true),
    ('HQ_OPERATOR',    '/purchases', true, true),
    ('PHARMACY_STAFF', '/purchases', true, true),
    ('BRANCH_STAFF',   '/purchases', true, true),
    ('EXECUTIVE',      '/purchases', true, false)
ON CONFLICT (role, screen_path) DO NOTHING;
