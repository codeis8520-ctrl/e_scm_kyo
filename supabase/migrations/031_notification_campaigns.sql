SET search_path TO public;

CREATE TABLE IF NOT EXISTS notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  description text,
  event_type varchar(30) NOT NULL DEFAULT 'CUSTOM',

  start_date date NOT NULL,
  end_date date NOT NULL,

  is_recurring boolean NOT NULL DEFAULT false,
  recurring_month int,
  recurring_day int,
  recurring_duration_days int,

  target_grade varchar(10) NOT NULL DEFAULT 'ALL',
  target_branch_id uuid REFERENCES branches(id),

  solapi_template_id varchar(100),
  template_content text,
  template_variables jsonb DEFAULT '[]'::jsonb,
  variable_overrides jsonb DEFAULT '{}'::jsonb,

  auto_send boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','SENT','COMPLETED','CANCELLED')),
  sent_at timestamptz,
  sent_count int DEFAULT 0,
  failed_count int DEFAULT 0,

  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nc_status ON notification_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_nc_dates ON notification_campaigns(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_nc_event_type ON notification_campaigns(event_type);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nc_updated_at ON notification_campaigns;
CREATE TRIGGER trg_nc_updated_at
BEFORE UPDATE ON notification_campaigns
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE notification_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nc_all ON notification_campaigns;
CREATE POLICY nc_all ON notification_campaigns FOR ALL USING (true) WITH CHECK (true);

INSERT INTO screen_permissions (role, screen_path, can_view, can_edit) VALUES
  ('SUPER_ADMIN',    '/customers', true, true),
  ('HQ_OPERATOR',    '/customers', true, true),
  ('EXECUTIVE',      '/customers', true, false),
  ('PHARMACY_STAFF', '/customers', true, true),
  ('BRANCH_STAFF',   '/customers', true, true)
ON CONFLICT DO NOTHING;
