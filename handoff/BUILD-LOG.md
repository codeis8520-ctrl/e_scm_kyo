# Build Log

*공유 기록. Arch가 소유.*

---

## Completed Steps

### Step 2 — KST 타임존 Phase A (표시 레이어 표준화)

**상태**: ✅ 배포 완료 (commit `2a8e8a2`, 2026-04-22)

**변경 파일 (12개)**:
- 신규: `src/lib/date.ts` — `Intl.DateTimeFormat({ timeZone: 'Asia/Seoul' })` 기반 포맷터 7종 (Brief 스펙 5종 + 한글 스타일 2종)
- 수정 (UI 표시 경로만):
  - `src/app/api/agent/route.ts` — 에이전트 컨텍스트 "오늘" 표기
  - `src/app/(dashboard)/agent-memory/page.tsx` — 메모리 최근 사용일
  - `src/app/(dashboard)/agent-conversations/page.tsx` — 대화 로그 타임스탬프
  - `src/app/(dashboard)/customers/[id]/page.tsx` — 등록일 + 상담/주문 타임스탬프 + 월 그룹 헤더
  - `src/app/(dashboard)/customers/CampaignTab.tsx` — 캠페인 예약시각 표시 (`fmtScheduled`만, `toDTLocal`은 미해결)
  - `src/app/(dashboard)/DashboardClient.tsx` — 대시보드 주문 타임스탬프
  - `src/app/(dashboard)/inventory/MovementHistoryModal.tsx` — 재고 이동 이력
  - `src/app/(dashboard)/notifications/page.tsx` — 알림 발송 시각
  - `src/app/(dashboard)/pos/ReceiptModal.tsx` — 영수증 날짜/시간 (프린트 포함)
  - `src/app/(dashboard)/production/page.tsx` — 생산 지시 created/produced_at
  - `src/app/(dashboard)/reports/page.tsx` — PDF generatedAt

**주요 결정**:
1. 포맷 로케일은 `sv-SE` 사용 — `ko-KR`은 "2026. 04. 22." 형태로 구분자가 점이라 가독성 떨어짐. `sv-SE`는 "2026-04-22 14:30"의 ISO 유사 출력.
2. Brief 스펙 5종(`fmtDateTimeKST`, `fmtDateKST`, `fmtTimeKST`, `fmtMonthKST`, `fmtDateTimeKSTWithSeconds`) + **추가 2종** (`fmtKoreanDayKST`, `fmtKoreanMonthKST`) — 기존 한글 스타일 유지용(체크리스트 #7 충족). 불필요하면 축소 가능.
3. `Intl.DateTimeFormat` 인스턴스는 모듈 상수로 7개 캐싱 — 매 호출마다 생성하지 않음.
4. 쿼리 경계(`fmtDate` 기반 `todayStr`/`daysAgo`, `toISOString().slice(0,10)`)는 **전부 미변경** — Step 3 영역.
5. 외부 API 경로(`cafe24`/`solapi`), DB insert/update, datetime-local input(`CampaignTab.toDTLocal`)은 미변경.

**빌드**: `npm run build` ✅ 통과 (46 static pages, TypeScript 14.8s).

## Deferred / Known Gaps

### Step 1 — POS 매출처 기본값 개선 (보류)

- 2026-04-22 Brief까지 작성 후 새 우선순위(타임존)로 보류
- 스코프: HQ 역할(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE)은 매출처 자동 선택 제거, BRANCH 역할은 기존 유지
- 건드릴 파일: `src/app/(dashboard)/pos/page.tsx` (약 10줄 내외)
- 재개 조건: Step 2·3 (타임존) 완료 후

### Step 2 — 미해결 건 (Richard 리뷰 대상)

1. `CampaignTab.toDTLocal` (datetime-local input value) — 브라우저 로컬 TZ 의존. KST 고정은 input onChange 쪽도 함께 재설계 필요. 현재 KR 사용자 환경에서는 버그 없음.
2. 추가 formatter(`fmtKoreanDayKST`, `fmtKoreanMonthKST`)의 포함 여부 — Brief 스펙 범위 판단 필요.

### Step 3 — KST 타임존 Phase B (쿼리 경계) 예정

- 미변경 callsite: `pos/SalesListTab.tsx` / `agent-conversations/page.tsx` / `customers/[id]/page.tsx`의 `fmtDate`/`todayStr`/`daysAgo`
- `ai/tools.ts`, `api/dashboard/route.ts`, `api/cafe24/members/route.ts`, `b2b-actions.ts`, `campaign-actions.ts` 등 서버 날짜 계산 경로

### Step 3 — KST 타임존 Phase B (쿼리 경계 표준화)

**상태**: 🔄 Conditions 수정, 재리뷰 대기 (Round 2, 2026-04-22)

**신규 유틸 (`src/lib/date.ts` 확장, 7함수)**:
- `kstDayStart(date?)` — KST 자정 → UTC ISO
- `kstDayEnd(date?)` — KST 23:59:59.999 → UTC ISO
- `kstMonthStart(date?)` — 월초 KST → UTC ISO
- `kstMonthEnd(date?)` — 월말 KST 마지막 ms → UTC ISO
- `kstTodayString()` — KST 오늘 "YYYY-MM-DD"
- `kstYearMonth(date?)` — KST "YYYY-MM"
- `kstDaysAgoStart(n)` — KST 기준 N일 전 자정 → UTC ISO

**구현 방식**: `new Date(isoLikeString + '+09:00')` (Brief 권장안) — Date 객체/문자열 입력을 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })`로 KST 달력 parts 추출 후 `YYYY-MM-DDTHH:MM:SS.sss+09:00` 형태로 재조립.

**변경 파일 (32개)**:
- 신규 유틸 추가: `src/lib/date.ts` (+7 함수, 약 130줄)
- 대시보드·보고: `src/app/api/dashboard/route.ts`, `src/app/api/dashboard/details/route.ts`, `src/app/(dashboard)/DashboardClient.tsx`, `src/app/(dashboard)/reports/page.tsx`
- 회계: `src/lib/accounting-actions.ts`, `src/app/(dashboard)/accounting/page.tsx`
- POS/환불: `src/app/(dashboard)/pos/page.tsx`, `src/app/(dashboard)/pos/SalesListTab.tsx`, `src/app/(dashboard)/pos/RefundModal.tsx`, `src/lib/return-actions.ts`
- 매입: `src/lib/purchase-actions.ts`, `src/app/(dashboard)/purchases/page.tsx`, `src/app/(dashboard)/purchases/prices/page.tsx`
- 고객/캠페인: `src/app/(dashboard)/customers/[id]/page.tsx`, `src/app/(dashboard)/customers/CampaignTab.tsx`, `src/lib/campaign-actions.ts`, `src/lib/customer-analytics-actions.ts`
- 외상/B2B: `src/app/(dashboard)/credit/page.tsx`, `src/lib/credit-actions.ts`, `src/app/(dashboard)/trade/CreditTab.tsx`, `src/app/(dashboard)/trade/B2bSalesTab.tsx`, `src/lib/b2b-actions.ts`
- 알림/배치: `src/app/(dashboard)/notifications/page.tsx`, `src/lib/notification-actions.ts`, `src/app/api/notifications/batch/dormant/route.ts`, `src/app/api/notifications/batch/birthday/route.ts`
- Cafe24 연동: `src/app/api/cafe24/sync-orders/route.ts`, `src/app/api/cafe24/members/route.ts` (디폴트값만), `src/app/api/cafe24/orders/route.ts`, `src/app/api/cafe24/debug/route.ts`, `src/lib/cafe24/webhook.ts`
- 에이전트/기타: `src/lib/ai/tools.ts`, `src/app/(dashboard)/agent-conversations/page.tsx`, `src/lib/production-actions.ts`, `src/lib/actions.ts` (POS 주문번호), `src/app/(dashboard)/inventory/count/page.tsx`, `src/app/(dashboard)/shipping/page.tsx`, `src/app/join/[branch]/JoinForm.tsx`

**주요 결정**:
1. **치환 판단 기준**: 사용자 "오늘/이번 달/최근 N일" 의미 → 치환. 세션/토큰/감사/외부 API payload/경과시간 → 스킵. 문서번호 prefix(PO/GR/WO/RC/JE/RT/B2B-YYYYMMDD)는 사용자 대면 날짜 → KST로 치환.
2. **`exportSalesCSV`의 `const date` 데드 코드**(reports/page.tsx:401): 선언만 하고 미사용. 스코프 외로 판단하여 유지.
3. **`new Date(baseDate + 'T00:00:00')` 패턴 (dashboard 주 단위 계산)**: `getPeriodRange`의 weekday 계산은 calendar date 대상 pure 연산이라 UTC 해석과 KST 해석 결과가 동일 → 경계 인자(`.gte/.lte`)만 `kstDayStart/End`로 치환.
4. **date-only 컬럼 내 날짜 이동** (campaign-actions.ts nextStart/nextEnd의 `setFullYear(+1)`): UTC midnight 기반 calendar date 연산으로 TZ 영향 없음 → 미변경.
5. **`new Date().toISOString()`가 `created_at/updated_at/sent_at/processed_at` 같은 audit timestamp 필드에 들어가는 경우**: 모두 미변경 (Brief §6.2).
6. **Cafe24 API calendar date 파라미터**: `startDate`/`endDate`는 YYYY-MM-DD 포맷이므로 KST-today 기준 `fmtDateKST`/`kstTodayString` 사용이 안전 (API 스펙 위반 없음).

**빌드**: `npm run build` ✅ 통과 (46 pages, TypeScript 14.4s, 0 errors).

**Round 2 수정 (2026-04-22)** — Richard Conditions 4건:
- `src/lib/ai/tools.ts:1246-1247` (execGetOrders) — `${date}T...` → `kstDayStart/kstDayEnd`
- `src/lib/ai/tools.ts:2357-2358` (execCompareSales periodSummary) — 동일 패턴 치환
- `src/app/(dashboard)/pos/SalesListTab.tsx:9,192-193` — import에 `kstDayStart/End` 추가 + 쿼리 경계 치환
- `src/lib/b2b-actions.ts:173-189` (MONTHLY 정산예정일) — `getFullYear/getMonth` 제거, `kstTodayString()` 파싱 기반 다음 달 조립 (12월→1월 wrap 포함)
- `npm run build` ✅ 재통과 (46 pages, 0 errors).

**Round 2 Richard 리뷰**: ✅ APPROVED (드리프트 없음, 3 파일 한정)

**배포**: ✅ commit `db58077` (2026-04-22)

### Step 4 — POS 판매 등록: 완제품만 노출

**상태**: Bob 빌드 완료, Richard 리뷰 대기 (2026-04-22)

**변경 파일 (2개)**:
- `src/app/(dashboard)/pos/page.tsx` (L274 주변, 초기 데이터 로드) — 제품 로드 쿼리에 `product_type` 추가 + 마이그 042 미적용 폴백. 이후 `p.product_type !== 'RAW' && p.product_type !== 'SUB'` in-memory 필터를 setProducts/productMap 양쪽 앞단에 배치.
- `src/lib/actions.ts` (L1111 주변, `processPosCheckout`) — 재고 확인 직전에 RAW/SUB 서버 방어 블록 신설. cart productId들을 `products.in('id', [...])`로 한 번에 조회 후 RAW/SUB 있으면 한글 에러 반환. 폴백: 쿼리 에러 시 검증 스킵.

**주요 결정**:
1. 클라이언트 필터링은 `products` state 한 경로에서만 이루어지고, `filteredProducts`·`productMap`은 파생 객체라 자동 반영 — 수정 최소화.
2. 서버 방어는 `sales_order_items` insert 이전(재고 확인 이전)에 실행하여 DB 어떤 변경도 발생시키지 않고 즉시 중단.
3. 주석 넘버링은 기존 ①∼⑥을 유지하기 위해 새 가드 블록에 `⓪`을 부여하여 후속 번호 시프트 최소화.
4. 마이그 042 미적용 DB에서는 필터·서버 검증 모두 스킵(운영 차단 방지). 실제 운영 DB에는 042가 이미 적용되어 있어 차단이 유효.
5. `isMaterialType` 등 헬퍼 재정의 없이 인라인 조건으로 스코프 최소화 (Brief §Flag).

**빌드**: `npm run build` 통과 (46 pages, 0 errors).

## Current Status

Step 4 빌드 완료, Richard 리뷰 대기.
