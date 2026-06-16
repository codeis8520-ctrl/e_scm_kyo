# Architect Brief — 판매현황 탭·필터 영속화 (req #12)

## Goal
판매관리 화면을 새로고침해도 판매등록(checkout)으로 튕기지 않고, 직전에 보던 판매현황(list) 탭과 조회 조건(기간/검색/필터/뷰)이 그대로 복원된다.

## 설계 — 영속화 = localStorage (LOCKED)
- URL 아님. 필터 다수 + 목적이 "새로고침 생존". localStorage 채택.
- 키 네임스페이스:
  - `pos.mainTab` — 문자열 'checkout'|'list'
  - `salesList.filters` — JSON 객체 (아래 필터 묶음)
- 복원 패턴 = **useState lazy init**(초기화 함수 안에서 `typeof window !== 'undefined'` 가드 후 localStorage 읽기) + **변경 시 useEffect로 직렬화 저장**. 마운트 후 effect 저장이라 hydration mismatch 없음('use client' 컴포넌트, 초기 렌더 = 저장값 동일).

## Build Order

### A. pos/page.tsx — mainTab 영속화
- L20 `type MainTab = 'checkout' | 'list'`. L319 `useState<MainTab>('checkout')`.
- L319 초기값을 lazy init으로: `useState<MainTab>(() => readMainTab())` — localStorage `pos.mainTab` 읽어 'list'면 'list', 그 외/없음/window 없음 → 'checkout'.
- `setMainTab`을 감싸지 말고, **`mainTab` 변경 useEffect 추가**: `useEffect(() => { try { localStorage.setItem('pos.mainTab', mainTab) } catch {} }, [mainTab])`. (L618/705/1454의 `setMainTab('checkout')` 호출은 effect가 자동 반영 — 별도 수정 불필요.)
- 작은 헬퍼 `readMainTab()`는 컴포넌트 밖 모듈 스코프 함수로.

### B. SalesListTab.tsx — 필터 묶음 영속화
영속화 대상(LOCKED, 한 객체 `salesList.filters`로):
- period, startDate, endDate
- search
- branchFilter  ← **isBranchUser 가드 필수(아래 Flag)**
- paymentFilter, statusFilter
- subView, listSort
- receiptStatusFilter, approvalStatusFilter
- 고급검색: showAdvanced, consultSearch, productSearch, orderOptionSearch, recipientSearch, addressSearch, handlerFilter, shipFromFilter
- includeCancelled

**제외(영속화 금지)**: compareBranchIds (L328-330 branches 로드 effect가 강제 덮어씀 — 무의미), compareGrain/compareInit/compareRows 등 비교뷰 파생/로딩 상태, selectedOrderId·모달류, orders/branches/staff/loading.

구현:
- 모듈 스코프 `readSalesFilters(): Partial<Persisted>` — window 가드 + JSON.parse try/catch, 실패 시 `{}`.
- 각 해당 useState(L133~156, 164, 166) 초기값을 lazy init으로 변경: 저장값 있으면 사용, 없으면 **기존 기본값 그대로** 폴백.
  - branchFilter(L138) 기본값 식 `isBranchUser && userBranchId ? userBranchId : ''` 은 유지하되, **branch 사용자면 저장값 무시하고 무조건 잠금값** 사용(Flag 참조).
- `debouncedSearch`(L142) 초기값도 저장된 search로 seed(`() => readSalesFilters().search ?? ''`) — 복원 직후 첫 loadOrders가 곧장 검색 반영(안 하면 400ms 후 재조회로도 맞지만 깜빡임). seed 권장.
- 저장 effect 1개 추가: 위 대상 state들을 deps로 묶어 객체 만들어 `localStorage.setItem('salesList.filters', JSON.stringify(...))` (try/catch). 기존 effect들 건드리지 말 것.

## Flags — Bob 추측 금지
- **branchFilter / isBranchUser**: BRANCH_STAFF·PHARMACY_STAFF는 자기 지점 고정(L138 로직). 저장값에 다른 지점이 들어있어도 **절대 적용 금지**. 복원은 `isBranchUser ? (userBranchId ?? '') : (saved.branchFilter ?? '')` 식으로 분기. 지점 잠금 침해 = 보안 결함.
- **loadOrders 자동 트리거**: L325 `useEffect(() => loadOrders(), [loadOrders])`. loadOrders는 useCallback이고 복원된 필터가 deps에 포함 → **추가 트리거 코드 작성 금지**. 복원값이 첫 조회에 자동 반영됨.
- **검색어 vs 날짜필터**: loadOrders L198-203 — 검색어(any) 있으면 날짜무시·전기간 2000행. 복원으로 search가 차 있으면 이 경로를 탄다(의도된 기존 동작). 변경 금지.
- **period 복원**: period는 useEffect로 날짜를 되돌리는 로직 없음(applyPeriod 함수에서만 setStartDate). 따라서 period='custom'+커스텀 날짜를 같이 저장/복원해도 충돌 없음. 그대로 묶어 저장.
- **compare init effect**(L379-385): subView='compare' 저장 후 복원 시, compareInit가 false라 기본기간으로 덮음. compareInit는 영속화 안 하므로 비교뷰 복원 시 기간이 올해1/1~오늘로 리셋될 수 있음 — **허용**(Known Gap, 비교뷰는 list 대비 부차). subView만 복원하면 충분.

## Out of Scope
- 다른 페이지(고객/재고/회계 등) 필터 영속화.
- URL 쿼리 동기화/공유링크.
- 비교뷰(compare) 기간·grain 완전 복원 (위 Flag대로 부분만).
- DB/마이그/schema.ts/tools.ts — **무변경 확인됨**.

## Acceptance
- 판매현황(list) 탭에서 기간·검색어·지점/결제/상태 필터·subView·정렬을 바꾼 뒤 F5 → 판매현황 탭 유지 + 모든 조건 그대로 + 목록이 그 조건으로 재조회됨.
- 판매등록(checkout)에서 F5 → checkout 유지(기존 동작 회귀 없음).
- BRANCH_STAFF 계정: 저장값에 타 지점이 있어도 새로고침 후 branchFilter = 본인 지점 고정.
- localStorage 비어있는 최초 진입 = 기존 기본값(today/checkout)과 동일.
- npm run build 통과, hydration 경고 없음.
