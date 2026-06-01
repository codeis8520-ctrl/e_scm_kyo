-- ═══════════════════════════════════════════════════════════════════════════
-- 069_legacy_purchases_line_items
--
-- legacy_purchases 를 "주문 단위"에서 "라인아이템(품목) 단위" 보존으로 확장.
-- 소스: 경옥채판매DATA(~260518)_작업최종완료.xlsx (판매현황, 라인아이템 원장)
--
-- 064 의 컬럼은 유지하되 의미를 라인아이템에 맞춰 재사용:
--   · item_text        = 품목명 (1품목)
--   · quantity         = 수량 (1라인)
--   · total_amount     = 합계 (VAT포함, 1라인)
--   · channel_text     = 거래처명 (청담점/자사몰…)
--   · branch_code_raw  = 거래처코드 (A0/B0/X7…)
--   · legacy_purchase_no= 미사용(NULL). 주문 묶음은 legacy_order_no 로.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE legacy_purchases
  ADD COLUMN IF NOT EXISTS legacy_order_no   VARCHAR(40),   -- 일자+순번+거래처코드 (주문 묶음 키)
  ADD COLUMN IF NOT EXISTS line_seq          SMALLINT,      -- 주문 내 품목 순서(1..n)
  ADD COLUMN IF NOT EXISTS item_code         VARCHAR(40),   -- 품목코드 (→ products 매핑 후보)
  ADD COLUMN IF NOT EXISTS option_text       TEXT,          -- 주문 옵션
  ADD COLUMN IF NOT EXISTS unit_price_vat    NUMERIC(14,2), -- 단가(VAT포함)
  ADD COLUMN IF NOT EXISTS supply_amount     NUMERIC(14,0), -- 공급가액
  ADD COLUMN IF NOT EXISTS vat_amount        NUMERIC(14,0), -- 부가세
  ADD COLUMN IF NOT EXISTS discount_amount   NUMERIC(14,0), -- 할인
  ADD COLUMN IF NOT EXISTS staff_code        VARCHAR(20),   -- 담당자 코드
  ADD COLUMN IF NOT EXISTS recipient_name    TEXT,          -- 받는 분 (선물배송, 이름+메모 혼입 → TEXT)
  ADD COLUMN IF NOT EXISTS recipient_phone   TEXT,          -- 받는 분 연락처 (이름+주소 잡텍스트 혼입 → TEXT)
  ADD COLUMN IF NOT EXISTS recipient_address TEXT,          -- 받는 분 주소
  ADD COLUMN IF NOT EXISTS received_at       DATE,          -- 수령일자
  ADD COLUMN IF NOT EXISTS note              TEXT;          -- 특이사항

-- 064 의 payment_status(=결제정보 원문)·recipient_phone 는 자유 텍스트(카드승인문/상담메모/
-- 이름+주소 혼입, 최대 180자+)가 들어와 VARCHAR(30) 을 초과 → 레거시 보존 테이블이므로 TEXT 확장.
ALTER TABLE legacy_purchases
  ALTER COLUMN payment_status  TYPE TEXT,
  ALTER COLUMN recipient_phone TYPE TEXT,
  ALTER COLUMN recipient_name  TYPE TEXT;

COMMENT ON COLUMN legacy_purchases.legacy_order_no IS '주문 묶음 키 = 일자+순번+거래처코드. 같은 값이면 한 주문의 여러 라인.';
COMMENT ON COLUMN legacy_purchases.item_code       IS '원본 품목코드. 향후 products.code 와 매핑해 승격 가능.';
COMMENT ON COLUMN legacy_purchases.recipient_name  IS '선물배송 수령자. 구매자(customer)와 다를 수 있음.';

-- 주문 묶음/품목 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_lp_order_no  ON legacy_purchases(legacy_order_no);
CREATE INDEX IF NOT EXISTS idx_lp_item_code ON legacy_purchases(item_code);
