# Architect Brief — Step: 레거시 판매데이터 정규화 1단계 (데이터층)

## Goal
flat legacy_purchases(66,090 라인행)를 주문헤더(legacy_orders 47,268) + 품목(legacy_order_items 66,090) 두 테이블로 정규화하고 customers.phone2 컬럼을 추가한다. **순수 추가형** — legacy_purchases 와 기존 앱 read 는 절대 무손상.

## 절대 경계 (Bob 가 넘으면 안 되는 선)
- legacy_purchases 테이블/데이터/컬럼/인덱스/RLS **건드리지 마라**. DROP/ALTER/UPDATE 금지. INSERT 소스로 SELECT 만.
- 앱 코드(src/app/**, actions.ts 류) read 리팩터 **금지**. 이번 스코프 아님.
- 임포터(scripts/legacy_reimport.py, legacy-import-v2/) **재작성 금지**.
- **DB 직접 적용 금지.** Bob 는 .sql 파일과 schema.ts 만 작성. 적용/검증은 Arch 가 psycopg 로.

## Build Order

### 1. supabase/migrations/070_legacy_orders_normalize.sql
한 파일에 (a)~(e) 순서.

(a) customers.phone2:
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone2 TEXT;  (백필 없음, 컬럼만. COMMENT 달 것)

(b) legacy_orders (주문 헤더, 주문당 1행):
  id uuid pk default gen_random_uuid(), legacy_order_no varchar(40) UNIQUE NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL, phone text, ordered_at date,
  channel_text text, branch_id uuid REFERENCES branches(id), branch_code_raw text, staff_code text,
  recipient_name text, recipient_phone text, recipient_address text, received_at date,
  payment_status text, note text, total_amount numeric(14,0), source_file text,
  metadata jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz default now().
  인덱스: customer_id, ordered_at. (legacy_order_no 는 UNIQUE 가 인덱스 겸함 — 별도 생성 금지)

(c) legacy_order_items (라인당 1행):
  id uuid pk default gen_random_uuid(), order_id uuid NOT NULL REFERENCES legacy_orders(id) ON DELETE CASCADE,
  line_seq smallint, item_code text, item_text text, option_text text, quantity numeric(10,2),
  unit_price_vat numeric(14,2), supply_amount numeric(14,0), vat_amount numeric(14,0),
  discount_amount numeric(14,0), total_amount numeric(14,0).
  제약: UNIQUE(order_id, line_seq).  인덱스: order_id, item_code.

(d) RLS + GRANT — 064 패턴 그대로 (두 테이블 각각):
  ALTER TABLE legacy_orders ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS legacy_orders_all ON legacy_orders;
  CREATE POLICY legacy_orders_all ON legacy_orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_orders TO anon, authenticated;
  -> legacy_order_items 도 동일(이름만 교체).
  **GRANT 빠뜨리지 마라 — Supabase 가 신규 테이블에 자동 grant 안 함. RLS 만 있고 GRANT 없으면 anon 전면 거부.**

(e) 데이터 분리 적재 (멱등 — 재실행 안전):
  - legacy_orders INSERT: legacy_purchases 를 legacy_order_no 로 GROUP BY, 주문당 1행.
    헤더 컬럼(customer_id, phone, ordered_at, channel_text, branch_id, branch_code_raw, staff_code,
    recipient_name, recipient_phone, recipient_address, received_at, payment_status, note, source_file)
    = **MIN(col) 대표값**. (Arch 검증: 주문내 값갈림 0%, phone 만 5건 0.01% -> MIN 으로 결정성 확보.)
    total_amount = SUM(lp.total_amount). metadata 는 '{}'::jsonb 기본.
    멱등: ON CONFLICT (legacy_order_no) DO NOTHING 또는 WHERE NOT EXISTS 가드.
  - legacy_order_items INSERT: 라인별 1행.
    order_id = legacy_orders.id (JOIN on legacy_order_no).
    line_seq = row_number() over (partition by lp.legacy_order_no order by lp.id). (lp.line_seq 전부 NULL -> 생성)
    품목 컬럼 그대로 복사: item_code, item_text, option_text, quantity, unit_price_vat,
    supply_amount, vat_amount, discount_amount, total_amount.
    멱등: ON CONFLICT (order_id, line_seq) DO NOTHING 또는 NOT EXISTS 가드.
  - Flag: 헤더 먼저, 아이템 나중 (FK 만족). row_number 파티션 순서 일관되게 CTE 로 묶을 것.

### 2. src/lib/ai/schema.ts DB_SCHEMA 동기화 (CLAUDE.md AI Agent Sync 필수)
  - customers 라인에 phone2 추가 (제2 연락처(정규화)).
  - 기존 legacy_purchases(마이그 064+069) 블록 끝 주석에 한 줄 추가:
    "-> 070 에서 legacy_orders/legacy_order_items 로 정규화됨(주문헤더+품목). 앱 read 는 이 테이블 유지, 후속 단계 이전 예정."
  - 새 항목 2개 추가(legacy_purchases 블록 바로 아래):
    legacy_orders(마이그 070): id, legacy_order_no(UNIQUE 주문키=일자+순번+거래처코드), customer_id, phone,
      ordered_at, channel_text, branch_id, branch_code_raw, staff_code, recipient_name/phone/address(선물배송 수령자),
      received_at, payment_status, note, total_amount(주문합계=라인합 VAT포함), source_file, metadata, created_at/updated_at
      주문당 1행(47,268). legacy_purchases 를 주문 단위로 정규화한 헤더.
    legacy_order_items(마이그 070): id, order_id(->legacy_orders ON DELETE CASCADE), line_seq(주문내 품목순서 1..n),
      item_code, item_text, option_text, quantity, unit_price_vat, supply_amount, vat_amount, discount_amount, total_amount
      라인아이템 단위(66,090). UNIQUE(order_id,line_seq).

## Out of Scope (손대지 마라 — Known Gaps 후보)
- 앱 read 가 정규화본을 쓰게 하는 리팩터(고객 상세 과거구매 탭, /customers/analytics RFM).
- legacy_purchases DROP. 임포터 재작성. phone2 백필. 정규화본 복사/매핑 UI.

## Acceptance (Arch 가 적용 후 psycopg 로 검증)
- legacy_orders rowcount = 47,268
- legacy_order_items rowcount = 66,090
- SUM(legacy_orders.total_amount) = SUM(legacy_purchases.total_amount)
- legacy_order_items 에서 line_seq IS NULL = 0
- 고아 item(order_id 가 legacy_orders 에 없음) = 0
- npm run build 통과 (schema.ts 변경 검증)
