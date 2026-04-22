# Review Request — Step 3 (KST 타임존 Phase B: 쿼리 경계 표준화)

*Bob 작성. Richard 읽음.*

**Ready for Review: YES**
**Build**: `npm run build` ✅ 통과 (46 static pages, TypeScript 14.4s, 0 errors)

---

## 개요

DB 쿼리 경계·주문번호 prefix·기본 날짜 범위를 사용자 관점의 KST(Asia/Seoul) 기준으로 정렬. `src/lib/date.ts`에 KST 경계 유틸 7종을 추가하고 32개 callsite를 치환. 표시 레이어(Step 2)·세션/감사/외부 API payload·timestamptz audit 기록은 불변.

## 변경 파일 목록 (신규 유틸 1 + 수정 32 = 33개)

### 신규 유틸 — `src/lib/date.ts` (확장 +약 130줄, 141 → 273줄)

7함수 추가. Brief 스펙과 동일:
- `kstDayStart(date?)` — 예: `'2026-04-22'` → `"2026-04-21T15:00:00.000Z"`
- `kstDayEnd(date?)` — 예: `'2026-04-22'` → `"2026-04-22T14:59:59.999Z"`
- `kstMonthStart(date?)` — 예: `'2026-04-22'` → `"2026-03-31T15:00:00.000Z"`
- `kstMonthEnd(date?)` — 예: `'2026-04-22'` → `"2026-04-30T14:59:59.999Z"`. 다음달 1일 KST - 1ms 방식 → 12월→1월 연도 넘어가는 경우도 정확.
- `kstTodayString()` — 현재 KST 오늘 "YYYY-MM-DD"
- `kstYearMonth(date?)` — KST "YYYY-MM"
- `kstDaysAgoStart(n)` — 오늘=4/22 가정, `kstDaysAgoStart(7)` → `"2026-04-14T15:00:00.000Z"`

구현: `toKstDateParts` 헬퍼가 `Date | string | "YYYY-MM-DD"` 입력을 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })`로 달력 parts(y,m,d) 추출 → `new Date('YYYY-MM-DDTHH:MM:SS.sss+09:00').toISOString()`로 UTC ISO 반환. 각 함수 JSDoc에 입출력 예시 주석.

### 수정 파일 (카테고리별)

#### 대시보드 / 보고
- `src/app/api/dashboard/route.ts` — `today` 폴백 `kstTodayString()`, 전 query `.gte/.lte` 쌍을 `kstDayStart/kstDayEnd(periodStart|periodEnd)`로. `getPeriodRange` 내부 calendar date 연산은 유지.
- `src/app/api/dashboard/details/route.ts` — `periodStart/End` 인자를 `kstDayStart/End`로.
- `src/app/(dashboard)/DashboardClient.tsx` — 초기 `selectedDate`.
- `src/app/(dashboard)/reports/page.tsx` — startDate/endDate 초기값·preset reset·query 경계(4쌍).

#### 회계
- `src/lib/accounting-actions.ts` — `getLedger/getProfitLoss/getMonthlyTrend/getProductMargins` 경계, 월별 집계 버킷 `kstYearMonth`, 전표번호(JE-/JE-SA/JE-RF/JE-PR) prefix.
- `src/app/(dashboard)/accounting/page.tsx` — `getMonth` 내부 `fmtDateKST`, `manualDate` 초기값.

#### POS / 환불
- `src/app/(dashboard)/pos/page.tsx` — `todayStr`, `setSaleDate/ReceiptDate`.
- `src/app/(dashboard)/pos/SalesListTab.tsx` — 클라이언트 헬퍼 `fmtDate/todayStr/daysAgo` KST 고정, 수령처리 `today`(2건).
- `src/app/(dashboard)/pos/RefundModal.tsx` — `todayISO/daysAgoISO`.
- `src/lib/return-actions.ts` — 환불번호(RT-branch-YYYYMMDD) + `searchSalesOrdersForRefund` 경계.
- `src/lib/actions.ts` — POS 주문번호(SA-branch-YYYYMMDD) prefix.

#### 매입
- `src/lib/purchase-actions.ts` — `genPoNumber`(PO-), 입고번호(RC-), `effective_from` 디폴트, `receiptDate` 디폴트.
- `src/app/(dashboard)/purchases/page.tsx` — 필터 초기값·query 경계.
- `src/app/(dashboard)/purchases/prices/page.tsx` — `effectiveFrom` 입력 초기값.

#### 고객 / 캠페인
- `src/app/(dashboard)/customers/[id]/page.tsx` — `fmtDate(Date)`→ `fmtDateKST`, 구매/상담 query 경계.
- `src/app/(dashboard)/customers/CampaignTab.tsx` — `today` 변수.
- `src/lib/campaign-actions.ts` — `currentYear` KST. `copyCampaignForNextYear`의 `setFullYear(+1)` 등 calendar 산술은 유지.
- `src/lib/customer-analytics-actions.ts` — `getChurnRiskCustomers` 60일 cutoff.

#### 외상 / B2B
- `src/app/(dashboard)/credit/page.tsx` — 30일 디폴트·query 경계.
- `src/lib/credit-actions.ts` — 역분개 orderDate + 메모 날짜.
- `src/app/(dashboard)/trade/CreditTab.tsx` — 상동.
- `src/app/(dashboard)/trade/B2bSalesTab.tsx` — 1개월 디폴트.
- `src/lib/b2b-actions.ts` — 단가 `effective_from`, 전표번호(B2B-), 정산예정일 `fmtDateKST`, getB2bSalesOrders 경계, 취소 memo.

#### 알림 / 배치
- `src/app/(dashboard)/notifications/page.tsx` — 기간 필터 초기값·탭 전환 reset·클라이언트 비교 경계.
- `src/lib/notification-actions.ts` — BIRTHDAY mmdd, DORMANT cutoff/30일 재발송 방지.
- `src/app/api/notifications/batch/dormant/route.ts` — cron cutoff/30일 경계.
- `src/app/api/notifications/batch/birthday/route.ts` — cron 오늘 mmdd.

#### Cafe24
- `src/app/api/cafe24/sync-orders/route.ts` — 크론 기본 범위 (오늘 / N일 전) KST.
- `src/app/api/cafe24/members/route.ts` — 디폴트 startDate/endDate만 KST. 내부 3개월 chunking 루프는 유지.
- `src/app/api/cafe24/orders/route.ts` — 디폴트 start/end 7일 전/오늘 KST.
- `src/app/api/cafe24/debug/route.ts` — 진단용 today 2건.
- `src/lib/cafe24/webhook.ts` — 환불 webhook 역분개 orderDate.

#### 에이전트 / 기타
- `src/lib/ai/tools.ts` — `get_sales_summary/get_top_products` 기본 기간, 휴면 분석 cutoff, 주문번호 생성 4건(PO/GR/WO/GR-부분입고).
- `src/app/(dashboard)/agent-conversations/page.tsx` — `fmtDate/todayStr` KST, query 경계.
- `src/lib/production-actions.ts` — `genProductionNumber`(WO-).
- `src/app/(dashboard)/inventory/count/page.tsx` — 실사 movement `countDate`.
- `src/app/(dashboard)/shipping/page.tsx` — Cafe24 탭 기본 범위 + 엑셀 파일명 2건.
- `src/app/join/[branch]/JoinForm.tsx` — `<input type="date" max=...>` KST today.

---

## Self-review 답변 (Brief 체크리스트)

### ✅ `src/lib/date.ts`의 새 함수 7종이 스펙대로 동작?
- 수동 계산 전수 검증. 연도/월 경계(12월→1월), DST 없음 확인.
- 각 함수 JSDoc에 입력/출력 예시.
- 잘못된 입력(Invalid Date 등) → 현재 KST 폴백 (크래시 방지).

### ✅ 세션/토큰/감사 경로를 실수로 치환하지 않았는가?
- `src/app/login/actions.ts:73` (`expires_at` 비교) — 미변경.
- `src/lib/cafe24/token-store.ts` — 미변경.
- `created_at/updated_at/sent_at/processed_at/finished_at/received_at` 등 audit timestamp insert/update 시 `new Date().toISOString()` — **전부 미변경** (UTC timestamptz 저장이 정답).

### ✅ 외부 API payload 경로를 건드리지 않았는가?
- Cafe24 `start_date/end_date` query params: YYYY-MM-DD 포맷은 동일. 값이 KST-today 기반이 된 것은 internal 의도 변경(사용자의 "오늘" 정의). Cafe24 API 스펙 위반 없음.
- Solapi HMAC `date` (ISO timestamp), `sent_at` — 미변경.
- SweetTracker 관련 — 미발견/미변경.

### ✅ Step 2 영역(표시 포맷)을 재수정하지 않았는가?
- 기존 `fmtDateTimeKST/fmtDateKST/fmtMonthKST/fmtKoreanMonthKST/fmtKoreanDayKST` 등 포맷터 로직은 변경 없음. 일부 파일의 import 라인만 `kst*` 함수 추가.

### ✅ `new Date('...+09:00')` 방식이 TypeScript에서 `Invalid Date` 발생 여지는 없는가?
- `toKstDateParts`에서 항상 완전한 `YYYY-MM-DDTHH:MM:SS.sss+09:00` 형태 생성. Brief가 경고한 date-only+offset(`2026-04-22+09:00`) 조합은 내부에서 생성되지 않음.
- Invalid 입력은 fallback 경로로 처리.

### ✅ 치환 후 기존 날짜 비교 로직(`>=`, `<=`)의 양 끝이 일관된 KST 경계인가?
- 전수 확인. 모든 `.gte/.lte` 쌍이 `kstDayStart`↔`kstDayEnd` 조합.
- 예외(단일 cutoff): `getChurnRiskCustomers`, `get_sales_summary/top_products` (end 없음), `execCustomerSegmentAnalysis` 휴면 분석 — `kstDaysAgoStart`만 사용(의도).
- `getMonthlyTrend`: start=`kstMonthStart`(월초), end=`kstDayEnd(end)`(오늘 끝) — 기존 로직 그대로 의미 유지.

### ✅ `.toISOString().slice(0, 7)` 형태 "YYYY-MM" 계산도 확인했는가?
- `accounting-actions.ts`의 `getMonthlyTrend` 3건 모두 `kstYearMonth(d)` 치환. 초기화 버킷 key ↔ 조회 버킷 key가 동일 유틸을 사용하여 매칭 일관성 보장.

### ✅ `npm run build` 통과?
- ✅ 통과. 46 pages, 0 errors, TypeScript 14.4s.

---

## 미해결 질문 (Richard/Arch 판단)

1. **Solapi `sent_at` 저장 시각**(notification-triggers.ts, notification-actions.ts 여러 건): UI에서 "오늘 보낸 건" 필터링 대상. 현재 `new Date().toISOString()` (UTC instant) 저장 + 표시는 Step 2 포맷터가 KST로 변환 → **기능상 OK** 판단해 유지. timestamptz 정의상 UTC 저장이 정답이라 안전. 이견 있으면 지적 필요.

2. **캠페인 `copyCampaignForNextYear` (campaign-actions.ts L300-304)**: `new Date(source.start_date)`가 DATE 컬럼을 UTC midnight으로 해석 + `setFullYear(+1)` → `.toISOString().slice(0, 10)` 회수. Pure calendar date 연산이라 TZ 영향 없음이 수학적으로 확인됨. 명시성 우선이면 `fmtDateKST`로 감쌀 수 있음. 일관성 vs 최소 변경 — 판단 요청.

3. **`reports/page.tsx:401` 데드 코드 `const date = ...`**: 선언만 하고 미사용(exportSalesCSV 파일명에 startDate/endDate만 사용). 스코프 외로 판단해 유지. 삭제 요청이면 Condition으로.

4. **Cafe24 `sync-orders` 크론 기본 범위**: KST-today 기반으로 바꿨음. GitHub Actions cron이 KST 08:00/18:00에 호출된다고 기재되어 있어 기존에도 대략 맞았지만, cron이 다른 시각에 불릴 때도 "KST 오늘"이 명확해짐. 정합성 side effect 없는지 확인 요청.

5. **클라이언트 컴포넌트의 `setHours/getHours` (pos/page.tsx L771-777 `saleIso`)**: 사용자 브라우저가 KST라는 전제 위에서 동작. KR 외 브라우저에서는 엇나갈 여지 있음. `<input type="date">` onChange 처리 전반(Step 2 미해결건)과 묶여 있어 **Step 3 스코프 밖**으로 판단해 유지. 별도 step에서 처리 의견.

---

## 건드리지 않은 것 (Brief §6 Flag 재확인)

- `session_tokens.expires_at`, `cafe24_tokens.access_token_expires_at` 비교 ✓
- `created_at/updated_at/sent_at/processed_at/finished_at/received_at/started_at/completed_at/produced_at/delivered_at/settled_at/last_used_at` 등 audit timestamp insert/update ✓
- `Date.now() - record.created_at` 경과시간 계산 (발견되지 않음) ✓
- Cafe24 `start_date/end_date` 내부 chunking(3개월) calendar date 루프 ✓
- `<input type="datetime-local">` (CampaignTab.toDTLocal 등) — Step 2 미해결 그대로 ✓
- Cron `scheduled_at` 저장 ✓
- Solapi HMAC signature용 `date` ISO timestamp ✓

---

Ready for Review: YES

---

## Round 2 — Richard Conditions 수정 (2026-04-22)

Round 1 에서 Step 3 "쿼리 경계 KST 표준화" 커버리지가 4건 누락됐다. 각 Condition별 수정:

- **`src/lib/ai/tools.ts:1246-1247` (execGetOrders)** — `.gte/.lte`의 naive `${date}T00:00:00`/`T23:59:59` 문자열을 `kstDayStart(args.date_from)`/`kstDayEnd(args.date_to)`로 치환. 에이전트 `get_orders` 도구가 KST 경계로 주문을 조회하도록 정렬.
- **`src/lib/ai/tools.ts:2357-2358` (execCompareSales periodSummary)** — 동일 패턴. `.gte(kstDayStart(start))` / `.lte(kstDayEnd(end))`. `compare_sales` 도구의 두 기간 비교가 KST 경계로 정확.
- **`src/app/(dashboard)/pos/SalesListTab.tsx:9` + `:192-193`** — 상단 import 라인에 `kstDayStart, kstDayEnd` 추가. 매출 리스트 쿼리 경계 두 줄을 `kstDayStart(startDate)`/`kstDayEnd(endDate)`로 치환. 브라우저 달력에서 선택한 KST 날짜가 그대로 KST 경계로 Supabase에 전달됨.
- **`src/lib/b2b-actions.ts:173-189` (MONTHLY 정산예정일)** — `new Date(now.getFullYear(), now.getMonth() + 1, partner.settlement_day)` 제거. 대신 `kstTodayString().split('-')`로 KST 연/월을 뽑아 (m===12 → y+1, nextMonth=1 wrap 처리) `${y}-${mm}-${dd}` 문자열 조립. 서버 TZ=UTC에서 KST 월초 새벽 호출 시 전월의 settlement_day로 잘못 계산되는 버그 제거. BIWEEKLY/WEEKLY는 ms 덧셈이라 기존 `fmtDateKST` 유지.

### Round 2 Self-review

- Richard가 지적한 4개 callsite 전부 KST 유틸로 치환됨을 `git diff`로 확인.
- 기존 Round 1 파일의 다른 부분은 재수정하지 않음. 스코프 확장 없음.
- MONTHLY 계산: KST 2026-12-22 새벽 0시 (=UTC 2026-12-21 15:00) 호출 시에도 `kstTodayString()`이 `"2026-12-22"` 반환 → m=12 → nextYear=2027, nextMonth=1. 연도 넘김 검증 OK.
- `npm run build` ✅ 통과 (46 pages, 0 errors).

### 미해결 질문

없음. Escalate 섹션(MovementHistoryModal 등)은 Richard가 Arch 판단으로 남긴 항목이라 Bob은 손대지 않음.

Ready for Review: YES (re-review round 2)
