-- ═══════════════════════════════════════════════════════════════
-- 002_accounting.sql  —  회계 기초 인프라
-- 실행: Supabase Dashboard > SQL Editor
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- ─── 계정과목 (Chart of Accounts) ────────────────────────────
CREATE TABLE IF NOT EXISTS gl_accounts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         varchar(10)  NOT NULL UNIQUE,
    name         varchar(100) NOT NULL,
    account_type varchar(20)  NOT NULL CHECK (account_type IN
                     ('ASSET','LIABILITY','EQUITY','REVENUE','COGS','EXPENSE')),
    parent_code  varchar(10),
    is_active    boolean      NOT NULL DEFAULT true,
    sort_order   int          NOT NULL DEFAULT 0,
    created_at   timestamptz  NOT NULL DEFAULT now()
);

-- ─── 분개 헤더 (Journal Entries) ─────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number  varchar(30)  NOT NULL UNIQUE,
    entry_date    date         NOT NULL,
    description   varchar(300),
    source_type   varchar(30),   -- SALE | PURCHASE_RECEIPT | RETURN | MANUAL
    source_id     uuid,
    total_debit   numeric(14,2) NOT NULL DEFAULT 0,
    total_credit  numeric(14,2) NOT NULL DEFAULT 0,
    created_by    uuid,
    created_at    timestamptz   NOT NULL DEFAULT now()
);

-- ─── 분개 라인 (Journal Entry Lines) ─────────────────────────
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id  uuid         NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id        uuid         NOT NULL REFERENCES gl_accounts(id),
    debit             numeric(14,2) NOT NULL DEFAULT 0,
    credit            numeric(14,2) NOT NULL DEFAULT 0,
    memo              varchar(300),
    created_at        timestamptz  NOT NULL DEFAULT now()
);

-- ─── 인덱스 ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_journal_entries_date       ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source     ON journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry        ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account      ON journal_entry_lines(account_id);

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE gl_accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gl_accounts_read"          ON gl_accounts         FOR ALL USING (true);
CREATE POLICY "journal_entries_read"      ON journal_entries     FOR ALL USING (true);
CREATE POLICY "journal_entry_lines_read"  ON journal_entry_lines FOR ALL USING (true);

-- ─── 기본 계정과목 시드 ────────────────────────────────────────
INSERT INTO gl_accounts (code, name, account_type, sort_order) VALUES
  -- 자산
  ('1110', '현금',              'ASSET',     110),
  ('1120', '카드매출채권',      'ASSET',     120),
  ('1130', '재고자산',          'ASSET',     130),
  ('1140', '선급금',            'ASSET',     140),
  -- 부채
  ('2110', '미지급금',          'LIABILITY', 210),
  ('2120', '선수금',            'LIABILITY', 220),
  -- 자본
  ('3110', '자본금',            'EQUITY',    310),
  -- 매출
  ('4110', '매출',              'REVENUE',   410),
  ('4120', '카카오페이매출',    'REVENUE',   420),
  -- 매출원가
  ('5110', '매출원가',          'COGS',      510),
  -- 비용
  ('6110', '급여',              'EXPENSE',   610),
  ('6120', '임차료',            'EXPENSE',   620),
  ('6130', '광고선전비',        'EXPENSE',   630),
  ('6140', '소모품비',          'EXPENSE',   640),
  ('6150', '기타비용',          'EXPENSE',   650)
ON CONFLICT (code) DO NOTHING;

-- ─── screen_permissions ──────────────────────────────────────
INSERT INTO screen_permissions (role, screen_path, can_view, can_edit) VALUES
  ('SUPER_ADMIN',   '/accounting', true, true),
  ('HQ_OPERATOR',   '/accounting', true, true),
  ('EXECUTIVE',     '/accounting', true, false)
ON CONFLICT (role, screen_path) DO NOTHING;
