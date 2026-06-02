-- ═══════════════════════════════════════════════════════════════
-- 073_customer_search_comma_and
-- 고객 검색 RPC 를 콤마(,) 구분 AND 검색으로.
-- "이장우, 청담" → 각 토큰을 (name/phone/phone2/email/address/구매제품) 어디든 OR 매칭,
--   토큰끼리는 AND(모든 토큰 만족 고객만). 토큰 1개면 기존(040/072)과 동일.
-- search_customers_full(메인) + search_customers_unified(보조) 둘 다 갱신.
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- ─────────────────────────────────────────────────
-- 메인 검색 (모든 매칭 사유 포함, 콤마 AND)
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_customers_full(
  search_query text,
  grade_filter text DEFAULT NULL,
  branch_filter uuid DEFAULT NULL,
  page_offset int DEFAULT 0,
  page_limit int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  tokens text[];
  ntok int;
BEGIN
  -- 콤마 분리 → 토큰 trim·중복제거·빈값제외. 빈 검색어면 단일 빈토큰('')=전체 매칭(등급/지점 필터만 적용).
  tokens := array(SELECT DISTINCT btrim(t) FROM unnest(string_to_array(search_query, ',')) AS t WHERE btrim(t) <> '');
  IF tokens IS NULL OR array_length(tokens, 1) IS NULL THEN
    tokens := ARRAY[''];
  END IF;
  ntok := array_length(tokens, 1);

  WITH
  -- 토큰 × 필드 매칭 (등급/지점 필터 적용)
  token_field AS (
    SELECT c.id AS customer_id, t.tok, x.field, x.val
    FROM customers c
    CROSS JOIN unnest(tokens) AS t(tok)
    CROSS JOIN LATERAL (VALUES
      ('name', CASE WHEN c.name ILIKE '%' || t.tok || '%' THEN c.name END),
      ('phone', CASE WHEN c.phone ILIKE '%' || t.tok || '%'
                      OR (length(regexp_replace(t.tok,'[^0-9]','','g')) >= 3
                          AND regexp_replace(c.phone,'[^0-9]','','g') ILIKE '%' || regexp_replace(t.tok,'[^0-9]','','g') || '%')
                     THEN c.phone END),
      ('phone', CASE WHEN c.phone2 ILIKE '%' || t.tok || '%'
                      OR (length(regexp_replace(t.tok,'[^0-9]','','g')) >= 3
                          AND regexp_replace(c.phone2,'[^0-9]','','g') ILIKE '%' || regexp_replace(t.tok,'[^0-9]','','g') || '%')
                     THEN c.phone2 END),
      ('email', CASE WHEN c.email ILIKE '%' || t.tok || '%' THEN c.email END),
      ('address', CASE WHEN c.address ILIKE '%' || t.tok || '%' THEN left(c.address, 40) END)
    ) AS x(field, val)
    WHERE x.val IS NOT NULL
      AND (grade_filter IS NULL OR c.grade = grade_filter)
      AND (branch_filter IS NULL OR c.primary_branch_id = branch_filter)
  ),
  -- 토큰 × 구매제품 매칭
  token_product AS (
    SELECT so.customer_id, t.tok, 'product'::text AS field, p.name AS val
    FROM unnest(tokens) AS t(tok)
    JOIN products p ON p.name ILIKE '%' || t.tok || '%'
    JOIN sales_order_items soi ON soi.product_id = p.id
    JOIN sales_orders so ON so.id = soi.sales_order_id
    WHERE so.customer_id IS NOT NULL
  ),
  all_tok AS (
    SELECT customer_id, tok, field, val FROM token_field
    UNION ALL
    SELECT customer_id, tok, field, val FROM token_product
  ),
  -- 모든 토큰을 만족(AND)한 고객만
  qualified AS (
    SELECT customer_id
    FROM all_tok
    GROUP BY customer_id
    HAVING count(DISTINCT tok) >= ntok
  ),
  merged AS (
    SELECT a.customer_id,
      jsonb_agg(DISTINCT jsonb_build_object('field', a.field, 'value', a.val)) AS all_reasons
    FROM all_tok a
    JOIN qualified q ON q.customer_id = a.customer_id
    GROUP BY a.customer_id
  ),
  filtered AS (
    SELECT c.id, c.name, c.phone, c.phone2, c.email, c.address, c.grade, c.is_active,
           c.created_at,
           b.name AS branch_name,
           m.all_reasons,
           ph.balance AS total_points
    FROM qualified q
    JOIN customers c ON c.id = q.customer_id
    LEFT JOIN merged m ON m.customer_id = c.id
    LEFT JOIN branches b ON b.id = c.primary_branch_id
    LEFT JOIN LATERAL (
      SELECT balance FROM point_history
      WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1
    ) ph ON true
    WHERE (grade_filter IS NULL OR c.grade = grade_filter)
      AND (branch_filter IS NULL OR c.primary_branch_id = branch_filter)
    ORDER BY c.created_at DESC
  ),
  total_count AS (SELECT count(*) AS cnt FROM filtered)
  SELECT jsonb_build_object(
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'phone', f.phone, 'phone2', f.phone2, 'email', f.email,
        'address', f.address, 'grade', f.grade, 'is_active', f.is_active,
        'primary_branch', jsonb_build_object('name', f.branch_name),
        'total_points', COALESCE(f.total_points, 0),
        'match_reasons', COALESCE(f.all_reasons, '[]'::jsonb)
      ))
      FROM (SELECT * FROM filtered OFFSET page_offset LIMIT page_limit) f
    ), '[]'::jsonb),
    'total', (SELECT cnt FROM total_count),
    'page', (page_offset / page_limit) + 1
  ) INTO result;

  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────
-- 보조 검색 (단일 사유, 콤마 AND 동일 적용)
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_customers_unified(
  search_query text,
  grade_filter text DEFAULT NULL,
  branch_filter uuid DEFAULT NULL,
  page_offset int DEFAULT 0,
  page_limit int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  tokens text[];
  ntok int;
BEGIN
  tokens := array(SELECT DISTINCT btrim(t) FROM unnest(string_to_array(search_query, ',')) AS t WHERE btrim(t) <> '');
  IF tokens IS NULL OR array_length(tokens, 1) IS NULL THEN
    tokens := ARRAY[''];
  END IF;
  ntok := array_length(tokens, 1);

  WITH
  token_field AS (
    SELECT c.id AS customer_id, t.tok, x.field, x.val, x.prio
    FROM customers c
    CROSS JOIN unnest(tokens) AS t(tok)
    CROSS JOIN LATERAL (VALUES
      ('name', CASE WHEN c.name ILIKE '%' || t.tok || '%' THEN c.name END, 1),
      ('phone', CASE WHEN c.phone ILIKE '%' || t.tok || '%'
                      OR (length(regexp_replace(t.tok,'[^0-9]','','g')) >= 3
                          AND regexp_replace(c.phone,'[^0-9]','','g') ILIKE '%' || regexp_replace(t.tok,'[^0-9]','','g') || '%')
                     THEN c.phone END, 2),
      ('phone', CASE WHEN c.phone2 ILIKE '%' || t.tok || '%'
                      OR (length(regexp_replace(t.tok,'[^0-9]','','g')) >= 3
                          AND regexp_replace(c.phone2,'[^0-9]','','g') ILIKE '%' || regexp_replace(t.tok,'[^0-9]','','g') || '%')
                     THEN c.phone2 END, 2),
      ('email', CASE WHEN c.email ILIKE '%' || t.tok || '%' THEN c.email END, 3),
      ('address', CASE WHEN c.address ILIKE '%' || t.tok || '%' THEN left(c.address, 40) END, 4)
    ) AS x(field, val, prio)
    WHERE x.val IS NOT NULL
      AND (grade_filter IS NULL OR c.grade = grade_filter)
      AND (branch_filter IS NULL OR c.primary_branch_id = branch_filter)
  ),
  token_product AS (
    SELECT so.customer_id, t.tok, 'product'::text AS field, p.name AS val, 5 AS prio
    FROM unnest(tokens) AS t(tok)
    JOIN products p ON p.name ILIKE '%' || t.tok || '%'
    JOIN sales_order_items soi ON soi.product_id = p.id
    JOIN sales_orders so ON so.id = soi.sales_order_id
    WHERE so.customer_id IS NOT NULL
  ),
  all_tok AS (
    SELECT customer_id, tok, field, val, prio FROM token_field
    UNION ALL
    SELECT customer_id, tok, field, val, prio FROM token_product
  ),
  qualified AS (
    SELECT customer_id
    FROM all_tok
    GROUP BY customer_id
    HAVING count(DISTINCT tok) >= ntok
  ),
  best_reason AS (
    SELECT DISTINCT ON (a.customer_id) a.customer_id, a.field, a.val
    FROM all_tok a
    JOIN qualified q ON q.customer_id = a.customer_id
    ORDER BY a.customer_id, a.prio
  ),
  filtered AS (
    SELECT c.id, c.name, c.phone, c.phone2, c.email, c.address, c.grade, c.is_active,
           b.name AS branch_name,
           br.field AS match_field, br.val AS match_value,
           ph.balance AS total_points
    FROM qualified q
    JOIN customers c ON c.id = q.customer_id
    LEFT JOIN best_reason br ON br.customer_id = c.id
    LEFT JOIN branches b ON b.id = c.primary_branch_id
    LEFT JOIN LATERAL (
      SELECT balance FROM point_history
      WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1
    ) ph ON true
    WHERE (grade_filter IS NULL OR c.grade = grade_filter)
      AND (branch_filter IS NULL OR c.primary_branch_id = branch_filter)
    ORDER BY c.created_at DESC
  ),
  total_count AS (SELECT count(*) AS cnt FROM filtered)
  SELECT jsonb_build_object(
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'phone', f.phone, 'phone2', f.phone2, 'email', f.email,
        'address', f.address, 'grade', f.grade, 'is_active', f.is_active,
        'primary_branch', jsonb_build_object('name', f.branch_name),
        'total_points', COALESCE(f.total_points, 0),
        'match_reasons', jsonb_build_array(jsonb_build_object(
          'field', f.match_field, 'value', f.match_value
        ))
      ))
      FROM (SELECT * FROM filtered OFFSET page_offset LIMIT page_limit) f
    ), '[]'::jsonb),
    'total', (SELECT cnt FROM total_count),
    'page', (page_offset / page_limit) + 1
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION search_customers_unified TO anon, authenticated;
GRANT EXECUTE ON FUNCTION search_customers_full TO anon, authenticated;
