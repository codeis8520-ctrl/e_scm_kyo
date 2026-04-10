-- 거래처별 제품 납품 단가
SET search_path TO public;

CREATE TABLE IF NOT EXISTS b2b_partner_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES b2b_partners(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  unit_price numeric(12,0) NOT NULL,
  discount_rate numeric(5,2),          -- 정가 대비 할인율 (참고용, 자동 계산)
  effective_from date DEFAULT CURRENT_DATE,
  memo text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(partner_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_bpp_partner ON b2b_partner_prices(partner_id);

ALTER TABLE b2b_partner_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY bpp_all ON b2b_partner_prices FOR ALL USING (true) WITH CHECK (true);
