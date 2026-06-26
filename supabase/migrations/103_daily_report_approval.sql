-- ═════════════════════════════════════════════════════════════════════════
-- 103: 판매일보 Phase 2a — 관리자 승인 → 재고·매출 연동 (멱등 토대)
--
--  🔴 이 마이그는 일보가 "기록 전용"을 벗어나 실재고/회계를 움직이게 하는 토대.
--     컬럼만 추가(데이터 이동 없음). 실제 posting 로직은 앱 액션(approveDailyReport).
--  - status: 'APPROVED' 추가 (DRAFT/SUBMITTED → +APPROVED)
--  - approved_by/approved_at: 승인 감사
--  - posted/posted_at: 멱등 플래그 (posting 정확히 1회. 조건부 update where posted=false)
--  - journal_entry_id: 생성 매출분개 추적 (멱등·후속 역연동 대비)
--  멱등: IF NOT EXISTS / 제약 동적 재생성.
-- ═════════════════════════════════════════════════════════════════════════

-- 1) status CHECK 확장 (마이그101의 인라인 무명 CHECK 제거 후 명명 제약 재생성)
DO $$
DECLARE
  con_name TEXT;
BEGIN
  -- daily_sales_reports.status 에 걸린 CHECK 제약을 찾아 제거
  FOR con_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'daily_sales_reports'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE daily_sales_reports DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE daily_sales_reports
  ADD CONSTRAINT daily_sales_reports_status_check
  CHECK (status IN ('DRAFT','SUBMITTED','APPROVED'));

-- 2) 승인·멱등 컬럼
ALTER TABLE daily_sales_reports
  ADD COLUMN IF NOT EXISTS approved_by       UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS posted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS journal_entry_id  UUID;

COMMENT ON COLUMN daily_sales_reports.posted IS
  '재고·매출 posting 완료 멱등 플래그. true면 재-posting 차단. 조건부 update(where posted=false)로 동시성 1회 보장.';
COMMENT ON COLUMN daily_sales_reports.journal_entry_id IS
  '승인 시 생성된 매출분개(journal_entries) id. 후속 역연동(승인취소) 추적용.';
