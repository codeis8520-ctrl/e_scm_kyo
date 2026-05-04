-- =====================================================
-- Migration 061: Phantom BOM (판매 시 BOM 자동 분해 차감)
-- =====================================================
-- 옵션 조합 SKU(예: "침향30환 +오)", "침향30환 +생)")가 판매되었을 때
-- 자체 재고는 변동 없음, BOM에 등록된 구성품의 재고를 자동 차감하는 패턴.
--
-- 동작:
--   is_phantom=true 인 제품을 POS 판매 → processPosCheckout 이
--   inventories에서 본인 차감 SKIP, product_bom 테이블 읽어 구성품 재고 차감.
--   inventory_movements에는 구성품 OUT으로 기록 (reference=PHANTOM_DECOMPOSE).
--
-- 호환:
--   기존 제품은 is_phantom=false 기본. 데이터 마이그 영향 없음.
--   재고 표시 필터(/inventory, /inventory/count, 대시보드, AI 도구)는
--   별도 PR에서 is_phantom=true 도 함께 제외하도록 추가 조정.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_phantom BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN products.is_phantom IS
  'Phantom BOM 여부. true면 POS 판매 시 본인 재고는 차감 안 하고 product_bom에 등록된 구성품을 분해 차감. 이카운트의 "세트상품/매핑상품" 개념.';

-- 부분 인덱스 — phantom 제품만 별도 인덱스 (포스 결제 분기 빠른 판단용)
CREATE INDEX IF NOT EXISTS idx_products_phantom ON products(id) WHERE is_phantom = true;
