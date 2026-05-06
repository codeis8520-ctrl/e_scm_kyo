-- Migration 062: products_product_type 제약 이름 충돌 수정
-- 문제: PostgreSQL 자동 명명 제약(products_product_type_chk)이 남아
--       migration 059의 DROP(products_product_type_check)이 빗나가 SERVICE가 여전히 거부됨.
-- 해결: 양쪽 이름 모두 DROP 후 단일 제약으로 재생성.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_chk;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;

ALTER TABLE products ADD CONSTRAINT products_product_type_chk
  CHECK (product_type IN ('FINISHED', 'RAW', 'SUB', 'SERVICE'));
