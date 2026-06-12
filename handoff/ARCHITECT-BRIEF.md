# Architect Brief — Step 1: 지점 매출 비교 서브뷰

## Goal
판매현황 탭(SalesListTab)에 본사/관리자 전용 '지점비교' 서브뷰를 추가한다. 다수 지점을 선택하면 날짜 행 × 지점 열 매트릭스로 일별 합계 매출을 비교한다.

## Locked Decisions (변경 금지)
- **집계 방식 = (B) 클라이언트 집계.** RPC/마이그레이션 없음. 근거: 단순 GROUP BY 2축이고, 기간(보통 7~30일) 한정 경량 페치면 충분. RPC는 마이그+AI Sync 부담 대비 이득 없음. → **CLAUDE.md AI Sync 매트릭스 해당 없음**(테이블/컬럼/enum/액션 변경 0). schema.ts·tools.ts 손대지 말 것.
- **매출 정의 = `total_amount` 합계, status가 CANCELLED/REFUNDED/PARTIALLY_REFUNDED 인 주문 제외.** discount_amount는 반영하지 않는다(목록 화면 일별 집계 L389~407이 total_amount 그대로 합산하는 것과 동일 기준 — 일관성). 이 기준은 코드 주석으로만 남기고 셀/툴팁엔 노출 안 함.
- **날짜 경계 = KST.** 페치는 `kstDayStart(startDate)`/`kstDayEnd(endDate)`(gte/lte, loadOrders L210과 동일). 일자 그룹핑은 `fmtDateKST(ordered_at)`(L404와 동일, UTC slice 금지).
- **권한 게이트 = !isBranchUser 일 때만 토글 노출.** isBranchUser는 기존 L121(`userRole==='BRANCH_STAFF' || 'PHARMACY_STAFF'`). SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE에게만 '지점비교' 토글이 보인다. 별도 role 화이트리스트 만들지 말고 기존 isBranchUser 부정으로 처리.
- **다수선택 상태는 별도.** 기존 단일 `branchFilter`(L133)는 건드리지 말 것. 비교뷰 전용 새 state `compareBranchIds: string[]` 추가. 기본값 = 전체 active 지점 id 배열(branches 로드 후 채움). 전지점 조회는 이 '전체 선택' 상태로 충족.

## Build Order
1. **서브뷰 토글 state**: `const [subView, setSubView] = useState<'list'|'compare'>('list')`. 토글 UI는 필터 바 상단(기간 프리셋 줄 영역 L475 근처)에 '목록 | 지점비교' 세그먼트 버튼 2개. `!isBranchUser`일 때만 렌더.
2. **compare state**: `compareBranchIds: string[]`. branches 변경 시 전체 선택으로 초기화(useEffect). 다수선택 UI = 지점별 체크박스 + '전체/해제' 버튼.
3. **집계 로드 `loadCompare`**(loadOrders와 별개):
   - sales_orders에서 **경량 컬럼만** select: `branch_id, ordered_at, status, total_amount`.
   - 필터: `.gte('ordered_at', kstDayStart(startDate)).lte('ordered_at', kstDayEnd(endDate))`, `.in('branch_id', compareBranchIds)`, status 제외는 쿼리단 `.not('status','in','(CANCELLED,REFUNDED,PARTIALLY_REFUNDED)')` 권장(JS 폴백 가능).
   - **1000행 캡 우회 페이지네이션 필수.** 패턴은 `src/app/(dashboard)/customers/[id]/page.tsx` L235~249(`PAGE=1000`, `for(from=0;;from+=PAGE)`, `.range(from, from+PAGE-1)`, `data.length<PAGE → break`) 그대로 차용. loadOrders의 `.limit(500/2000)`는 집계에 부적합 — 절대 재사용 금지.
   - subView==='compare'일 때만 호출(목록 진입 시 불필요 페치 금지). 의존: startDate/endDate/compareBranchIds.
4. **매트릭스 빌드 + 렌더(useMemo)**:
   - rows = 기간 내 등장한 날짜(오름차순), cols = compareBranchIds 순서(branches 이름 매핑).
   - cell[date][branch] = 해당 셀 total_amount 합.
   - 행 끝 = 그 날짜 선택지점 총계 / 맨 아래 합계 행 = 지점별 기간 합계 / 우하단 = 총계.
   - 빈 셀 0 + toLocaleString. 표만, 차트 없음. 셀 `…원` 포맷, 기존 화면과 통일.
5. **CSV**: Out of Scope. 넣지 말 것.

## Out of Scope (넣지 말 것 → surface 시 BUILD-LOG Known Gaps)
- 차트/그래프
- 비교뷰 CSV 내보내기
- discount/환불액 반영 순매출 컬럼
- RPC/마이그레이션/AI schema 동기화
- 지점직원용 비교뷰(권한상 숨김 확정)
- 결제수단·채널별 분해

## Acceptance
- 본사/관리자: '목록 | 지점비교' 토글 노출. 지점직원: 토글 안 보임(기존 목록만).
- '지점비교' → 기본 전체 지점 선택 매트릭스. 체크박스 부분선택 시 표 즉시 갱신.
- 기간 프리셋/날짜 변경이 비교뷰에도 반영(동일 startDate/endDate 재사용).
- 1000건 넘는 기간(전지점 30일)에서도 합계 안 잘림(페이지네이션 확인).
- 행 총계 = 그 행 셀들 합, 우하단 = 모든 셀 합 = 열 합계의 합(산술 일관).
- CANCELLED/REFUNDED/PARTIALLY_REFUNDED 제외.
- `npm run build` 통과.

## Files
- 수정: `src/app/(dashboard)/pos/SalesListTab.tsx`(유일한 변경 대상)
- 참조: `src/app/(dashboard)/customers/[id]/page.tsx` L235~249(페이지네이션), `src/lib/date.ts`(kstDayStart/kstDayEnd/fmtDateKST)
