-- ═════════════════════════════════════════════════════════════════════════
-- 084_branch_sales_summary_net: 지점별 매출 집계를 '최종 결제금액' 기준으로 통일 (#18)
--
-- 배경:
--   판매현황의 모든 매출 금액을 할인·포인트·쿠폰 구분 없이 '고객이 실제 결제한
--   총 결제금액' 하나로 통일한다(자사몰/오프라인/지점 동일 기준).
--
--   sales_orders.total_amount 규약:
--     · POS/백화점/cafe24 웹훅 = 상품총액(할인 전, gross) 저장, discount_amount=할인.
--     · 따라서 실결제(net) = total_amount − discount_amount.
--   legacy_orders.total_amount:
--     · 과거 실매출(이미 net), discount 컬럼 없음 → 그대로 사용.
--
--   081 RPC는 sales_orders.total_amount(gross)를 그대로 합산해 할인 건을 과대계상했다.
--   본 마이그는 sales 측만 (total_amount − COALESCE(discount_amount,0))로 교체한다.
--   legacy 측·시간대·period_date 포맷·미매칭(NULL branch) 보존 정책은 081 그대로 유지.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE OR REPLACE FUNCTION branch_sales_summary(
  p_from date,
  p_to   date,
  p_grain text DEFAULT 'month'
)
RETURNS TABLE(period_date date, branch_id uuid, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  cutoff CONSTANT date := DATE '2026-05-19';
BEGIN
  IF p_grain NOT IN ('day', 'month', 'year') THEN
    RAISE EXCEPTION 'invalid grain: % (allowed: day, month, year)', p_grain;
  END IF;

  RETURN QUERY
  WITH unified AS (
    -- (a) 레거시: ordered_at = DATE(이미 KST 일자). total_amount 이미 net(할인 컬럼 없음).
    SELECT
      lo.ordered_at::date            AS kst_date,
      lo.branch_id                   AS branch_id,
      lo.total_amount                AS total_amount
    FROM legacy_orders lo
    WHERE lo.ordered_at < cutoff
      AND lo.ordered_at::date BETWEEN p_from AND p_to

    UNION ALL

    -- (b) 현행: KST 일자 정규화. 매출 = total_amount − 할인 = 최종 결제금액(#18).
    SELECT
      (so.ordered_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date,
      so.branch_id                                    AS branch_id,
      (so.total_amount - COALESCE(so.discount_amount, 0)) AS total_amount
    FROM sales_orders so
    WHERE (so.ordered_at AT TIME ZONE 'Asia/Seoul')::date >= cutoff
      AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
      AND (so.ordered_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  )
  SELECT
    date_trunc(p_grain, u.kst_date::timestamp)::date AS period_date,
    u.branch_id                                      AS branch_id,
    SUM(u.total_amount)                              AS total
  FROM unified u
  GROUP BY 1, u.branch_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION branch_sales_summary(date, date, text) TO anon, authenticated;
