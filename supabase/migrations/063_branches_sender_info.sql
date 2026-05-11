-- ═════════════════════════════════════════════════════════════════════════
-- 063_branches_sender_info: 지점에 택배 발송자(보내는분) 정보 분리 저장
--
-- 배경: 대한통운/CJ 엑셀 임포트에서 보내는분 우편번호/도로명/상세주소가
--      별도 컬럼으로 필요한데, 기존 branches.address(TEXT)는 단일 필드라
--      분할 불가. 지점별로 출고지를 다르게 설정할 수 있도록 분리 컬럼 추가.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS sender_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS sender_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sender_zipcode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS sender_address TEXT,
  ADD COLUMN IF NOT EXISTS sender_address_detail VARCHAR(200);

COMMENT ON COLUMN branches.sender_name IS '택배 보내는분 이름 (예: 경옥채 본사). 미입력 시 "경옥채 " + name 으로 폴백.';
COMMENT ON COLUMN branches.sender_phone IS '택배 발송자 연락처. 미입력 시 branches.phone 폴백.';
COMMENT ON COLUMN branches.sender_zipcode IS '택배 출고지 우편번호.';
COMMENT ON COLUMN branches.sender_address IS '택배 출고지 도로명/지번 주소. 미입력 시 branches.address 폴백.';
COMMENT ON COLUMN branches.sender_address_detail IS '택배 출고지 상세주소.';
