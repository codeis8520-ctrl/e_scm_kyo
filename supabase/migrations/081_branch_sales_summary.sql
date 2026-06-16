-- ═════════════════════════════════════════════════════════════════════════
-- 081_branch_sales_summary: 지점별 매출 집계 RPC (레거시+현행 통합)
--
-- 배경:
--   매출 대시보드/리포트가 2026-05-19 컷오프 기준으로 legacy_orders(이전)와
--   sales_orders(이후)를 합쳐 기간·지점별 합계를 한 번에 보여줘야 한다.
--   앱에서 두 테이블을 따로 조회·병합하면 누락/중복 위험 → 단일 RPC로 통합.
--
-- 컷오프: 2026-05-19. 경계는 양측 모두 KST 캘린더 일자 기준.
--   legacy: ordered_at(DATE) < cutoff  /  sales: (ordered_at AT TIME ZONE Asia/Seoul)::date >= cutoff.
--   같은 KST 일자 경계에서 맞물려 누락·중복 모두 없음.
--
-- 시간대 정책 (KST):
--   · legacy_orders.ordered_at = DATE (이미 KST 일자, 타임존 없음) → 그대로 사용.
--   · sales_orders.ordered_at  = timestamptz → (AT TIME ZONE 'Asia/Seoul')로
--     KST 벽시계 날짜로 정규화. 필터(BETWEEN)와 절단(date_trunc) 모두 동일 적용.
--   앱의 kstDayStart/End 와 동일한 KST 기준 일자 처리.
--
-- period_date 포맷 — 절대 변경 금지:
--   period_date = date_trunc(p_grain, <kst_date>)::date
--   → month=YYYY-MM-01, year=YYYY-01-01, day=해당일.
--   Bob의 라벨 포매터가 date 문자열 prefix를 슬라이스하므로 이 정확한 포맷 필수.
--
-- 미매칭(branch_id NULL) 행도 보존(GROUP BY 에 포함) — 지점 미매핑 매출 가시화.
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
  -- 그레인 화이트리스트 가드 (SQL injection 방지 + date_trunc 안전)
  IF p_grain NOT IN ('day', 'month', 'year') THEN
    RAISE EXCEPTION 'invalid grain: % (allowed: day, month, year)', p_grain;
  END IF;

  RETURN QUERY
  WITH unified AS (
    -- (a) 레거시: ordered_at = DATE, 이미 KST 일자. 타임존 변환 불필요.
    SELECT
      lo.ordered_at::date            AS kst_date,
      lo.branch_id                   AS branch_id,
      lo.total_amount                AS total_amount
    FROM legacy_orders lo
    WHERE lo.ordered_at < cutoff
      AND lo.ordered_at::date BETWEEN p_from AND p_to

    UNION ALL

    -- (b) 현행: ordered_at = timestamptz → KST 벽시계 일자로 정규화.
    SELECT
      (so.ordered_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date,
      so.branch_id                                    AS branch_id,
      so.total_amount                                 AS total_amount
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
  GROUP BY 1, u.branch_id;  -- NULL branch_id 행도 그룹으로 보존(미매칭)
END;
$function$;

GRANT EXECUTE ON FUNCTION branch_sales_summary(date, date, text) TO anon, authenticated;
