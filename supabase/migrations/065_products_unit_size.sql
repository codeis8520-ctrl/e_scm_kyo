-- ═════════════════════════════════════════════════════════════════════════
-- 065_products_unit_size: 입고/유통 단위 환산 메타
--
-- 배경: 침향환 30환 통 단위로 입고되지만 재고는 환 단위로 추적해야
--      0.333 같은 소수점 영구 오차를 피할 수 있음. UI 에서 "통 단위"
--      토글로 입력하고 시스템이 자동 ×unit_size 환산해 환 단위로 저장.
--
-- 정책:
--   · unit_size 가 NULL 또는 1 이면 단위 환산 안 함 (기존 동작 그대로).
--   · 1 보다 크면 입출고/매입 UI 에 "통 단위" 토글 활성화.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS unit_size INTEGER,
  ADD COLUMN IF NOT EXISTS unit_label VARCHAR(20);

COMMENT ON COLUMN products.unit_size IS
  '입고/유통 1단위 = N base unit. NULL 또는 1 이면 환산 안 함. 예: 30 (= 30환 1통).';
COMMENT ON COLUMN products.unit_label IS
  '입고/유통 단위 라벨. 예: "통". NULL 이면 표시 안 함.';
