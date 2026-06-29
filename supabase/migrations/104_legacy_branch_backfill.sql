-- ═════════════════════════════════════════════════════════════════════════
-- 104_legacy_branch_backfill: 레거시 미매칭 매출처 → 신규 지점 연결 (#73)
--
-- 배경: legacy_orders.branch_id 적재가 매출처 이름 정확일치로만 되어, 이름 변형·
--   신규 백화점/팝업/온라인몰 매출처 24.26억(전체 23%)이 미매칭(branch_id NULL).
--   진단: docs/legacy-sales-reconciliation.md
--
-- 작업(Project Owner 사인오프 — '전체 해소' 방향):
--   1) 지점이 없던 팝업 4개를 EVENT 지점으로 신규 생성(종료 매출처 → is_active=false)
--   2) branch_code_raw 기준으로 미매칭(branch_id IS NULL) 행을 대상 지점에 연결
--   원천 channel_text/branch_code_raw 무손상. 멱등(이름 기준 NOT EXISTS / branch_id IS NULL 가드).
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

-- ── 1) 누락 팝업 EVENT 지점 신규 생성(종료 매출처 = is_active=false) ──────────
INSERT INTO branches (name, code, channel, is_active, sort_order)
SELECT v.name, v.code, 'EVENT', false, 999
FROM (VALUES
  ('강남신세계(팝업)', 'POP-GNSSG'),
  ('명동롯데(팝업)',   'POP-MDLT'),
  ('하이산홍콩(팝업)', 'POP-HSHK'),
  ('한남나인원(팝업)', 'POP-HNNW')
) AS v(name, code)
WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.name = v.name);

-- ── 2) branch_code_raw → 지점 백필 (미매칭 행만) ─────────────────────────────
-- 기존 지점(연결 누락·이름 변형)
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='강남신세계' AND channel='DEPT_STORE' LIMIT 1)
  WHERE branch_code_raw='C2' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='대전신세계' AND channel='DEPT_STORE' LIMIT 1)
  WHERE branch_code_raw='C1' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='대구신세계(팝업)' LIMIT 1)
  WHERE branch_code_raw='X8' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='부산신세계(팝업)' LIMIT 1)
  WHERE branch_code_raw='D1' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='신세계몰' AND channel='ONLINE' LIMIT 1)
  WHERE branch_code_raw='B1' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='광주신세계(팝업)' LIMIT 1)
  WHERE branch_code_raw='D4' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='롯데몰' AND channel='ONLINE' LIMIT 1)
  WHERE branch_code_raw='B2' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='명동신세계(팝업)' LIMIT 1)
  WHERE branch_code_raw='X6' AND branch_id IS NULL;

-- 신규 생성 팝업
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='강남신세계(팝업)' LIMIT 1)
  WHERE branch_code_raw='X5' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='명동롯데(팝업)' LIMIT 1)
  WHERE branch_code_raw='X3' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='하이산홍콩(팝업)' LIMIT 1)
  WHERE branch_code_raw='X9' AND branch_id IS NULL;
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE name='한남나인원(팝업)' LIMIT 1)
  WHERE branch_code_raw='X4' AND branch_id IS NULL;

-- 비매출처 코드(원장님·매니저 대신) → 본사 귀속(소액 0.08억, '기타' 성격). 필요 시 추후 재분류.
UPDATE legacy_orders SET branch_id = (SELECT id FROM branches WHERE is_headquarters LIMIT 1)
  WHERE branch_code_raw IN ('3013','7908') AND branch_id IS NULL;
