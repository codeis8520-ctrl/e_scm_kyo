-- ═══════════════════════════════════════════════════════════════════════════
-- 076_merge_customers
--
-- 동명이인으로 잘못 쪼개진(마이그레이션 시 1인 다번호 → 여러 레코드) 고객을
-- 하나로 병합하는 원자적 함수.
--   · 보조(secondary)의 모든 참조를 대표(primary)로 이전 후 보조 삭제.
--   · UNIQUE 충돌 테이블 처리: customer_tag_map(고객+태그), customer_kakao(고객당 1).
--   · 보조 전화번호는 대표 phone2 에 보존(대표 phone2 비어있을 때).
--   · 대표의 빈 필드(email/address/health_note)는 보조 값으로 보강.
--   · 트랜잭션 함수라 중간 실패 시 전체 롤백.
--
-- ⚠️ point_history: balance(running) 시퀀스는 재계산하지 않고 customer_id만 이전.
--    포인트 잔액이 양쪽에 있던 경우 latest balance 기준이 어긋날 수 있음 →
--    필요 시 병합 후 별도 조정. (레거시 분리 고객은 대개 포인트 없음)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION merge_customers(p_primary uuid, p_secondary uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_sec_phone   text;
  v_pri_phone   text;
  v_pri_phone2  text;
BEGIN
  IF p_primary IS NULL OR p_secondary IS NULL THEN
    RAISE EXCEPTION '대표/보조 고객 ID가 필요합니다';
  END IF;
  IF p_primary = p_secondary THEN
    RAISE EXCEPTION '같은 고객끼리는 병합할 수 없습니다';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_primary) THEN
    RAISE EXCEPTION '대표 고객을 찾을 수 없습니다';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_secondary) THEN
    RAISE EXCEPTION '병합 대상(보조) 고객을 찾을 수 없습니다';
  END IF;

  -- 1) 단순 참조 재배정 (보조 → 대표)
  UPDATE sales_orders           SET customer_id = p_primary WHERE customer_id = p_secondary;
  UPDATE legacy_orders          SET customer_id = p_primary WHERE customer_id = p_secondary;
  UPDATE legacy_purchases       SET customer_id = p_primary WHERE customer_id = p_secondary;
  UPDATE customer_consultations SET customer_id = p_primary WHERE customer_id = p_secondary;
  UPDATE point_history          SET customer_id = p_primary WHERE customer_id = p_secondary;
  UPDATE return_orders          SET customer_id = p_primary WHERE customer_id = p_secondary;
  UPDATE notifications          SET customer_id = p_primary WHERE customer_id = p_secondary;
  UPDATE sales_order_drafts     SET customer_id = p_primary WHERE customer_id = p_secondary;

  -- 2) customer_tag_map: 대표가 이미 가진 태그는 제외하고 이전, 나머지(중복) 삭제
  UPDATE customer_tag_map t SET customer_id = p_primary
    WHERE t.customer_id = p_secondary
      AND NOT EXISTS (
        SELECT 1 FROM customer_tag_map x
        WHERE x.customer_id = p_primary AND x.tag_id = t.tag_id
      );
  DELETE FROM customer_tag_map WHERE customer_id = p_secondary;

  -- 3) customer_kakao: 고객당 1행 — 대표에 없을 때만 이전, 있으면 보조 것 삭제
  IF EXISTS (SELECT 1 FROM customer_kakao WHERE customer_id = p_primary) THEN
    DELETE FROM customer_kakao WHERE customer_id = p_secondary;
  ELSE
    UPDATE customer_kakao SET customer_id = p_primary WHERE customer_id = p_secondary;
  END IF;

  -- 4) 보조 전화번호를 대표 phone2 에 보존 (대표 phone2 비어있고, 대표 phone 과 다를 때)
  SELECT phone, phone2 INTO v_pri_phone, v_pri_phone2 FROM customers WHERE id = p_primary;
  SELECT phone           INTO v_sec_phone            FROM customers WHERE id = p_secondary;
  IF (v_pri_phone2 IS NULL OR v_pri_phone2 = '')
     AND v_sec_phone IS NOT NULL AND v_sec_phone <> '' AND v_sec_phone <> v_pri_phone THEN
    UPDATE customers SET phone2 = v_sec_phone WHERE id = p_primary;
  END IF;

  -- 5) 대표의 빈 필드 보강 (email/address/health_note)
  UPDATE customers p SET
    email       = COALESCE(NULLIF(p.email, ''),       s.email),
    address     = COALESCE(NULLIF(p.address, ''),     s.address),
    health_note = COALESCE(NULLIF(p.health_note, ''), s.health_note),
    updated_at  = NOW()
  FROM customers s
  WHERE p.id = p_primary AND s.id = p_secondary;

  -- 6) 보조 삭제 (전화번호 UNIQUE 충돌 해소)
  DELETE FROM customers WHERE id = p_secondary;

  RETURN jsonb_build_object('merged', true, 'primary', p_primary, 'secondary', p_secondary);
END;
$$;

COMMENT ON FUNCTION merge_customers(uuid, uuid) IS
  '동명이인 분리 고객 병합: 보조의 모든 참조를 대표로 이전 후 보조 삭제. 보조 번호는 대표 phone2 보존.';
