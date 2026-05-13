-- ═════════════════════════════════════════════════════════════════════════
-- 066_products_pack_unpack: 박스 ↔ 소포장 수동 분해/재포장
--
-- 배경:
--   침향 30(박스, 30환들이) 1개 안에 침향 10(소포장, 10환들이) 3개가
--   물리적으로 들어있는 형태. 입고는 박스 단위로 받지만 판매는 박스/소포장
--   각각으로 함. 따라서 두 SKU 를 별도 재고로 관리하되, 매장에서 박스를
--   뜯으면 시스템 상에서 박스 -1, 소포장 +3 으로 옮길 수 있어야 함.
--   반대로 재포장(소포장 모아 박스로 돌리기)도 필요.
--
-- 정책:
--   · pack_child_id 가 NULL 이면 일반 제품(분해 불가).
--   · 분해/재포장은 inventory_movements 2건(부모 OUT/IN + 자식 IN/OUT)
--     으로 기록, reference_type='PACK_UNPACK'.
--   · POS 자동 분해 없음 — 사용자가 수동으로만 트리거.
--   · 모든 지점에서 가능 (RAW/SUB 본사 전용 제한과 별개).
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pack_child_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pack_child_qty INTEGER CHECK (pack_child_qty IS NULL OR pack_child_qty > 0);

COMMENT ON COLUMN products.pack_child_id IS
  '박스 분해/재포장 시 자식 SKU id. 예: 침향 30(박스) → 침향 10(소포장). NULL = 분해 불가.';
COMMENT ON COLUMN products.pack_child_qty IS
  '박스 1개당 자식 SKU 수량. 예: 3 (= 박스 1개 풀면 소포장 3개). pack_child_id 와 함께 설정.';

-- 자기 자신을 자식으로 두는 것 방지 (간단한 sanity check)
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS pack_child_not_self;
ALTER TABLE products
  ADD CONSTRAINT pack_child_not_self CHECK (pack_child_id IS NULL OR pack_child_id <> id);

-- pack_child_id 가 있으면 pack_child_qty 도 있어야 함 (그 반대도 마찬가지)
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS pack_child_pair;
ALTER TABLE products
  ADD CONSTRAINT pack_child_pair CHECK (
    (pack_child_id IS NULL AND pack_child_qty IS NULL) OR
    (pack_child_id IS NOT NULL AND pack_child_qty IS NOT NULL)
  );
