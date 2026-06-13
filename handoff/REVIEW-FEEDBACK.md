# Review Feedback — Feature F: 지점 재고 이동 둘러보기·체크박스 다중선택
Date: 2026-06-13
Status: APPROVED

## Conditions
(none)

## Escalate to Arch
(none)

## Cleared
TransferBatchPanel.tsx 둘러보기+체크박스 다중선택 전환 리뷰 — 단일 출처(checked=rows 파생), 전체선택/해제 필터기준, 모든 기존 가드(sameBranch/hasOver/hasInvalidQty/empty-rows/handleFromChange reset/stale-fetch cancel) 유지, getInventory/transferInventoryBatch 인자·서버·스키마 무변경, 엣지(빈검색·무재고·200캡) 처리 모두 통과.

## Verification notes
- 단일 출처: 별도 selection state 없음. checked = rows.some(...) (L330, L125). ✕삭제(L393)·전체해제 모두 rows 만 변경 → 체크 자동 동기화. desync 경로 없음. 확인.
- browseAll(L79-94): dedup(seen Set) + branch_id 일치 + quantity>0 + localeCompare('ko') 정렬. browseFiltered(L96-104): 빈쿼리→browseAll 전체, name/code 부분일치. browseList=slice(0,200)+overCap(L106-107). 확인.
- selectAllFiltered(L131-139): browseList 중 미담김만 qty:1 추가. deselectAllFiltered(L142-145): visible(browseList) product_id 만 제거 → 필터 밖 담긴 품목 보존. 확인.
- from-branch 변경(L148-152): rows·search 초기화 + useEffect(L46-66) fromBranchId 키 재페치 → 이전 지점 stale 체크 불가. cancelled 가드(L51-64)로 stale 응답 차단. 확인.
- 가드 전수: sameBranch(L154), hasOver(L155-158), hasInvalidQty(L159), rows.length===0(L165), submit 서버검증(L189-194). 초과경고·qty input·✕(L377-398) 무변경. 확인.
- getInventory(actions.ts:985) 단일 인자 호출, {data}+product 중첩 반환 일치. 인자 무변경. transferInventoryBatch 인자 무변경(L197-202). 확인.
- 서버/DB/마이그/schema.ts/tools.ts 무변경(git diff: TransferBatchPanel.tsx 단일 소스 변경). AI 동기화 불필요. 확인.
- 엣지: 빈검색→전체목록(L98), 무재고→"이동 가능한 재고가 없습니다"(L320-322), 필터무결과→"검색 결과 없음"(L325-326), 200초과→안내(L355-357). 확인.

## Non-blocking observations (참고만, 수정 불요)
- overCap(>200)일 때 전체선택은 보이는 200개만 추가(숨은 항목 제외). 브리프의 "CURRENT filtered list" 정의와 일치하며 overCap 안내로 사용자 인지 가능. 의도된 동작.
