-- 087: 소수점 재고 capability (#28 Step 1)
--   inventories.quantity / inventory_movements.quantity / inventories.safety_stock 를
--   INTEGER → NUMERIC(14,4) 로 확장. 기존 정수값은 X.0000 으로 보존된다.
--   products.allow_decimal_stock 플래그를 추가(기본 false) — 이 값이 true 인 제품만
--   앱에서 소수점 차감·표시·입력·조정을 허용한다. 비허용 제품은 기존 정수 동작 무변경.
--
--   ⚠️ NUMERIC 은 Supabase REST 응답에서 JS 문자열로 직렬화된다.
--      앱은 toNum() 헬퍼(src/lib/validators.ts)로 모든 읽기 지점을 래핑해 산술 회귀를 막는다.
--   금액·회계 컬럼은 본 마이그레이션 범위 밖(정수 원 유지).
--
--   Arch 가 직접 적용. (기존 컬럼 타입 변경 + 컬럼 추가뿐 — RLS/GRANT 재설정 불필요.)

BEGIN;

ALTER TABLE inventories
  ALTER COLUMN quantity     TYPE NUMERIC(14,4) USING quantity::numeric,
  ALTER COLUMN safety_stock TYPE NUMERIC(14,4) USING safety_stock::numeric;

ALTER TABLE inventory_movements
  ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allow_decimal_stock BOOLEAN NOT NULL DEFAULT false;

COMMIT;
