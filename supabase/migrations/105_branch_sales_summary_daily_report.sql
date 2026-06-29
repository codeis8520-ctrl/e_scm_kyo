-- ═════════════════════════════════════════════════════════════════════════
-- 105_branch_sales_summary_daily_report: 지점별 매출에 승인 판매일보 합산 (#76)
--
-- 배경(PO 결정): 백화점 지점은 POS 건별 입력 없이 '판매일보'로만 매출을 기록한다.
--   따라서 일보 승인 매출을 지점별 매출(branch_sales_summary)에 '추가 합산'한다.
--   백화점은 POS(b)로 이중입력하지 않으므로 중복 없음(운영 규칙). 미승인/초안은 제외.
--   적용 시점 일보 daily_total=0(검토 단계) → 즉시 수치영향 0, 가동 시 자동 반영.
--
-- 변경: 081의 RPC에 (c) 판매일보 UNION 한 절 추가. (a)레거시·(b)현행 POS 로직은 무변경.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.branch_sales_summary(p_from date, p_to date, p_grain text DEFAULT 'month'::text)
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

    UNION ALL

    -- (c) 판매일보(#76): 승인된 일보의 일매출(현장+택배). report_date=KST 일자.
    --     백화점은 POS(b) 건별 입력을 하지 않으므로 (b)와 중복 없음(운영 규칙). 초안/제출만은 제외.
    SELECT
      dsr.report_date                AS kst_date,
      dsr.branch_id                  AS branch_id,
      COALESCE(dsr.daily_total, 0)   AS total_amount
    FROM daily_sales_reports dsr
    WHERE dsr.status = 'APPROVED'
      AND dsr.report_date BETWEEN p_from AND p_to
  )
  SELECT
    date_trunc(p_grain, u.kst_date::timestamp)::date AS period_date,
    u.branch_id                                      AS branch_id,
    SUM(u.total_amount)                              AS total
  FROM unified u
  GROUP BY 1, u.branch_id;
END;
$function$;
