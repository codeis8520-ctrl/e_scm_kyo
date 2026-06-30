-- ═════════════════════════════════════════════════════════════════════════
-- 108_daily_report_revisions → 판매일보 변경 이력 (#93 Phase 1)
--
-- 배경: saveDailyReport가 라인을 delete+insert로 덮어써서 기존 입력값이 사라짐.
--   #93: 제출한 일보를 권한자가 수정할 때 '기존 입력값 + 변경 이력'이 남아야 함.
--   → 제출(SUBMITTED)된 일보를 재수정할 때 직전 상태(헤더+라인)를 JSONB 스냅샷으로 보존.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE TABLE IF NOT EXISTS daily_sales_report_revisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      uuid NOT NULL REFERENCES daily_sales_reports(id) ON DELETE CASCADE,
  branch_id      uuid,
  report_date    date,
  snapshot       jsonb NOT NULL,        -- { header: {...}, lines: [...] } — 변경 직전 상태
  daily_total    numeric,
  edited_by      uuid REFERENCES users(id),
  edited_by_name text,
  change_note    text,                  -- 수정 사유(선택)
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dsr_rev_report ON daily_sales_report_revisions(report_id, created_at DESC);

-- RLS/GRANT — 097 패턴(앱 레벨 RBAC).
ALTER TABLE daily_sales_report_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all daily_sales_report_revisions" ON daily_sales_report_revisions;
CREATE POLICY "Allow all daily_sales_report_revisions" ON daily_sales_report_revisions FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON daily_sales_report_revisions TO anon, authenticated;
