# Review Request — Feature F: 지점 재고 이동 둘러보기·체크박스 다중선택
Date: 2026-06-13
Ready for Review: YES

## Files Changed
- src/app/(dashboard)/inventory/TransferBatchPanel.tsx:76-107 — `candidates` 드롭다운 memo 제거 → `browseAll`(출발지 재고>0 dedup, name 한글 localeCompare 정렬) + `browseFiltered`(search 부분일치 필터) + `browseList`=slice(0,200) + `overCap` 플래그.
- src/app/(dashboard)/inventory/TransferBatchPanel.tsx:109-111 — `addRow` 에서 `setSearch('')` 제거(토글 시 목록 필터 유지).
- src/app/(dashboard)/inventory/TransferBatchPanel.tsx:114-145 — 핸들러 신규: `toggleProduct`(checked=rows 파생→remove/add), `selectAllFiltered`(필터 중 미담김 전부 qty:1 추가), `deselectAllFiltered`(보이는 product_id 만 제거).
- src/app/(dashboard)/inventory/TransferBatchPanel.tsx:281-358 — UI 교체: 검색 드롭다운 → 헤더(품목 선택 + 전체선택/해제) + search 필터 input + max-h-72 스크롤 체크박스 목록(`<label>`+checkbox+상품명/코드+현재고). 미선택/로딩/재고없음/필터무결과/200초과 인라인 힌트.

## Self-review
- Richard가 먼저 볼 것: 체크 상태 단일 출처. `checked = rows.some(r=>r.product_id===c.product_id)` 로 rows 파생 — 별도 selection state 없음. ✕삭제·전체해제 모두 rows 만 바꾸므로 체크 자동 동기화.
- 브리프 요구사항 전수 확인: 드롭다운→둘러보기 교체(✓), search=필터(✓), browseList 정렬·200캡·초과안내(✓), `<label>`행+현재고 stockOf 재사용(✓), 즉시 동기화 add/remove(✓), 전체선택/해제 필터기준+해제는 visible만(✓), rows UI·가드 무변경(✓), 상태/가드 유지(✓), 상하 단일컬럼(✓), 서버/DB/schema/tools 무변경(✓).
- 빈/실패 시 사용자 표시: 출발지 미선택→"먼저 출발 지점을 선택하세요", 로딩→"불러오는 중", 재고0→"이동 가능한 재고가 없습니다", 필터 무결과→"검색 결과 없음". submit 에러는 기존 error 배너.

## Open Questions
- 없음. 모든 결정이 브리프에 잠겨 있어 그대로 구현.

## Out of Scope (BUILD-LOG 기록)
- 가상화/카테고리필터/수량일괄/즐겨찾기·최근/서버페이지네이션 — 미채택대로 미구현. Known Gaps 없음.

## Build
- npm run build ✓ Compiled successfully in 6.6s, 에러/경고 0.
