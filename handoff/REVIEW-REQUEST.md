# Review Request — Step 1: 지점 매출 비교 서브뷰
Date: 2026-06-12
Ready for Review: YES

## Files Changed
모두 단일 파일 `src/app/(dashboard)/pos/SalesListTab.tsx`:

- `:158-164` — 비교뷰 state 추가: `subView('list'|'compare')`, `compareBranchIds string[]`, `compareRows`, `compareLoading`.
- `:307-310` — branches 로드 시 `compareBranchIds` 전체 active 지점으로 초기화하는 useEffect.
- `:318-345` — `loadCompare`: 경량 select(`branch_id, ordered_at, status, total_amount`), KST gte/lte(kstDayStart/kstDayEnd), `.in('branch_id', compareBranchIds)`, status 제외 `.not('status','in','(CANCELLED,REFUNDED,PARTIALLY_REFUNDED)')`, PAGE=1000 페이지네이션(.range, len<PAGE break). 빈 선택 가드.
- `:347-350` — `subView==='compare'`일 때만 loadCompare 호출하는 useEffect(불필요 페치 방지).
- `:352-380` — `compareMatrix`(useMemo): 날짜행×지점열 매트릭스 + 행총계/열총계(colTotalValues)/총계(grandTotal). `fmtDateKST` 그룹핑.
- `:382-386` — `toggleCompareBranch` 헬퍼.
- `:553-570` — 서브뷰 토글 세그먼트 버튼(목록 | 지점비교), `!isBranchUser` 게이트.
- `:600-614` — 조회 버튼 분기(compare→loadCompare), 고객찾기·CSV 버튼은 list-only.
- `:617-665` — 기본 필터 바를 `subView==='list'` 게이트로 감쌈.
- `:667-687` — 지점 다수선택 UI(전체/해제 버튼 + 지점별 체크박스), compare 전용.
- `:690` — 고급검색 패널 게이트에 `subView==='list'` 추가.
- `:796-1009` — 목록 본문(요약카드/일자별요약/메인테이블)을 `subView==='list'` 프래그먼트로 감쌈.
- `:1013-1062` — 지점비교 매트릭스 표(table only, 차트 없음): 헤더=지점열+합계, tbody=날짜행+행총계, tfoot=지점 합계행+총계. 로딩/빈선택/빈기간 분기.

## Open Questions
- 없음. 브리프 Build Order 전 항목 구현, 모든 Locked Decision 준수.

## Out of Scope (logged in BUILD-LOG)
- 비교뷰 차트 / CSV 내보내기 / 순매출(discount·환불 반영) 컬럼 / 결제수단·채널별 분해
- schema.ts·tools.ts 무수정(DB/enum/액션 변경 0 → AI Sync 해당 없음)

## Build
- `npm run build` ✓ Compiled successfully (5.8s), 에러·경고 없음.
