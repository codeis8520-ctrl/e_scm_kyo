-- ═════════════════════════════════════════════════════════════════════════
-- 100_legacy_sales_summary_comma_and: 레거시 요약 RPC 검색을 콤마-AND로 정렬
--
-- 배경:
--   레거시 목록 검색이 기존 판매현황/customers 검색처럼 콤마-AND 로 동작한다.
--   요약카드(건수·합계)도 목록과 같은 결과여야 하므로 legacy_sales_summary(099)의
--   p_search 처리를 동일 콤마-AND 규칙으로 재정의(CREATE OR REPLACE).
--   시그니처 불변: legacy_sales_summary(p_start date, p_end date, p_search text).
--
-- 콤마-AND 규칙 (UI 목록 쿼리와 canonical 동일):
--   · tokens = split(p_search, ',') 각 trim, 빈 토큰 제외.
--   · 토큰 0개 → 검색조건 없음(기간만).
--   · 각 토큰 AND: 토큰별 (recipient_name|recipient_phone|phone ILIKE %tok%).
--   · LIKE 메타문자(% _ \) ESCAPE 리터럴화.
--
-- 구현 주의(NULL 안전):
--   recipient_name/phone 등이 NULL 인 행이 많다. `NOT(a OR b OR c)` 는 피연산자가
--   NULL 이면 결과가 NULL → WHERE 에서 토큰이 "불일치"로 안 잡혀 행이 잘못 통과.
--   → 토큰별 매칭을 COALESCE(..., false) 로 3-valued→2-valued 화한 뒤,
--     "매칭된 토큰 수 = 전체 토큰 수" 인 행만 채택(모든 토큰 AND).
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE OR REPLACE FUNCTION legacy_sales_summary(
  p_start  date,
  p_end    date,
  p_search text DEFAULT ''
)
RETURNS TABLE(cnt bigint, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  pats text[];  -- 정규화된 ILIKE 패턴 배열(토큰별 '%esc%')
  ntok int;
BEGIN
  -- 콤마 분리 → trim → 빈 토큰 제거 → LIKE 메타문자 이스케이프 → '%..%' 패턴.
  SELECT array_agg(
           '%' || replace(replace(replace(t, '\', '\'), '%', '\%'), '_', '\_') || '%'
         )
    INTO pats
  FROM (
    SELECT btrim(tok) AS t
    FROM unnest(string_to_array(coalesce(p_search, ''), ',')) AS tok
  ) x
  WHERE NULLIF(x.t, '') IS NOT NULL;

  ntok := COALESCE(array_length(pats, 1), 0);

  RETURN QUERY
  SELECT
    COUNT(*)::bigint                           AS cnt,
    COALESCE(SUM(lo.total_amount), 0)::numeric AS total
  FROM legacy_orders lo
  WHERE lo.ordered_at BETWEEN p_start AND p_end
    AND (
      ntok = 0   -- 토큰 0개 → 검색조건 없음
      OR (
        -- 모든 토큰이 매칭되어야 함: 매칭된 토큰 수 = 전체 토큰 수.
        SELECT COUNT(*)
        FROM unnest(pats) AS pat
        WHERE COALESCE(lo.recipient_name  ILIKE pat ESCAPE '\', false)
           OR COALESCE(lo.recipient_phone ILIKE pat ESCAPE '\', false)
           OR COALESCE(lo.phone           ILIKE pat ESCAPE '\', false)
      ) = ntok
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION legacy_sales_summary(date, date, text) TO anon, authenticated;
