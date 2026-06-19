# Architect Brief — 대시보드 본부대표용 실용 개선 3종

## Goal
본부대표 대시보드에 (1) '오늘 할 일' 처리대상 액션 카드 4종, (2) 오늘/어제/7일 매출 추이 비교, (3) 활성 지점별 기간 매출 순위 막대 — 3섹션을 기존 화면 무손상으로 추가.

## 핵심 사전결정 (Bob 반드시 준수)

### ★ 매출 규약 #18 적용 — 단, 적용 범위 한정 (Flag)
- 신규 추가하는 모든 매출 합산 쿼리(액션카드 미수금, 매출추이, 지점순위)는 **매출 = total_amount − COALESCE(discount_amount,0)** 로 집계. (#18, schema.ts L65)
- ⚠️ **기존 periodTotal/onlineAmount/channelSales는 현재 raw total_amount 합산이라 #18 위반 상태다. 이번 스텝에서는 기존 필드를 건드리지 않는다(무손상 원칙).** 기존 라인의 #18 정합 보정은 별도 스텝(BUILD-LOG Known Gap 등록). Bob은 신규 쿼리에만 #18 적용.

### RBAC / 활성지점
- `isBranchUser = userRole ∈ {BRANCH_STAFF, PHARMACY_STAFF}`. 이 경우 `branchId = userBranchId`로 고정(route.ts L74-75 기존 패턴 그대로 재사용).
- **지점 사용자: 미수금·미발송·지점순위 모두 자기지점만.** 지점순위 섹션은 지점 사용자에게는 자기지점 1행만(또는 UI에서 섹션 숨김 — C 참조).
- 활성지점 한정: 지점순위는 `branches.is_active=true`만. 기존 branchesResult가 이미 `.eq('is_active', true)` 적용 중 — 그 목록을 단일 출처로 재사용.

### 성능
- 신규 쿼리는 전부 기존 `Promise.all([...])` 배열에 추가(병렬). 별도 await 직렬 금지.
- 7일 추이는 1쿼리(7일 전체 범위 fetch 후 JS에서 KST 일자 버킷팅). 7회 쿼리 금지.

---

## (A) API 신규 쿼리 명세 — `src/app/api/dashboard/route.ts`

기존 Promise.all 배열에 아래 4그룹 추가. 전부 branchId 필터(있으면 `.eq('branch_id', branchId)`) 반영.

### A1. 미수금 총액 + 건수 (액션카드 ①)
- `sales_orders` where `approval_status='UNSETTLED'` (status 무관 — 미수금은 라이프사이클축, schema.ts L201-205).
- select `total_amount, discount_amount`. 합 = Σ(total_amount − COALESCE(discount_amount,0)). 건수 = rows.length.
- 반환: `unsettledTotal`, `unsettledCount`.

### A2. 미발송 택배 건수 (액션카드 ②)
- `shipments` where `status IN ('PENDING','PRINTED')` (shipping/page.tsx PENDING_STATES와 일치).
- count head:true. **shipments는 branch_id가 '출고지점' 의미**(메모리 cj_sender). 지점 사용자 필터는 shipments.branch_id 기준 `.eq('branch_id', branchId)`. 단 branch_id NULL 카페24 건 존재 가능 → 지점 사용자에겐 NULL 제외(자기 것 아님), 본사(ALL)는 전체 카운트.
- 반환: `unshippedCount`.

### A3. 발주 대기 / 안전재고 미달 (액션카드 ③④) — 신규 쿼리 없음
- ③ `pendingPOCount` 기존 재사용. ④ `lowInventory.length` 기존 재사용. UI에서만 카드화.

### A4. 7일 일별 매출 추이 (섹션 B)
- 단일 쿼리: `sales_orders` where `status IN SALES_STATUSES` AND `ordered_at` ∈ [today−6일 00:00 KST, today 23:59 KST]. select `total_amount, discount_amount, ordered_at`. branchId 필터 반영.
- JS 후처리: `kstDayStart/End` 또는 ordered_at을 KST 일자로 변환해 7개 버킷(날짜 오름차순) 합산(#18). 빈 날짜는 0.
- 오늘/어제 값은 이 7일 배열에서 도출(today bucket, today−1 bucket). 증감% = 어제 0이면 null(UI에서 '—').
- 이번달 누적: 별도 쿼리 또는 기존 monthly periodTotal 재사용 불가(기간필터 가변) → **독립 쿼리** `sales_orders` where status IN SALES_STATUSES AND ordered_at ∈ [이번달 1일 00:00 KST, today 23:59 KST], #18 합. branchId 반영. (B섹션은 기간필터와 독립 — 항상 today 고정.)
- 반환: `salesTrend: { date: 'YYYY-MM-DD', total: number }[]`(7개), `monthToDateTotal: number`. today/yesterday/증감%는 UI에서 salesTrend로 계산(추가 필드 불요) 또는 명시 반환 `todayTotal`,`yesterdayTotal`.

### A5. 지점별 기간 매출 순위 (섹션 C)
- **RPC `branch_sales_summary` 사용 금지 결정 → sales_orders 직접 group**: RPC는 legacy+신규 통합이고 grain·기간 구조라 '활성지점 기간순위 막대' 용도엔 과함. 대신:
  - `sales_orders` where status IN SALES_STATUSES AND ordered_at ∈ [periodStartISO, periodEndISO](기존 기간필터 재사용 — 이 섹션은 상단 기간필터 반영). select `branch_id, total_amount, discount_amount`. **단 branchId 필터는 적용하지 않음**(전 지점 비교가 목적) — 단, 지점 사용자(isBranchUser)면 `.eq('branch_id', userBranchId)`로 자기지점만.
  - JS: branch_id별 #18 합산 → 활성 branches(branchesResult, is_active=true) 목록과 join(이름). 비활성/NULL branch_id 매출은 순위에서 제외(활성지점 한정 원칙). desc 정렬.
- 반환: `branchRank: { branch_id, branch_name, total }[]`(활성지점만, total desc).

> Flag: A5는 신규 channel 매출과 달리 channel 필터 미적용(지점 비교 목적). channel 필터 거는지 여부 — **미적용으로 확정**(상단 channel은 channelSales/periodTotal 전용).

## (B) 반환 확장 (기존 필드 전부 보존, 추가만)
route.ts 최종 NextResponse.json에 추가:
`unsettledTotal, unsettledCount, unshippedCount, salesTrend, monthToDateTotal, todayTotal, yesterdayTotal, branchRank`.
DashboardData 인터페이스(DashboardClient.tsx L40-54)에도 동일 옵셔널/필수 필드 추가.

## (C) UI 섹션/카드 설계 — `src/app/(dashboard)/DashboardClient.tsx`

배치 순서 (위→아래):
1. **[신규] 처리대상 액션 카드 4종** — 기존 요약카드(L322 grid) **위**에 별도 grid(grid-cols-2 md:grid-cols-4). 각 카드 `cursor-pointer` + `<Link>` 또는 `useRouter().push`:
   - ① 미수금: `unsettledTotal`원 / `unsettledCount`건 → `/trade` (외상 매출 탭 default).
   - ② 미발송 택배: `unshippedCount`건 → `/shipping`.
   - ③ 발주 대기: `pendingPOCount`건 → `/purchases`.
   - ④ 안전재고 미달: `lowInventory.length`건 → `/inventory`.
   - 0건이면 카드 회색/비강조(클릭은 허용). >0이면 색강조(미수금=red, 미발송=amber, 발주=blue, 재고=orange).
   - `next/link` 이미 import됨(L4). 새 라우터 훅 불필요하면 Link 사용.
2. **[신규] 오늘·어제·7일 매출 추이** — 액션카드 아래 card. 좌: 오늘 매출(큰 숫자) + 어제대비 증감%(▲red/▼blue, 어제0이면 '—'). 중: 이번달 누적(`monthToDateTotal`). 우: 최근 7일 미니 막대(`salesTrend` — 순수 div height %, 차트 라이브러리 금지). 막대 hover시 날짜·금액 title. **이 섹션은 상단 기간필터와 무관하게 항상 today 기준**(주석 명시).
3. **[신규] 지점별 매출 순위** — 위 아래 card. `branchRank` 가로 막대(최대값 대비 width %). 지점명 + 금액. `isBranchUser`면 자기지점 1행만 표시되므로 **섹션 제목을 '우리 지점 매출'로 바꾸거나, isBranchUser면 섹션 자체 숨김**(택1 — 숨김 권장, 비교 의미 없음).
4. 이하 기존 채널별매출/지점재고/최근주문(L370~) **그대로**.

링크 라우트 확정: `/trade`, `/shipping`, `/purchases`, `/inventory` (모두 존재 확인됨).

## (D) RBAC·활성지점 — 위 A/C에 인라인 명시. 요약:
- 지점 사용자: 모든 신규 데이터 자기지점만(미수금·미발송·추이·순위). 지점순위 섹션 숨김 권장.
- 활성지점만: 지점순위는 is_active=true branches와 join한 것만 노출.

## (E) 보존 (무손상 — 0줄 변경)
- 기존 periodTotal/periodCount/channelSales/branchInventory/recentOrders/lowInventory/onlineOrders/onlineAmount/monthPurchaseTotal/monthReturnTotal/pendingPOCount **반환·계산 로직**.
- `openDetail` 모달 3종(channel_sales/branch_inventory/recent_orders)·detail fetch.
- 기간필터(period/selectedDate)·channel 필터·viewMode 토글.
- 모바일 반응형(grid responsive classes 유지).
- AI Sync: 대시보드는 화면 전용 → schema.ts/tools.ts **무변경**(매트릭스 해당없음). DB/마이그 없음.

## Out of Scope (→ BUILD-LOG Known Gaps)
- 기존 periodTotal/onlineAmount/channelSales의 #18 미정합(raw total_amount 합산) 보정 — 별도 스텝.
- 액션카드 deep-link 쿼리파라미터(예: /trade?tab=credit, /shipping?status=PENDING) — trade/shipping 페이지가 URL param 미지원. 단순 페이지 이동만.
- branch_sales_summary RPC(legacy 통합) 연계 순위 — 이번엔 신규 sales_orders만 집계(legacy 제외). legacy 포함 순위 필요 시 별도.
- 차트 라이브러리 도입(스파크라인은 div 막대로).

## Acceptance
- 본사 계정: 액션카드 4종 숫자 표시·클릭 시 각 화면 이동. 추이 섹션 오늘/어제/7일 막대·이번달누적. 지점순위 활성지점 desc 막대.
- 지점 계정: 4카드 자기지점만, 추이 자기지점, 지점순위 숨김(또는 자기지점만).
- 모든 신규 매출 = total−discount(#18). 기존 카드·모달·필터 회귀 0.
- `npm run build` 0 error. 기존 필드 반환 형태 무변경.
