-- ═══════════════════════════════════════════════════════════════════════════
-- 070_legacy_orders_normalize
--
-- flat legacy_purchases(라인아이템 단위, 66,090행) 를 주문 단위로 정규화:
--   · legacy_orders       — 주문 헤더(주문당 1행, 47,268)
--   · legacy_order_items  — 라인아이템(라인당 1행, 66,090)
--
-- 정책 — 순수 추가형:
--   · legacy_purchases 는 절대 무손상(DROP/ALTER/UPDATE 금지). INSERT 소스로 SELECT 만.
--   · 앱 read 는 당분간 legacy_purchases 유지. 후속 단계에서 정규화본으로 이전.
--   · 재실행 안전(멱등): ON CONFLICT DO NOTHING.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- (a) customers.phone2 — 제2 연락처 컬럼만 추가(백필 없음)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone2 TEXT;
COMMENT ON COLUMN customers.phone2 IS '제2 연락처(정규화). 레거시 임포트 등에서 보조 전화번호 보존용.';

-- ───────────────────────────────────────────────────────────────────────────
-- (b) legacy_orders — 주문 헤더(주문당 1행)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legacy_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_order_no   VARCHAR(40) UNIQUE NOT NULL,                  -- 주문 묶음 키 = 일자+순번+거래처코드
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  phone             TEXT,
  ordered_at        DATE,
  channel_text      TEXT,                                         -- 거래처명(청담점/자사몰…)
  branch_id         UUID REFERENCES branches(id),                 -- 매핑된 출고 지점
  branch_code_raw   TEXT,                                         -- 거래처코드 원본(A0/B0/X7…)
  staff_code        TEXT,                                         -- 담당자 코드
  recipient_name    TEXT,                                         -- 선물배송 수령자
  recipient_phone   TEXT,
  recipient_address TEXT,
  received_at       DATE,                                         -- 수령일자
  payment_status    TEXT,
  note              TEXT,
  total_amount      NUMERIC(14,0),                                -- 주문합계 = 라인합(VAT포함)
  source_file       TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  legacy_orders IS 'legacy_purchases 를 주문 단위로 정규화한 헤더(주문당 1행). sales_orders 와 분리.';
COMMENT ON COLUMN legacy_orders.legacy_order_no IS '주문 묶음 키 = 일자+순번+거래처코드. legacy_purchases.legacy_order_no 와 1:1.';
COMMENT ON COLUMN legacy_orders.recipient_name IS '선물배송 수령자. 구매자(customer)와 다를 수 있음.';
COMMENT ON COLUMN legacy_orders.total_amount IS '주문합계 = 해당 주문 라인들의 total_amount(VAT포함) 합.';

-- legacy_order_no 는 UNIQUE 가 인덱스 겸함 — 별도 생성 금지.
CREATE INDEX IF NOT EXISTS idx_lo_customer   ON legacy_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_lo_ordered_at ON legacy_orders(ordered_at);

-- ───────────────────────────────────────────────────────────────────────────
-- (c) legacy_order_items — 라인아이템(라인당 1행)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legacy_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES legacy_orders(id) ON DELETE CASCADE,
  line_seq        SMALLINT,                                       -- 주문 내 품목 순서(1..n)
  item_code       TEXT,
  item_text       TEXT,
  option_text     TEXT,
  quantity        NUMERIC(10,2),
  unit_price_vat  NUMERIC(14,2),
  supply_amount   NUMERIC(14,0),
  vat_amount      NUMERIC(14,0),
  discount_amount NUMERIC(14,0),
  total_amount    NUMERIC(14,0),
  UNIQUE (order_id, line_seq)
);

COMMENT ON TABLE  legacy_order_items IS 'legacy_orders 의 라인아이템(라인당 1행). legacy_purchases 라인과 1:1.';
COMMENT ON COLUMN legacy_order_items.line_seq IS '주문 내 품목 순서(1..n). 적재 시 legacy_order_no 파티션·id 순으로 생성.';

CREATE INDEX IF NOT EXISTS idx_loi_order_id  ON legacy_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_loi_item_code ON legacy_order_items(item_code);

-- ───────────────────────────────────────────────────────────────────────────
-- (d) RLS + GRANT — 064 패턴 그대로
--   custom session auth(Supabase Auth 미사용)라 client 는 anon role 로 호출.
--   Supabase 는 신규 테이블에 자동 grant 안 함 — RLS 만 있고 GRANT 없으면 anon 전면 거부.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE legacy_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legacy_orders_all ON legacy_orders;
CREATE POLICY legacy_orders_all ON legacy_orders
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_orders TO anon, authenticated;

ALTER TABLE legacy_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legacy_order_items_all ON legacy_order_items;
CREATE POLICY legacy_order_items_all ON legacy_order_items
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_order_items TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- (e) 데이터 분리 적재 (멱등 — 재실행 안전). 헤더 먼저 → 아이템 나중(FK 만족).
-- ───────────────────────────────────────────────────────────────────────────

-- (e-1) legacy_orders: legacy_purchases 를 legacy_order_no 로 GROUP BY, 주문당 1행.
--   주문 내 값갈림 0%(phone 만 5건 0.01%) → MIN(col) 으로 결정성 확보.
INSERT INTO legacy_orders (
  legacy_order_no, customer_id, phone, ordered_at, channel_text, branch_id,
  branch_code_raw, staff_code, recipient_name, recipient_phone, recipient_address,
  received_at, payment_status, note, total_amount, source_file
)
SELECT
  lp.legacy_order_no,
  MIN(lp.customer_id::text)::uuid           AS customer_id,
  MIN(lp.phone)                             AS phone,
  MIN(lp.ordered_at)                        AS ordered_at,
  MIN(lp.channel_text)                      AS channel_text,
  MIN(lp.branch_id::text)::uuid             AS branch_id,
  MIN(lp.branch_code_raw)                   AS branch_code_raw,
  MIN(lp.staff_code)                        AS staff_code,
  MIN(lp.recipient_name)                    AS recipient_name,
  MIN(lp.recipient_phone)                   AS recipient_phone,
  MIN(lp.recipient_address)                 AS recipient_address,
  MIN(lp.received_at)                       AS received_at,
  MIN(lp.payment_status)                    AS payment_status,
  MIN(lp.note)                              AS note,
  SUM(lp.total_amount)                      AS total_amount,
  MIN(lp.source_file)                       AS source_file
FROM legacy_purchases lp
WHERE lp.legacy_order_no IS NOT NULL
GROUP BY lp.legacy_order_no
ON CONFLICT (legacy_order_no) DO NOTHING;

-- (e-2) legacy_order_items: 라인별 1행. line_seq 는 주문 파티션·id 순으로 생성(원본 line_seq 전부 NULL).
WITH numbered AS (
  SELECT
    lp.legacy_order_no,
    lp.item_code,
    lp.item_text,
    lp.option_text,
    lp.quantity,
    lp.unit_price_vat,
    lp.supply_amount,
    lp.vat_amount,
    lp.discount_amount,
    lp.total_amount,
    ROW_NUMBER() OVER (
      PARTITION BY lp.legacy_order_no ORDER BY lp.id
    )::smallint AS line_seq
  FROM legacy_purchases lp
  WHERE lp.legacy_order_no IS NOT NULL
)
INSERT INTO legacy_order_items (
  order_id, line_seq, item_code, item_text, option_text, quantity,
  unit_price_vat, supply_amount, vat_amount, discount_amount, total_amount
)
SELECT
  lo.id,
  n.line_seq,
  n.item_code,
  n.item_text,
  n.option_text,
  n.quantity,
  n.unit_price_vat,
  n.supply_amount,
  n.vat_amount,
  n.discount_amount,
  n.total_amount
FROM numbered n
JOIN legacy_orders lo ON lo.legacy_order_no = n.legacy_order_no
ON CONFLICT (order_id, line_seq) DO NOTHING;
