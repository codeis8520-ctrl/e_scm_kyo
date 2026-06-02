-- ═══════════════════════════════════════════════════════════════════════════
-- 071_products_pos_widget
--
-- POS "판매등록 위젯 표시" 여부 속성.
-- 기본 노출 대상 = 완제품(FINISHED) & 비-세트(is_phantom=false).
-- 세트(phantom)·RAW·SUB·SERVICE 는 위젯 미노출이되 POS 검색으로는 등록 가능.
-- 제품 편집 화면에서 product_type 무관하게 수동 토글 가능.
--
-- 인덱스 없음 — 활성 행 ~435개, 전건 in-memory 필터라 불필요.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pos_widget boolean NOT NULL DEFAULT false;

-- 백필 — 기존 제품은 규칙(완제품 & 비-세트)으로 위젯 노출 여부 산정
UPDATE products
SET pos_widget = (product_type = 'FINISHED' AND COALESCE(is_phantom, false) = false);

COMMENT ON COLUMN products.pos_widget IS
  'POS 판매등록 위젯(그리드) 노출 여부. true=검색어 없을 때 그리드에 표시. 기본 백필=FINISHED & 비-phantom. 검색 등록은 값과 무관하게 항상 가능.';
