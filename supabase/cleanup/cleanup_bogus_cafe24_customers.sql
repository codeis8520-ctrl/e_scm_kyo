-- ═══════════════════════════════════════════════════════════════════════
-- 카페24 회원 동기화 초기 버그로 인한 dummy 고객 정리
-- ═══════════════════════════════════════════════════════════════════════
-- 초기 구현에서 카페24 회원의 실명/전화가 마스킹되어 올 때
-- "고객_{member_id}" / "cafe24_{member_id}" 형태로 dummy 저장되던 문제 수정 후
-- 기존 잘못된 데이터를 정리하는 스크립트
-- ═══════════════════════════════════════════════════════════════════════

-- 1) 먼저 확인 (실제 삭제 전 검토)
SELECT id, name, phone, cafe24_member_id, created_at
FROM customers
WHERE
  phone LIKE 'cafe24_%'
  OR name LIKE '고객_%@%'
  OR name ~ '^고객_\d+'
ORDER BY created_at DESC;

-- 2) 삭제 대상 건수 카운트
SELECT COUNT(*) AS bogus_count
FROM customers
WHERE
  phone LIKE 'cafe24_%'
  OR name LIKE '고객_%@%'
  OR name ~ '^고객_\d+';

-- 3) 외래키 의존성 확인 — 이 고객들을 참조하는 레코드
SELECT 'sales_orders' AS tbl, COUNT(*) FROM sales_orders WHERE customer_id IN (
  SELECT id FROM customers WHERE phone LIKE 'cafe24_%' OR name LIKE '고객_%@%' OR name ~ '^고객_\d+'
)
UNION ALL
SELECT 'point_history', COUNT(*) FROM point_history WHERE customer_id IN (
  SELECT id FROM customers WHERE phone LIKE 'cafe24_%' OR name LIKE '고객_%@%' OR name ~ '^고객_\d+'
)
UNION ALL
SELECT 'customer_consultations', COUNT(*) FROM customer_consultations WHERE customer_id IN (
  SELECT id FROM customers WHERE phone LIKE 'cafe24_%' OR name LIKE '고객_%@%' OR name ~ '^고객_\d+'
)
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications WHERE customer_id IN (
  SELECT id FROM customers WHERE phone LIKE 'cafe24_%' OR name LIKE '고객_%@%' OR name ~ '^고객_\d+'
);

-- 4) 실제 삭제 (⚠️ 주문/상담/포인트 이력이 없는 경우에만 삭제)
-- 주의: 아래 DELETE는 위 검토를 마친 후 수동 실행
--
-- DELETE FROM customers
-- WHERE (
--   phone LIKE 'cafe24_%'
--   OR name LIKE '고객_%@%'
--   OR name ~ '^고객_\d+'
-- )
-- AND id NOT IN (SELECT DISTINCT customer_id FROM sales_orders WHERE customer_id IS NOT NULL)
-- AND id NOT IN (SELECT DISTINCT customer_id FROM point_history WHERE customer_id IS NOT NULL)
-- AND id NOT IN (SELECT DISTINCT customer_id FROM customer_consultations WHERE customer_id IS NOT NULL)
-- AND id NOT IN (SELECT DISTINCT customer_id FROM notifications WHERE customer_id IS NOT NULL);

-- 5) 주문 이력이 있는 dummy 고객은 삭제 대신 익명화 (식별 방지 + 관계 유지)
-- UPDATE customers
-- SET name = CONCAT('카페24회원_', SUBSTRING(id::text, 1, 8)),
--     phone = NULL,
--     cafe24_member_id = cafe24_member_id  -- 유지
-- WHERE (
--   phone LIKE 'cafe24_%'
--   OR name LIKE '고객_%@%'
-- )
-- AND id IN (SELECT DISTINCT customer_id FROM sales_orders WHERE customer_id IS NOT NULL);

-- 참고: customers.phone이 NOT NULL 제약이면 5번 구문은 실패함
-- 이 경우 phone = '010-0000-0000' 같은 placeholder 사용
