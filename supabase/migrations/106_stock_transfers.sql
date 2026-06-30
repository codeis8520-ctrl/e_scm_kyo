-- ═════════════════════════════════════════════════════════════════════════
-- 106_stock_transfers: 지점이동 전표(헤더+품목) — 전표 단위 조회·출력 (#85)
--
-- 배경: 창고이동(transferInventoryBatch)은 inventory_movements(OUT/IN)만 만들어
--   전표 단위(전표번호) 조회가 불가했음. 이동 1건 = 전표 1건으로 묶어 일자/출발/도착별 조회.
--   reference_type='TRANSFER' 무브먼트는 그대로 두고, 전표 헤더에 reference_id로 연결.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE TABLE IF NOT EXISTS stock_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no     varchar(40) UNIQUE NOT NULL,
  from_branch_id  uuid NOT NULL REFERENCES branches(id),
  to_branch_id    uuid NOT NULL REFERENCES branches(id),
  ship_date       date,          -- 출발(출고)일
  arrival_date    date,          -- 도착예정일
  memo            text,
  item_count      int  DEFAULT 0,
  total_qty       numeric DEFAULT 0,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_ship ON stock_transfers(ship_date);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id   uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id    uuid REFERENCES products(id),
  product_name  text,           -- 전표 시점 스냅샷(제품 변경에도 보존)
  product_code  text,
  quantity      numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_tr ON stock_transfer_items(transfer_id);

-- RLS/GRANT — 097 패턴(전 권한 허용, 앱 레벨 RBAC). anon/authenticated 풀.
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all stock_transfers" ON stock_transfers;
DROP POLICY IF EXISTS "Allow all stock_transfer_items" ON stock_transfer_items;
CREATE POLICY "Allow all stock_transfers" ON stock_transfers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all stock_transfer_items" ON stock_transfer_items FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON stock_transfers TO anon, authenticated;
GRANT ALL ON stock_transfer_items TO anon, authenticated;
