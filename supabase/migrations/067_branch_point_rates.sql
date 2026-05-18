-- ═════════════════════════════════════════════════════════════════════════
-- 067_branch_point_rates: 지점×고객등급 적립율 매트릭스
--
-- 배경:
--   기존 적립율은 customer_grades.point_rate 한 곳에서만 결정되어
--   "지점/채널마다 다른 적립율"을 적용할 수 없었음.
--   예) 오프라인 매장은 NORMAL 1.5%·VIP 2.5%, 온라인몰은 모두 0.5%
--   고객의 primary_branch_id 와 무관하게, "실제 구매가 발생한 지점"
--   기준으로 적립율을 적용한다 (sales_orders.branch_id).
--
-- 정책:
--   · (branch_id, grade_id) 매트릭스 형태. UNIQUE 보장.
--   · 매칭되는 활성 row 가 있으면 그 point_rate 사용,
--     없거나 is_active=false 면 customer_grades.point_rate 로 폴백.
--   · 매트릭스 도입 후에도 등급 기본값(customer_grades.point_rate)은 유지 —
--     설정되지 않은 지점의 기본값으로 사용됨.
--   · 적립율 결정은 서버측(processPosCheckout)에서 재해결한다.
--     클라이언트가 보낸 rate 는 표시용이며, 서버는 매트릭스/등급을
--     다시 조회해 최종 적립을 계산한다.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS branch_point_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  grade_id    UUID NOT NULL REFERENCES customer_grades(id) ON DELETE CASCADE,
  point_rate  DECIMAL(5,2) NOT NULL DEFAULT 0.00 CHECK (point_rate >= 0 AND point_rate <= 100),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (branch_id, grade_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_point_rates_lookup
  ON branch_point_rates (branch_id, grade_id)
  WHERE is_active = TRUE;

COMMENT ON TABLE branch_point_rates IS
  '지점×고객등급 적립율 오버라이드. 행 없음/비활성이면 customer_grades.point_rate 사용.';
COMMENT ON COLUMN branch_point_rates.point_rate IS
  '해당 (지점,등급)에서 적용할 적립율(%). 0=무적립, 등급 기본보다 낮거나 높을 수 있음.';
COMMENT ON COLUMN branch_point_rates.is_active IS
  'false 이면 오버라이드 비적용 → 등급 기본값 사용.';

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_branch_point_rates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branch_point_rates_updated_at ON branch_point_rates;
CREATE TRIGGER trg_branch_point_rates_updated_at
  BEFORE UPDATE ON branch_point_rates
  FOR EACH ROW EXECUTE FUNCTION update_branch_point_rates_updated_at();
