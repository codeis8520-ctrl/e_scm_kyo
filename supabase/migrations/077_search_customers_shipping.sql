-- ═══════════════════════════════════════════════════════════════════════════
-- 077_search_customers_shipping
--
-- 고객 검색(search_customers_full)에 "발송지(수령자)" 매칭 추가.
-- 기존: 고객 본인 필드(name/phone/phone2/email/address) + 구매제품 토큰 매칭.
-- 추가: 과거구매(legacy_orders) + 구매이력 배송(shipments)의 수령자
--       이름/전화/주소를 토큰 매칭 → 콤마 AND 검색에 발송지도 포함.
--   예) "곽광의, 파주"  → 이름=곽광의 + 어느 발송지든 주소에 '파주' 포함 고객.
--
-- 성능: legacy_orders 47k행 → recipient_name/address/phone(정규화) trigram GIN 인덱스.
--       shipments 는 소량(수십~수백)이라 인덱스 불필요.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 발송지 trigram 인덱스 (ILIKE '%..%' 가속) ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lo_recipient_name_trgm
  ON legacy_orders USING gin (recipient_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lo_recipient_address_trgm
  ON legacy_orders USING gin (recipient_address gin_trgm_ops);
-- 전화는 정규화(숫자만) 함수식 인덱스 — 쿼리식과 정확히 일치해야 사용됨
CREATE INDEX IF NOT EXISTS idx_lo_recipient_phone_trgm
  ON legacy_orders USING gin ((regexp_replace(coalesce(recipient_phone,''),'[^0-9]','','g')) gin_trgm_ops);

-- 새 인덱스 통계 갱신(플래너가 3자+ 검색에서 trigram 인덱스를 즉시 사용하도록)
ANALYZE legacy_orders;

-- ── 검색 함수 교체 (token_shipping CTE 추가) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_customers_full(
  search_query text,
  grade_filter text DEFAULT NULL::text,
  branch_filter uuid DEFAULT NULL::uuid,
  page_offset integer DEFAULT 0,
  page_limit integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
  tokens text[];
  ntok int;
BEGIN
  -- 콤마 분리 → 토큰 trim·중복제거·빈값제외. 빈 검색어면 단일 빈토큰('')=전체 매칭.
  tokens := array(SELECT DISTINCT btrim(t) FROM unnest(string_to_array(search_query, ',')) AS t WHERE btrim(t) <> '');
  IF tokens IS NULL OR array_length(tokens, 1) IS NULL THEN
    tokens := ARRAY[''];
  END IF;
  ntok := array_length(tokens, 1);

  WITH
  -- 토큰 × 고객 본인 필드
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
  -- 토큰 × 구매제품
  token_product AS (
    SELECT so.customer_id, t.tok, 'product'::text AS field, p.name AS val
    FROM unnest(tokens) AS t(tok)
    JOIN products p ON p.name ILIKE '%' || t.tok || '%'
    JOIN sales_order_items soi ON soi.product_id = p.id
    JOIN sales_orders so ON so.id = soi.sales_order_id
    WHERE so.customer_id IS NOT NULL
  ),
  -- 토큰 × 발송지(수령자) — 과거구매(legacy_orders) + 구매이력 배송(shipments)
  token_shipping AS (
    SELECT lo.customer_id, t.tok, 'shipping'::text AS field,
           left(btrim(coalesce(lo.recipient_name,'') || ' ' || coalesce(lo.recipient_address,'')), 40) AS val
    FROM unnest(tokens) AS t(tok)
    JOIN legacy_orders lo ON lo.customer_id IS NOT NULL
    WHERE t.tok <> ''
      AND ( lo.recipient_name ILIKE '%' || t.tok || '%'
         OR lo.recipient_address ILIKE '%' || t.tok || '%'
         OR ( length(regexp_replace(t.tok,'[^0-9]','','g')) >= 3
              AND regexp_replace(coalesce(lo.recipient_phone,''),'[^0-9]','','g')
                  ILIKE '%' || regexp_replace(t.tok,'[^0-9]','','g') || '%' ) )
    UNION ALL
    SELECT so.customer_id, t.tok, 'shipping'::text AS field,
           left(btrim(coalesce(s.recipient_name,'') || ' ' || coalesce(s.recipient_address,'')), 40) AS val
    FROM unnest(tokens) AS t(tok)
    JOIN shipments s ON TRUE
    JOIN sales_orders so ON so.id = s.sales_order_id AND so.customer_id IS NOT NULL
    WHERE t.tok <> ''
      AND ( s.recipient_name ILIKE '%' || t.tok || '%'
         OR s.recipient_address ILIKE '%' || t.tok || '%'
         OR ( length(regexp_replace(t.tok,'[^0-9]','','g')) >= 3
              AND regexp_replace(coalesce(s.recipient_phone,''),'[^0-9]','','g')
                  ILIKE '%' || regexp_replace(t.tok,'[^0-9]','','g') || '%' ) )
  ),
  all_tok AS (
    SELECT customer_id, tok, field, val FROM token_field
    UNION ALL
    SELECT customer_id, tok, field, val FROM token_product
    UNION ALL
    SELECT customer_id, tok, field, val FROM token_shipping
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
$function$;
