-- ═════════════════════════════════════════════════════════════════════════
-- 106_stock_transfers → 재고변동전표(통합) 헤더+품목 — 전표 단위 조회·출력 (#85·#86)
--
-- 배경: 재고변동(창고이동·자가사용·강제조정, #79)을 전표 1건으로 묶어 전표번호·일자·
--   유형·지점별 조회. inventory_movements(실제 재고효과)는 그대로, 전표는 별도 헤더+품목 스냅샷.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE TABLE IF NOT EXISTS stock_movement_docs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no          varchar(40) UNIQUE NOT NULL,         -- TR-/US-/AJ- + YYYYMMDD + rand
  move_type       varchar(20) NOT NULL,                -- TRANSFER / USAGE / ADJUST
  from_branch_id  uuid NOT NULL REFERENCES branches(id),   -- 기준창고
  to_branch_id    uuid REFERENCES branches(id),            -- 대상창고(이동만; 그 외 = from)
  usage_type_id   uuid REFERENCES inventory_usage_types(id),  -- 자가사용 사유(있으면)
  ship_date       date,                                     -- 이동: 출발(출고)일
  arrival_date    date,                                     -- 이동: 도착예정일
  memo            text,
  item_count      int  DEFAULT 0,
  total_qty       numeric DEFAULT 0,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smdocs_type ON stock_movement_docs(move_type);
CREATE INDEX IF NOT EXISTS idx_smdocs_from ON stock_movement_docs(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_smdocs_to ON stock_movement_docs(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_smdocs_created ON stock_movement_docs(created_at);

CREATE TABLE IF NOT EXISTS stock_movement_doc_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        uuid NOT NULL REFERENCES stock_movement_docs(id) ON DELETE CASCADE,
  product_id    uuid REFERENCES products(id),
  product_name  text,           -- 전표 시점 스냅샷
  product_code  text,
  quantity      numeric NOT NULL   -- 이동/자가사용=차감수량, 강제조정=목표 수량
);
CREATE INDEX IF NOT EXISTS idx_smdoc_items_doc ON stock_movement_doc_items(doc_id);

-- RLS/GRANT — 097 패턴(전 권한 허용, 앱 레벨 RBAC).
ALTER TABLE stock_movement_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movement_doc_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all stock_movement_docs" ON stock_movement_docs;
DROP POLICY IF EXISTS "Allow all stock_movement_doc_items" ON stock_movement_doc_items;
CREATE POLICY "Allow all stock_movement_docs" ON stock_movement_docs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all stock_movement_doc_items" ON stock_movement_doc_items FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON stock_movement_docs TO anon, authenticated;
GRANT ALL ON stock_movement_doc_items TO anon, authenticated;
