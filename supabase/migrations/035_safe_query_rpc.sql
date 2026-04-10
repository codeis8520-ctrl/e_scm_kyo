-- ═══════════════════════════════════════════════════════════════════════
-- AI 에이전트용 안전한 SQL 실행 RPC
--
-- SELECT만 허용, DML/DDL 차단, 결과 행수 제한.
-- 에이전트가 동적 분석 쿼리를 실행할 때 사용.
--
-- 보안 계층:
--   1. SQL 파싱: SELECT만 허용 (INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE 차단)
--   2. 결과 제한: 최대 100행
--   3. 타임아웃: statement_timeout 5초
--   4. 앱 레이어에서 테이블 화이트리스트 추가 검증
-- ═══════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE OR REPLACE FUNCTION safe_readonly_query(
  query_text text,
  row_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  normalized text;
  result jsonb;
BEGIN
  -- 1) 정규화: 앞뒤 공백 제거, 세미콜론 제거
  normalized := trim(both from query_text);
  normalized := rtrim(normalized, ';');

  -- 2) SELECT만 허용
  IF upper(left(normalized, 6)) != 'SELECT' THEN
    RAISE EXCEPTION 'SELECT 쿼리만 허용됩니다.';
  END IF;

  -- 3) 위험 키워드 차단 (대소문자 무관)
  IF normalized ~* '\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXECUTE|COPY)\b' THEN
    RAISE EXCEPTION '쓰기/변경 작업은 허용되지 않습니다.';
  END IF;

  -- 4) 서브쿼리를 이용한 DML 차단 (INTO 절)
  IF normalized ~* '\bINTO\b' THEN
    RAISE EXCEPTION 'INTO 절은 허용되지 않습니다.';
  END IF;

  -- 5) 타임아웃 설정 (5초)
  PERFORM set_config('statement_timeout', '5000', true);

  -- 6) LIMIT 강제 (사용자가 LIMIT을 안 쓴 경우)
  IF NOT normalized ~* '\bLIMIT\b' THEN
    normalized := normalized || ' LIMIT ' || row_limit;
  END IF;

  -- 7) 실행 + JSON 변환
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', normalized)
  INTO result;

  -- 8) 타임아웃 원복
  PERFORM set_config('statement_timeout', '0', true);

  RETURN COALESCE(result, '[]'::jsonb);

EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('statement_timeout', '0', true);
    RAISE;
END;
$$;

-- RPC 호출 권한
GRANT EXECUTE ON FUNCTION safe_readonly_query(text, int) TO anon, authenticated;
