-- =====================================================
-- Migration 059: 제품 유형 SERVICE 추가 + track_inventory 옵션
-- =====================================================
-- 1) product_type CHECK 확장: FINISHED | RAW | SUB | SERVICE
--    SERVICE = 무형상품 (컨설팅, 교육, 서비스 등 — 재고 차감 X)
-- 2) track_inventory BOOLEAN: 재고 관리 여부
--    false면 신규 지점 생성 시 inventories 자동 생성 X,
--    POS·B2B·생산에서 재고 차감/이력 기록 skip.
--    SERVICE 타입은 기본 false로 시드(아래 UPDATE).
--    그 외 기존 제품은 기본 true 유지(데이터 호환).

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('FINISHED', 'RAW', 'SUB', 'SERVICE'));

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN products.product_type IS
  '제품 유형: FINISHED=완제품(POS 판매), RAW=원자재, SUB=부자재, SERVICE=무형상품(POS 판매 가능, 재고 X).';
COMMENT ON COLUMN products.track_inventory IS
  '재고 관리 여부. false면 inventories/inventory_movements를 사용하지 않음(SERVICE 기본값).';

-- 신규 SERVICE 제품이 만들어질 때 default false가 되도록 트리거(선택)
-- 기존 제품 마이그 시점에는 영향 없음 — 모두 true로 들어와 있는 상태.
