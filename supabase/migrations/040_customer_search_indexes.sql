-- ═══════════════════════════════════════════════════════════════
-- 고객 통합 검색 성능 최적화
-- pg_trgm GIN 인덱스 + 검색 전용 RPC
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- pg_trgm 확장 (ILIKE '%text%' 검색을 인덱스로 가속)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 고객 텍스트 검색 인덱스 (GIN trigram)
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm
  ON customers USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_address_trgm
  ON customers USING gin (address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_email_trgm
  ON customers USING gin (email gin_trgm_ops);

-- 제품명 검색 인덱스
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);

-- 제품 검색 조인용 (sales_order_items.product_id)
CREATE INDEX IF NOT EXISTS idx_soi_product_id
  ON sales_order_items (product_id);

-- cafe24_member_id 조회 (회원 동기화 시 upsert)
CREATE INDEX IF NOT EXISTS idx_customers_cafe24_member
  ON customers (cafe24_member_id) WHERE cafe24_member_id IS NOT NULL;

-- 포인트 조회 최적화 (customer_id + created_at DESC로 최신 balance 빠르게)
CREATE INDEX IF NOT EXISTS idx_point_history_customer_latest
  ON point_history (customer_id, created_at DESC);

-- ─────────────────────────────────────────────────
-- 통합 검색 RPC: 단일 DB 라운드트립으로 검색 완료
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
  -- 숫자만 추출 (전화번호 뒷자리 검색용)
  digits_only := regexp_replace(search_query, '[^0-9]', '', 'g');

  WITH
  -- 1) 직접 필드 매칭
  direct_matches AS (
    SELECT DISTINCT c.id, c.name, c.phone, c.email, c.address,
           c.grade, c.is_active, c.primary_branch_id,
           CASE
             WHEN c.name ILIKE '%' || search_query || '%' THEN 'name'
             WHEN c.phone ILIKE '%' || search_query || '%' THEN 'phone'
             WHEN length(digits_only) >= 3
                  AND regexp_replace(c.phone, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%' THEN 'phone'
             WHEN c.email ILIKE '%' || search_query || '%' THEN 'email'
             WHEN c.address ILIKE '%' || search_query || '%' THEN 'address'
           END AS match_field,
           CASE
             WHEN c.name ILIKE '%' || search_query || '%' THEN c.name
             WHEN c.phone ILIKE '%' || search_query || '%' THEN c.phone
             WHEN length(digits_only) >= 3
                  AND regexp_replace(c.phone, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%' THEN c.phone
             WHEN c.email ILIKE '%' || search_query || '%' THEN c.email
             WHEN c.address ILIKE '%' || search_query || '%' THEN left(c.address, 40)
           END AS match_value
    FROM customers c
    WHERE (
      c.name ILIKE '%' || search_query || '%'
      OR c.phone ILIKE '%' || search_query || '%'
      OR (length(digits_only) >= 3
          AND regexp_replace(c.phone, '[^0-9]', '', 'g') ILIKE '%' || digits_only || '%')
      OR c.email ILIKE '%' || search_query || '%'
      OR c.address ILIKE '%' || search_query || '%'
    )
    AND (grade_filter IS NULL OR c.grade = grade_filter)
    AND (branch_filter IS NULL OR c.primary_branch_id = branch_filter)
  ),
  -- 2) 구매 제품 매칭
  product_matches AS (
    SELECT DISTINCT so.customer_id AS id, p.name AS match_value
    FROM products p
    JOIN sales_order_items soi ON soi.product_id = p.id
    JOIN sales_orders so ON so.id = soi.sales_order_id
    WHERE p.name ILIKE '%' || search_query || '%'
      AND so.customer_id IS NOT NULL
  ),
  -- 3) 합치기
  all_matches AS (
    SELECT id, match_field, match_value, 1 AS priority FROM direct_matches
    UNION ALL
    SELECT pm.id, 'product'::text, pm.match_value, 2
    FROM product_matches pm
    WHERE NOT EXISTS (SELECT 1 FROM direct_matches dm WHERE dm.id = pm.id AND dm.match_field = 'product')
  ),
  -- 4) 고객별 첫 번째 매칭 사유
  unique_customers AS (
    SELECT DISTINCT ON (am.id)
      am.id, am.match_field, am.match_value, am.priority
    FROM all_matches am
    ORDER BY am.id, am.priority
  ),
  -- 5) 필터링된 고객 정보
  filtered AS (
    SELECT c.id, c.name, c.phone, c.email, c.address, c.grade, c.is_active,
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
  -- 6) 총 개수
  total_count AS (
    SELECT count(*) AS cnt FROM filtered
  )
  SELECT jsonb_build_object(
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'phone', f.phone,
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

-- 모든 매칭 사유를 포함하는 버전 (메인 검색용)
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
    SELECT c.id, c.name, c.phone, c.email, c.address, c.grade, c.is_active,
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
        'id', f.id, 'name', f.name, 'phone', f.phone, 'email', f.email,
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

GRANT EXECUTE ON FUNCTION search_customers_unified TO anon, authenticated;
GRANT EXECUTE ON FUNCTION search_customers_full TO anon, authenticated;
