-- ═══════════════════════════════════════════════════════════════════════
-- 매장 QR 셀프 고객 등록 지원
-- ═══════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- customers.source: 고객 유입 경로 (기존 카페24 동기화 코드에서도 사용 가능)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS source varchar(30);

COMMENT ON COLUMN customers.source IS
  '고객 유입 경로: SELF_REGISTER(매장QR) / CAFE24 / STAFF(직원등록) / IMPORT 등';

-- 빠른 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_customers_source ON customers(source);
