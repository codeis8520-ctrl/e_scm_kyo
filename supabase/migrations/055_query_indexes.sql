-- ═══════════════════════════════════════════════════════════════
-- 쿼리 핫패스 인덱스 보강 (P1 + P2)
-- 2026-04-22
--
-- 기존 단일 컬럼 인덱스만으로는 WHERE + ORDER BY DESC + LIMIT 패턴에서
-- 정렬 비용이 남는 경로가 생김. 최근 추가된 페이지네이션 화면을 포함해
-- 체감 영향이 큰 6개 인덱스를 복합 인덱스로 보강.
--
-- 주의: 프로덕션 적용 시 대형 테이블(sales_orders, inventory_movements,
--       notifications)에서 수초~수십초 쓰기 블록 발생 가능. 오프피크에
--       적용하거나 Supabase SQL 에디터에서 CONCURRENTLY로 교체해도 무방
--       (CONCURRENTLY는 트랜잭션 밖에서만 가능하므로 본 파일에선 생략).
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- ── P1: 직접 영향 ────────────────────────────────────────────────

-- 1) inventory_movements(product_id, created_at DESC)
--    - 재고 변동 이력 모달(getInventoryMovements): WHERE product_id=? ORDER BY created_at DESC
--    - 제품 하나에 movements 쌓일수록 필수
CREATE INDEX IF NOT EXISTS idx_inv_mov_product_created
  ON inventory_movements (product_id, created_at DESC);

-- 2) production_orders(branch_id, created_at DESC)
--    - 생산 지시 페이지네이션: 지점 필터 + 최근순 정렬
CREATE INDEX IF NOT EXISTS idx_production_orders_branch_created
  ON production_orders (branch_id, created_at DESC);

-- 3) production_orders(status)
--    - 상단 통계 카드 3쿼리 (PENDING/IN_PROGRESS/COMPLETED count:exact head:true)
CREATE INDEX IF NOT EXISTS idx_production_orders_status
  ON production_orders (status);

-- ── P2: 볼륨 늘어나면 체감 ───────────────────────────────────────

-- 4) shipments(sales_order_id)
--    - POS 전표 복사 / 판매 드로어의 shipments.in('sales_order_id',[...]) 배치 조회
CREATE INDEX IF NOT EXISTS idx_shipments_sales_order
  ON shipments (sales_order_id);

-- 5) notifications(status, created_at DESC)
--    - /notifications 발송 내역 최근순 (limit 200)
CREATE INDEX IF NOT EXISTS idx_notifications_status_created
  ON notifications (status, created_at DESC);

-- 6) sales_orders(branch_id, ordered_at DESC)
--    - 지점별 판매현황 최근순 페이지네이션 (limit 500 경로 다수)
CREATE INDEX IF NOT EXISTS idx_sales_orders_branch_ordered
  ON sales_orders (branch_id, ordered_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 적용 후 확인
--   SELECT schemaname, indexname FROM pg_indexes
--   WHERE indexname IN (
--     'idx_inv_mov_product_created',
--     'idx_production_orders_branch_created',
--     'idx_production_orders_status',
--     'idx_shipments_sales_order',
--     'idx_notifications_status_created',
--     'idx_sales_orders_branch_ordered'
--   );
-- ═══════════════════════════════════════════════════════════════
