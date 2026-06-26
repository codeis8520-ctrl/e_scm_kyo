-- ═════════════════════════════════════════════════════════════════════════
-- 101: 판매일보 (Daily Sales Report) — Phase 1 기록 전용
--
--  백화점 매장 판매사원이 휴대폰에서 종이 일보를 대체 입력.
--  🚨 기록 전용: inventories / sales_orders / journal_entries 에 일절 반영 안 함.
--     재고·매출·회계 자동반영은 Phase 2(별도).
--  RLS: 097(smartstore) 패턴 — ENABLE + USING(true) + GRANT ALL TO anon, authenticated.
--     (앱 레벨 RBAC = requireSession + 비관리자 branch_id 세션강제로 보호)
--  멱등: IF NOT EXISTS.
-- ═════════════════════════════════════════════════════════════════════════

-- 1) 헤더 — 매장×날짜 1건
CREATE TABLE IF NOT EXISTS daily_sales_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  report_date     DATE NOT NULL,
  author_user_id  UUID REFERENCES users(id),
  author_name     TEXT,                              -- 작성자명 스냅샷
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SUBMITTED')),
  daily_total     NUMERIC(12,0) NOT NULL DEFAULT 0,  -- 현장매출+택배매출 합 (표시용 비정규화)
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (branch_id, report_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_sales_reports_branch_date
  ON daily_sales_reports(branch_id, report_date DESC);

-- 2) 라인 — 품목별
CREATE TABLE IF NOT EXISTS daily_sales_report_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       UUID NOT NULL REFERENCES daily_sales_reports(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id),      -- NULL 허용(비정형 품목)
  product_code    TEXT,                              -- 스냅샷
  product_name    TEXT NOT NULL,                     -- 스냅샷
  unit_price      NUMERIC(12,0) NOT NULL DEFAULT 0,  -- 스냅샷
  opening_stock   NUMERIC(12,3) NOT NULL DEFAULT 0,  -- 오픈재고(전일 마감 이월)
  onsite_sold     NUMERIC(12,3) NOT NULL DEFAULT 0,  -- 현장판매
  sample_damage   NUMERIC(12,3) NOT NULL DEFAULT 0,  -- 시음증정/파손
  in_return       NUMERIC(12,3) NOT NULL DEFAULT 0,  -- 입고/반품
  closing_stock   NUMERIC(12,3) NOT NULL DEFAULT 0,  -- 마감재고(자동값+사원수정 최종값)
  onsite_revenue  NUMERIC(12,0) NOT NULL DEFAULT 0,  -- 현장매출
  hq_parcel       NUMERIC(12,3) NOT NULL DEFAULT 0,  -- 본사택배(수량)
  parcel_revenue  NUMERIC(12,0) NOT NULL DEFAULT 0,  -- 택배매출
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (report_id, product_id)                     -- NULL은 distinct → 비정형 다건 OK
);
CREATE INDEX IF NOT EXISTS idx_daily_sales_report_lines_report
  ON daily_sales_report_lines(report_id);

-- 3) RLS + GRANT (097 패턴)
ALTER TABLE daily_sales_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_sales_reports_all ON daily_sales_reports;
CREATE POLICY daily_sales_reports_all ON daily_sales_reports FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON daily_sales_reports TO anon, authenticated;

ALTER TABLE daily_sales_report_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_sales_report_lines_all ON daily_sales_report_lines;
CREATE POLICY daily_sales_report_lines_all ON daily_sales_report_lines FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON daily_sales_report_lines TO anon, authenticated;
