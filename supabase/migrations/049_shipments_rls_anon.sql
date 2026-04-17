-- =====================================================
-- Migration 049: shipments RLS — anon 접근 허용
-- =====================================================
-- migration 012에서 TO authenticated로 제한.
-- Custom Session Auth + anon key 환경에서 조회/삽입 불가 → USING (true)로 복구.

DROP POLICY IF EXISTS shipments_all ON shipments;
CREATE POLICY shipments_all ON shipments
  FOR ALL USING (true) WITH CHECK (true);
