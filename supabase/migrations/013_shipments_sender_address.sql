-- 발송자 주소 컬럼 추가 (대한통운 엑셀 L열 '보내는분주소' 필수)
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sender_address TEXT;
