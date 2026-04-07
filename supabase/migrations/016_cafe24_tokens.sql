CREATE TABLE IF NOT EXISTS cafe24_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mall_id VARCHAR(100) NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  refresh_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  scopes TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE cafe24_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe24_tokens_all ON cafe24_tokens FOR ALL TO authenticated USING (true);
