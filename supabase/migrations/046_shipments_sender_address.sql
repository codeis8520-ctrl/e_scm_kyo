-- ═══════════════════════════════════════════════════════════════
-- shipments 발신인 주소 컬럼 추가
--   - 기존: sender_name/sender_phone 만 존재
--   - 추가: sender_zipcode / sender_address / sender_address_detail
--   - 판매관리 택배 섹션에서 Daum 우편번호 검색 결과 저장
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS sender_zipcode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS sender_address TEXT,
  ADD COLUMN IF NOT EXISTS sender_address_detail VARCHAR(200);

COMMENT ON COLUMN shipments.sender_zipcode IS '발신인 우편번호 (Daum 검색 결과)';
COMMENT ON COLUMN shipments.sender_address IS '발신인 도로명/지번 주소';
COMMENT ON COLUMN shipments.sender_address_detail IS '발신인 상세 주소';
