-- ═════════════════════════════════════════════════════════════════════════
-- 111_branch_is_warehouse → 매출처 ↔ 출고처(창고) 분리 (#96)
--
-- 배경: 자사몰·네이버스토어·신세계몰 등 온라인 채널(channel='ONLINE')은 매출처일 뿐
--   실물 창고가 아님. 그런데 출고처/창고 셀렉터·재고현황에 창고처럼 노출되고 재고가 차감됨.
--   → is_warehouse 플래그로 명시 분리. 온라인 채널 = 창고 아님(false). 실제 출고는 본사.
--   (데이터 이관=온라인 재고 → 본사는 별도 백필로 처리.)
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS is_warehouse boolean NOT NULL DEFAULT true;  -- 출고처/창고 가능 여부

-- 온라인 채널은 창고 아님(출고처·재고현황·재고차감 대상에서 제외).
UPDATE branches SET is_warehouse = false WHERE channel = 'ONLINE';

CREATE INDEX IF NOT EXISTS idx_branches_is_warehouse ON branches(is_warehouse);
