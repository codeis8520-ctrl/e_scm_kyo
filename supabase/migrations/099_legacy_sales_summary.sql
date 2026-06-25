-- ═════════════════════════════════════════════════════════════════════════
-- 099_legacy_sales_summary: 레거시 판매 요약(건수+매출합계) RPC
--
-- 배경:
--   판매현황 '레거시' 뷰가 list 동형 요약카드(건수·합계)를 보여준다.
--   목록은 .range() 50건 페이징이라 페이지 합으로는 전체 매출을 못 낸다.
--   → 전체기간 정확한 건수·합계를 단일 RPC로 집계.
--
-- 필터 = 레거시 뷰 loadLegacy 와 동일 조건:
--   · 기간: ordered_at BETWEEN p_start AND p_end (legacy_orders.ordered_at = DATE, 이미 KST)
--   · 검색(p_search 비어있지 않으면): recipient_name / recipient_phone / phone ILIKE %search%
--     (앱 .or 와 동일 3필드. 빈 검색이면 전체.)
--
-- 반환: cnt(bigint) = 주문 건수, total(numeric) = total_amount 합.
--   행이 0건이어도 cnt=0, total=0 (COALESCE) — 단일 행 보장.
--
-- 보안: SECURITY DEFINER + GRANT EXECUTE to anon (064 RLS/GRANT 패턴, 커스텀 세션 = anon role).
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
  s text := NULLIF(btrim(coalesce(p_search, '')), '');
  pat text;
BEGIN
  -- ILIKE 패턴: 검색어 내 LIKE 메타문자(% _ \)를 리터럴로 이스케이프해 과매칭 방지.
  IF s IS NOT NULL THEN
    pat := '%' || replace(replace(replace(s, '\', '\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::bigint                         AS cnt,
    COALESCE(SUM(lo.total_amount), 0)::numeric AS total
  FROM legacy_orders lo
  WHERE lo.ordered_at BETWEEN p_start AND p_end
    AND (
      s IS NULL
      OR lo.recipient_name  ILIKE pat ESCAPE '\'
      OR lo.recipient_phone ILIKE pat ESCAPE '\'
      OR lo.phone           ILIKE pat ESCAPE '\'
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION legacy_sales_summary(date, date, text) TO anon, authenticated;
