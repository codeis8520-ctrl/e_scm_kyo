# Architect Brief — 지점 재고 이동 다품목 둘러보기·다중선택 (단일 스텝)

## Goal
TransferBatchPanel 의 품목 추가 UX 를, "검색어 입력 → 드롭다운 1건씩 클릭"에서 "출발지 재고>0 품목 전체 둘러보기 목록 + 체크박스 다중선택 즉시 담기"로 교체한다. 여러 품목을 한 번에 담을 수 있다.

## 범위
- 단일 파일: `src/app/(dashboard)/inventory/TransferBatchPanel.tsx` 만 수정.
- 서버/DB/마이그/schema.ts/tools.ts **변경 없음**. getInventory(actions.ts:985) · transferInventoryBatch 인자 무변경. (확인됨: getInventory 는 branch 필터된 `{data:[{branch_id,product_id,quantity,product:{id,name,code}}]}` 반환 — 이미 srcInventories 가 그대로 사용 중.)
- 순수 클라이언트 UI 교체.

## Build Order — 잠긴 결정대로 구현
1. **드롭다운 candidates 제거 → 둘러보기 목록(browseList)으로 교체.**
   - `search` state 는 유지하되 의미 전환: 드롭다운 트리거가 아니라 **목록 필터**(이름/코드 부분일치).
   - 새 memo `browseList`: srcInventories 중 `branch_id===fromBranchId && quantity>0`, dedup(product_id), search 필터 적용. **이미 담긴 품목 제외하지 말 것** — 목록에 남기되 체크된 상태로 표시(아래 동기화). 정렬: product.name 한글 localeCompare 오름차순.
   - 캡: `.slice(0, 200)`. 200 초과 시 목록 하단에 "상위 200개만 표시 — 검색으로 좁히세요" 안내. (가상화 불필요, 단순 스크롤.)
2. **목록 UI**: `max-h-72 overflow-y-auto` 스크롤 컨테이너, 각 행 = `<label>` 로 감싼 체크박스 + 상품명 + 코드 + **현재고**(stockOf 재사용). 행 클릭/체크 = 토글.
3. **체크 ↔ rows 동기화 = 즉시 반영 (잠금: 방식 a).**
   - 체크 ON → `rows` 에 `{product_id,name,code,quantity:1}` 추가. 체크 OFF → `rows` 에서 제거(removeRow 재사용).
   - 체크 상태의 단일 출처(single source of truth)는 `rows`: `const checked = rows.some(r=>r.product_id===pid)`. 별도 selection state 만들지 말 것.
   - 토글 핸들러 `toggleProduct(c)`: checked 면 removeRow, 아니면 addRow(quantity:1). search 는 비우지 말 것(목록 필터 유지).
4. **전체/해제 버튼 포함 (잠금: 포함).** 현재 search 필터 적용된 browseList 기준.
   - "전체 선택": browseList 중 아직 rows 에 없는 것 전부 quantity:1 로 추가.
   - "전체 해제": browseList 에 보이는 product_id 들만 rows 에서 제거(필터 밖에서 담긴 품목은 보존).
   - 버튼 라벨에 카운트 불필요. 목록 헤더 우측에 배치.
5. **선택 품목 리스트(rows) UI = 기존 그대로 유지** (수량 input·현재고·초과경고·✕삭제). ✕삭제 시 rows 에서 빠지면 둘러보기 체크도 자동 해제됨(체크가 rows 파생이므로 공짜). 명시만.
6. **상태/가드 유지**: loadingInv 로딩 힌트, fromBranchId 미선택 시 목록 자리에 "먼저 출발 지점을 선택하세요", 재고>0 품목 0건이면 "이동 가능한 재고가 없습니다". sameBranch/hasOver/hasInvalidQty/빈행 submitDisabled, handleFromChange 의 rows·search 초기화, 출발지 stale 가드 — 전부 유지.
7. **레이아웃 (잠금: 상하 단일컬럼).** 출발→도착 2-panel + 메모 = 유지. 그 아래 **둘러보기 목록**, 그 아래 **선택 품목 리스트**, 맨 아래 일괄 이동 버튼. (좌우 2단 아님 — 모바일/멘탈모델 단순화. "위 출발/도착 → 가운데 고르기 → 아래 담긴 것" 흐름.)

## Out of Scope (B/C/D 채택 안 함 — 표면화 시 BUILD-LOG Known Gaps)
- 가상화 스크롤, 카테고리/등급 필터, 수량 일괄 지정, 즐겨찾기·최근 품목. 서버 페이지네이션.
- getInventory 응답형/transferInventoryBatch 변경. 다른 화면.

## 성능
- getInventory 는 출발지 1개 지점 전 품목 반환(branch_id 필터됨, 전사 아님) → 단일 지점 품목수 규모, 단순 목록 렌더 비용 무시 가능. 200 캡으로 상한. 문제 없음 — 가상화 불필요.

## Acceptance
- 출발지 선택 시 재고>0 품목이 체크박스 목록으로 즉시 노출(검색 입력 불요).
- 체크 → 아래 선택 리스트에 1개씩 즉시 추가, 체크 해제/✕ → 제거(양방향 동기화).
- 전체선택/해제 동작(필터 기준). 검색은 목록 필터로 작동.
- 이미 담긴 품목은 목록에서 체크된 상태로 표시.
- `npm run build` 통과, 출발지 미선택/로딩/재고없음 안내 정상.
