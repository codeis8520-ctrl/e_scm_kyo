-- ═══════════════════════════════════════════════════════════════
-- 거래처(B2B) 위탁판매 관리
-- 경옥채 제품을 거래처 매장에서 위탁 판매하고 정산 주기별로 수금
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- 거래처 마스터
CREATE TABLE IF NOT EXISTS b2b_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  code varchar(20) UNIQUE,
  business_no varchar(20),            -- 사업자등록번호
  contact_name varchar(50),
  phone varchar(20),
  email varchar(100),
  address text,
  settlement_cycle varchar(20) NOT NULL DEFAULT 'MONTHLY'
    CHECK (settlement_cycle IN ('WEEKLY','BIWEEKLY','MONTHLY')),
  settlement_day int DEFAULT 25,       -- 매월 정산일 (MONTHLY: 1~31, WEEKLY: 1=월~7=일)
  commission_rate numeric(5,2) DEFAULT 0, -- 거래처 수수료율 (%)
  memo text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_partners_active ON b2b_partners(is_active);

-- 거래처 납품(매출) 전표
CREATE TABLE IF NOT EXISTS b2b_sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number varchar(40) UNIQUE NOT NULL, -- B2B-YYYYMMDD-XXXX
  partner_id uuid NOT NULL REFERENCES b2b_partners(id),
  branch_id uuid REFERENCES branches(id),   -- 출고 지점
  total_amount numeric(12,0) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'DELIVERED'
    CHECK (status IN ('DELIVERED','PARTIALLY_SETTLED','SETTLED','CANCELLED')),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  settlement_due_date date,                  -- 정산 예정일
  settled_amount numeric(12,0) DEFAULT 0,    -- 수금된 금액
  settled_at timestamptz,
  memo text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_so_partner ON b2b_sales_orders(partner_id);
CREATE INDEX IF NOT EXISTS idx_b2b_so_status ON b2b_sales_orders(status);

-- 거래처 납품 항목
CREATE TABLE IF NOT EXISTS b2b_sales_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  b2b_sales_order_id uuid NOT NULL REFERENCES b2b_sales_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity int NOT NULL,
  unit_price numeric(12,0) NOT NULL,
  total_price numeric(12,0) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 정산 내역
CREATE TABLE IF NOT EXISTS b2b_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES b2b_partners(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_sales numeric(12,0) NOT NULL DEFAULT 0,      -- 해당 기간 총 납품액
  commission numeric(12,0) NOT NULL DEFAULT 0,         -- 거래처 수수료
  net_amount numeric(12,0) NOT NULL DEFAULT 0,         -- 실수금액 (총납품 - 수수료)
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SETTLED')),
  settled_at timestamptz,
  settled_method varchar(20),
  memo text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_settle_partner ON b2b_settlements(partner_id);

-- RLS
ALTER TABLE b2b_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY b2b_partners_all ON b2b_partners FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY b2b_so_all ON b2b_sales_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY b2b_soi_all ON b2b_sales_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY b2b_settle_all ON b2b_settlements FOR ALL USING (true) WITH CHECK (true);

-- 메뉴 권한
INSERT INTO screen_permissions (role, screen_path, can_view, can_edit) VALUES
  ('SUPER_ADMIN',    '/trade', true, true),
  ('HQ_OPERATOR',    '/trade', true, true),
  ('EXECUTIVE',      '/trade', true, false),
  ('PHARMACY_STAFF', '/trade', true, true),
  ('BRANCH_STAFF',   '/trade', true, true)
ON CONFLICT DO NOTHING;
