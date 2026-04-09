-- ═══════════════════════════════════════════════════════════════════════
-- RLS 정책 수정
--
-- 025/027에서 notification_template_mappings / notification_batch_logs
-- 테이블 정책을 'TO authenticated'로 생성했으나,
-- 본 앱은 커스텀 세션 인증(supabase-js는 익명 클라이언트)을 사용하므로
-- 'TO authenticated'는 매칭되지 않아 insert/update가 거부됨.
--
-- 다른 테이블들과 동일하게 role 지정 없는 USING (true) 패턴으로 교체.
-- ═══════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- notification_template_mappings
DROP POLICY IF EXISTS ntm_all ON notification_template_mappings;
CREATE POLICY ntm_all ON notification_template_mappings
  FOR ALL USING (true) WITH CHECK (true);

-- notification_batch_logs
DROP POLICY IF EXISTS nbl_all ON notification_batch_logs;
CREATE POLICY nbl_all ON notification_batch_logs
  FOR ALL USING (true) WITH CHECK (true);
