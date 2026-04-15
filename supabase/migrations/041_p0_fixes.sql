-- ═══════════════════════════════════════════════════════════════
-- P0 데이터 무결성 수정
-- 1) 분개 역분개 추적 (reversal audit trail)
-- 2) 주문 시점 포인트 적립률 기록
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- ─────────────────────────────────────────────────
-- 1) journal_entries: 역분개 추적 컬럼
-- ─────────────────────────────────────────────────

-- 역분개 시 원래 분개를 가리키는 FK
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES journal_entries(id);

-- 분개 유형 (원거래 vs 역분개 구분)
-- SALE, RETURN, PURCHASE_RECEIPT, CREDIT_CANCEL, CAFE24_REFUND
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(30);

-- 분개 생성자 (누가 승인/실행했는지)
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- 기존 데이터 source_type 역추적 (description 기반)
UPDATE journal_entries SET source_type = 'SALE'
  WHERE source_type IS NULL AND description ILIKE '%매출%' AND description NOT ILIKE '%환불%' AND description NOT ILIKE '%취소%';

UPDATE journal_entries SET source_type = 'RETURN'
  WHERE source_type IS NULL AND (description ILIKE '%환불%' OR description ILIKE '%반품%');

UPDATE journal_entries SET source_type = 'PURCHASE_RECEIPT'
  WHERE source_type IS NULL AND description ILIKE '%매입%';

UPDATE journal_entries SET source_type = 'CREDIT_CANCEL'
  WHERE source_type IS NULL AND description ILIKE '%취소%';

CREATE INDEX IF NOT EXISTS idx_journal_reversal ON journal_entries(reversal_of)
  WHERE reversal_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_source_type ON journal_entries(source_type);

-- ─────────────────────────────────────────────────
-- 2) sales_orders: 주문 시점 포인트 적립률 기록
-- ─────────────────────────────────────────────────

-- 주문 시점에 적용된 등급과 적립률
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS customer_grade_at_order VARCHAR(20);

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS point_rate_applied DECIMAL(5,2);

-- 기존 주문 데이터 역추적: 고객의 현재 등급으로 채움 (정확하진 않지만 null보다 나음)
UPDATE sales_orders so
SET customer_grade_at_order = c.grade,
    point_rate_applied = COALESCE(cg.point_rate, 1.00)
FROM customers c
LEFT JOIN customer_grades cg ON cg.code = c.grade
WHERE so.customer_id = c.id
  AND so.customer_grade_at_order IS NULL;
