# BUILD-LOG — 판매현황 지점 매출 비교 서브뷰

## Step 1 — 지점비교 서브뷰 (BUILD DONE · 리뷰 대기)
시작: 2026-06-12 · 빌드완료: 2026-06-12

### Locked Decisions
- 집계 방식: **(B) 클라이언트 집계** + 1000행 캡 우회 페이지네이션. RPC/마이그 없음 → AI Sync(schema.ts/tools.ts) 해당 없음.
- 매출 정의: `total_amount` 합계, status ∈ {CANCELLED, REFUNDED, PARTIALLY_REFUNDED} 제외. discount 미반영(목록 일별집계 L389~407과 동일 기준).
- 날짜 경계: KST(kstDayStart/kstDayEnd gte·lte, 그룹핑 fmtDateKST).
- 권한: `!isBranchUser`(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE)만 토글 노출. 지점직원 숨김.
- 다수선택 state(`compareBranchIds`)는 단일 `branchFilter`와 별개. 기본 전체선택.

### Files Changed
- `src/app/(dashboard)/pos/SalesListTab.tsx` (유일 변경 대상)
  - state: `subView`, `compareBranchIds`, `compareRows`, `compareLoading`
  - useEffect: branches 로드 시 compareBranchIds 전체선택 초기화
  - `loadCompare`: 경량 select(branch_id, ordered_at, status, total_amount) + PAGE=1000 페이지네이션 + KST gte/lte + .in(branch_id) + status 제외(.not in). subView==='compare'일 때만 호출.
  - `compareMatrix`(useMemo): 날짜행×지점열 + 행총계/열총계/총계. fmtDateKST 그룹핑.
  - UI: 토글 세그먼트(!isBranchUser), 지점 체크박스(전체/해제), 매트릭스 표(table only). 목록 본문은 subView==='list' 게이트.

### Key Decisions
- 조회 버튼: subView에 따라 loadCompare/loadOrders 분기.
- status 제외는 쿼리단(.not status in). discount 미반영.
- schema.ts/tools.ts 무수정(테이블/컬럼/enum/액션 변경 0 → AI Sync 해당없음).

### Build
- `npm run build` ✓ Compiled successfully (5.8s), 에러·경고 없음.

### Known Gaps (Out of Scope)
- 비교뷰 차트
- 비교뷰 CSV 내보내기
- 순매출(discount/환불 반영) 컬럼
- 결제수단·채널별 분해

### Deploy
- 미배포.
