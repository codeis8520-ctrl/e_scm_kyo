-- ═════════════════════════════════════════════════════════════════════════
-- 098: shipments.source 에 'SMARTSTORE' 허용
--
-- 스마트스토어 엑셀 임포트가 생성하는 배송 레코드의 출처 구분값. 기존 CHECK는
-- ('CAFE24','STORE')만 허용 → 'SMARTSTORE' 추가. 멱등(DROP IF EXISTS 후 재생성).
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_source_check;
ALTER TABLE shipments ADD CONSTRAINT shipments_source_check
  CHECK (source IN ('CAFE24', 'STORE', 'SMARTSTORE'));
