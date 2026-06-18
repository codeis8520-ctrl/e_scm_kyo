-- ═════════════════════════════════════════════════════════════════════════
-- 090_branches_sort_order: 지점 정렬값(sort_order) 추가 + 요청 순서 시드
--
-- 배경:
--   채널(channels.sort_order)처럼 지점에도 정렬값을 부여해, 지점이 나열되는
--   모든 화면(판매현황 지점필터·매출현황 지점별 매출표 등)에서 동일 순서로
--   노출한다. 코드관리(system-codes) 지점 탭에서 유동 편집 가능.
--
-- 정책:
--   · DEFAULT 999 — 미지정 지점은 뒤로. ORDER BY sort_order ASC, then name.
--   · 비활성 지점도 정렬값 부여(화면 노출 여부는 기존 is_active 필터 규칙 유지).
--   · 시드는 name 매칭 idempotent UPDATE — 재실행 안전, 누락 지점은 999 유지.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE branches ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 999;

-- 요청 순서 시드 (name 정확매칭, idempotent)
UPDATE branches SET sort_order = 1  WHERE name = '청담점';
UPDATE branches SET sort_order = 2  WHERE name = '한남점';
UPDATE branches SET sort_order = 3  WHERE name = '자사몰';
UPDATE branches SET sort_order = 4  WHERE name = '신세계몰';
UPDATE branches SET sort_order = 5  WHERE name = '본사';
UPDATE branches SET sort_order = 6  WHERE name = '대전신세계';
UPDATE branches SET sort_order = 7  WHERE name = '강남신세계';
UPDATE branches SET sort_order = 8  WHERE name = '명동신세계';
UPDATE branches SET sort_order = 9  WHERE name = '대구신세계';
UPDATE branches SET sort_order = 10 WHERE name = '부산신세계(팝업)';

CREATE INDEX IF NOT EXISTS idx_branches_sort_order ON branches(sort_order);
