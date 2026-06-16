# Review Request — 판매현황 탭·필터 영속화 (req #12)
Date: 2026-06-16
Ready for Review: YES

## Files Changed

### src/app/(dashboard)/pos/page.tsx
- L22-31 — 모듈 스코프 `readMainTab()`: window 가드 + try/catch, 저장값 'list'만 'list' 나머지 'checkout'.
- L329 — `useState<MainTab>(readMainTab)` lazy-init (기존 'checkout' 리터럴 대체).
- L338-343 — mainTab 저장 useEffect 1개 추가 (`localStorage.setItem('pos.mainTab', mainTab)` try/catch). 기존 setMainTab('checkout') 호출은 무수정 — effect가 자동 반영.

### src/app/(dashboard)/pos/SalesListTab.tsx
- L122-156 — `interface PersistedFilters`(20필드) + `readSalesFilters()`(window 가드·JSON.parse try/catch·object 체크, 실패 시 {}).
- L177 — `const saved = readSalesFilters()` 1회 로드.
- L182-184 — period/startDate/endDate lazy-init.
- L188-189 — branchFilter lazy-init: `isBranchUser ? (userBranchId ?? '') : (saved.branchFilter ?? '')` (보안 잠금 — 저장값이 지점 잠금을 덮지 않음).
- L190-201 — paymentFilter/statusFilter/search/debouncedSearch(seed)/includeCancelled, 고급검색 9필드, receiptStatusFilter/approvalStatusFilter lazy-init.
- L207, L209 — subView/listSort lazy-init.
- L220-235 — 저장 useEffect 1개 추가: 20필드 객체 직렬화 → 'salesList.filters', deps 동일 20개.

## Self-Review
- **Richard가 가장 먼저 볼 곳 = branchFilter 보안 잠금**: 저장값이 타 지점이어도 isBranchUser면 무조건 userBranchId. lazy-init에서 분기 처리, 이후 이를 덮는 effect 없음(L943 dropdown은 사용자 입력 전용). ✓
- **모든 요구 필터 영속화**: 브리프 LOCKED 목록 20필드 전부 포함. 제외 목록(compare 파생·모달·loading·orders/branches/staff) 미포함. ✓
- **빈 localStorage 최초 진입**: 모든 lazy-init이 기존 기본값(`?? today/checkout/''/true/false`) 폴백 → 회귀 없음. ✓
- **hydration**: 'use client' 컴포넌트 + 초기렌더가 저장값 그대로 + 저장은 effect → mismatch 없음. build 경고 0. ✓
- **loadOrders 추가 트리거 없음**: L384 `useEffect(()=>loadOrders(),[loadOrders])`가 복원 deps 자동 반영. debouncedSearch seed로 첫 조회 깜빡임 방지. ✓

## Open Questions
- 없음.

## Out of Scope (logged in BUILD-LOG)
- 비교뷰(compare) 기간·grain 완전 복원 — compareInit 가드로 기간 리셋 가능(브리프 허용 Known Gap). subView만 복원.
