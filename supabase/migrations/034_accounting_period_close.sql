-- 회계 기간 마감 관리
SET search_path TO public;

CREATE TABLE IF NOT EXISTS accounting_period_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period varchar(7) NOT NULL UNIQUE,  -- 'YYYY-MM' (예: 2026-04)
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES users(id),
  memo text
);

ALTER TABLE accounting_period_closes ENABLE ROW LEVEL SECURITY;
CREATE POLICY apc_all ON accounting_period_closes FOR ALL USING (true) WITH CHECK (true);
