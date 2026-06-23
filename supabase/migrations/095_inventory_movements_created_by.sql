-- ═════════════════════════════════════════════════════════════════════════
-- 095: inventory_movements 처리자(created_by) 추적
--
-- 재고 소모(자가사용·시음·로스 등) 등록 시 "누가 처리했는지"를 남겨, 재고 변동
-- 이력에서 처리자명을 보여주기 위함. NULL 허용(과거 기록·자동 생성분은 미상).
-- recordStockUsage 가 session.id 로 기록. 표시는 MovementHistoryModal '처리자' 열.
-- 멱등: ADD COLUMN IF NOT EXISTS.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_by
  ON inventory_movements(created_by) WHERE created_by IS NOT NULL;
