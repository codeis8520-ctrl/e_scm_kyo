-- ═══════════════════════════════════════════════════════════════
-- 072_customer_search_phone2
-- 고객 검색 RPC(040)에 phone2(전화번호2) 매칭 추가.
-- search_customers_full(메인) + search_customers_unified(보조) 둘 다 갱신.
-- 040 본문 그대로 + phone2 ILIKE/숫자 매칭 추가. 출력 jsonb 에 phone2 포함.
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- phone2 trigram 인덱스 (phone 과 동일)
CREATE INDEX IF NOT EXISTS idx_customers_phone2_trgm
  ON customers USING gin (phone2 gin_trgm_ops);

-- ─────────────────────────────────────────────────
-- 메인 검색 (모든 매칭 사유 포함)
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
  digits_only text;
BEGIN
  digits_only := regexp_replace(search_query, '[^0-9]', '', 'g');

  WITH
  direct_matches AS (
    SELECT c.id,
      jsonb_agg(DISTINCT jsonb_build_object(
        'field', x.field, 'value', x.val
      )) AS reasons
    FROM customers c,
    LATERAL (VALUES
      ('name', CASE WHEN c.name ILIKE '%' || search_query || '%' THEN c.name END),
      ('phone', CASE WHEN c.phone ILIKE '%' || search_query || '%'
                      OR (length(digits_only) >= 3 AND regexp_replace(c.phone, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%')
                     THEN c.phone END),
      ('phone', CASE WHEN c.phone2 ILIKE '%' || search_query || '%'
                      OR (length(digits_only) >= 3 AND regexp_replace(c.phone2, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%')
                     THEN c.phone2 END),
      ('email', CASE WHEN c.email ILIKE '%' || search_query || '%' THEN c.email END),
      ('address', CASE WHEN c.address ILIKE '%' || search_query || '%' THEN left(c.address, 40) END)
    ) AS x(field, val)
    WHERE x.val IS NOT NULL
      AND (grade_filter IS NULL OR c.grade = grade_filter)
      AND (branch_filter IS NULL OR c.primary_branch_id = branch_filter)
    GROUP BY c.id
  ),
  product_matches AS (
    SELECT DISTINCT so.customer_id AS id,
      jsonb_build_object('field', 'product', 'value', p.name) AS reason
    FROM products p
    JOIN sales_order_items soi ON soi.product_id = p.id
    JOIN sales_orders so ON so.id = soi.sales_order_id
    WHERE p.name ILIKE '%' || search_query || '%'
      AND so.customer_id IS NOT NULL
  ),
  combined AS (
    SELECT id, reasons FROM direct_matches
    UNION ALL
    SELECT id, jsonb_agg(reason) FROM product_matches GROUP BY id
  ),
  merged AS (
    SELECT c.id,
      (SELECT jsonb_agg(DISTINCT elem) FROM (
        SELECT jsonb_array_elements(reasons) AS elem FROM combined cm WHERE cm.id = c.id
      ) sub) AS all_reasons
    FROM (SELECT DISTINCT id FROM combined) c
  ),
  filtered AS (
    SELECT c.id, c.name, c.phone, c.phone2, c.email, c.address, c.grade, c.is_active,
           c.created_at,
           b.name AS branch_name,
           m.all_reasons,
           ph.balance AS total_points
    FROM merged m
    JOIN customers c ON c.id = m.id
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
-- 보조 검색 (단일 사유, 앱 미사용이나 일관성 위해 동일 갱신)
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
  digits_only text;
BEGIN
  digits_only := regexp_replace(search_query, '[^0-9]', '', 'g');

  WITH
  direct_matches AS (
    SELECT DISTINCT c.id, c.name, c.phone, c.email, c.address,
           c.grade, c.is_active, c.primary_branch_id,
           CASE
             WHEN c.name ILIKE '%' || search_query || '%' THEN 'name'
             WHEN c.phone ILIKE '%' || search_query || '%' THEN 'phone'
             WHEN length(digits_only) >= 3
                  AND regexp_replace(c.phone, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%' THEN 'phone'
             WHEN c.phone2 ILIKE '%' || search_query || '%' THEN 'phone'
             WHEN length(digits_only) >= 3
                  AND regexp_replace(c.phone2, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%' THEN 'phone'
             WHEN c.email ILIKE '%' || search_query || '%' THEN 'email'
             WHEN c.address ILIKE '%' || search_query || '%' THEN 'address'
           END AS match_field,
           CASE
             WHEN c.name ILIKE '%' || search_query || '%' THEN c.name
             WHEN c.phone ILIKE '%' || search_query || '%' THEN c.phone
             WHEN length(digits_only) >= 3
                  AND regexp_replace(c.phone, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%' THEN c.phone
             WHEN c.phone2 ILIKE '%' || search_query || '%' THEN c.phone2
             WHEN length(digits_only) >= 3
                  AND regexp_replace(c.phone2, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%' THEN c.phone2
             WHEN c.email ILIKE '%' || search_query || '%' THEN c.email
             WHEN c.address ILIKE '%' || search_query || '%' THEN left(c.address, 40)
           END AS match_value
    FROM customers c
    WHERE (
      c.name ILIKE '%' || search_query || '%'
      OR c.phone ILIKE '%' || search_query || '%'
      OR (length(digits_only) >= 3
          AND regexp_replace(c.phone, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%')
      OR c.phone2 ILIKE '%' || search_query || '%'
      OR (length(digits_only) >= 3
          AND regexp_replace(c.phone2, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%')
      OR c.email ILIKE '%' || search_query || '%'
      OR c.address ILIKE '%' || search_query || '%'
    )
    AND (grade_filter IS NULL OR c.grade = grade_filter)
    AND (branch_filter IS NULL OR c.primary_branch_id = branch_filter)
  ),
  product_matches AS (
    SELECT DISTINCT so.customer_id AS id, p.name AS match_value
    FROM products p
    JOIN sales_order_items soi ON soi.product_id = p.id
    JOIN sales_orders so ON so.id = soi.sales_order_id
    WHERE p.name ILIKE '%' || search_query || '%'
      AND so.customer_id IS NOT NULL
  ),
  all_matches AS (
    SELECT id, match_field, match_value, 1 AS priority FROM direct_matches
    UNION ALL
    SELECT pm.id, 'product'::text, pm.match_value, 2
    FROM product_matches pm
    WHERE NOT EXISTS (SELECT 1 FROM direct_matches dm WHERE dm.id = pm.id AND dm.match_field = 'product')
  ),
  unique_customers AS (
    SELECT DISTINCT ON (am.id)
      am.id, am.match_field, am.match_value, am.priority
    FROM all_matches am
    ORDER BY am.id, am.priority
  ),
  filtered AS (
    SELECT c.id, c.name, c.phone, c.phone2, c.email, c.address, c.grade, c.is_active,
           b.name AS branch_name,
           uc.match_field, uc.match_value,
           ph.balance AS total_points
    FROM unique_customers uc
    JOIN customers c ON c.id = uc.id
    LEFT JOIN branches b ON b.id = c.primary_branch_id
    LEFT JOIN LATERAL (
      SELECT balance FROM point_history
      WHERE customer_id = c.id
      ORDER BY created_at DESC LIMIT 1
    ) ph ON true
    WHERE (grade_filter IS NULL OR c.grade = grade_filter)
      AND (branch_filter IS NULL OR c.primary_branch_id = branch_filter)
    ORDER BY c.created_at DESC
  ),
  total_count AS (
    SELECT count(*) AS cnt FROM filtered
  )
  SELECT jsonb_build_object(
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'phone', f.phone,
        'phone2', f.phone2,
        'email', f.email,
        'address', f.address,
        'grade', f.grade,
        'is_active', f.is_active,
        'primary_branch', jsonb_build_object('name', f.branch_name),
        'total_points', COALESCE(f.total_points, 0),
        'match_reasons', jsonb_build_array(jsonb_build_object(
          'field', f.match_field,
          'value', f.match_value
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
