# Review Feedback — Step 3

Date: 2026-04-22
Status: APPROVED WITH CONDITIONS

## Conditions

[모든 항목은 머지를 차단. 선택적 항목 없음.]

- **`src/lib/ai/tools.ts:1246-1247` (execGetOrders)** — `date_from/date_to` 경계가 여전히 `${args.date_from}T00:00:00` / `${args.date_to}T23:59:59` (naive 문자열, Postgres가 server TZ=UTC로 해석). 에이전트가 "오늘 주문 보여줘" / "최근 일주일" 호출 시 KST 사용자 대면 의미와 어긋나 Step 3 스펙 위반. `.gte('ordered_at', kstDayStart(args.date_from))` / `.lte('ordered_at', kstDayEnd(args.date_to))`로 치환.
- **`src/lib/ai/tools.ts:2357-2358` (execCompareSales `periodSummary`)** — 동일 패턴. 에이전트 `compare_sales` 도구가 UTC 경계로 비교하여 KST 월말 매출이 다음 기간에 포함. `kstDayStart(start)` / `kstDayEnd(end)`로 치환.
- **`src/app/(dashboard)/pos/SalesListTab.tsx:192-193`** — Bob이 REVIEW-REQUEST에서 "클라이언트 헬퍼 `fmtDate/todayStr/daysAgo` KST 고정"했다고 기재했으나, 정작 쿼리 경계 `${startDate}T00:00:00` / `${endDate}T23:59:59`는 치환 누락. 사용자가 브라우저 달력 위젯에서 선택한 KST 날짜가 Supabase에 UTC 경계로 전달 → 매출 리스트가 KST 23:00~24:00 구간 주문을 다음 날로 집계. `kstDayStart/kstDayEnd`로 치환.
- **`src/lib/b2b-actions.ts:177` (createB2bSalesOrder MONTHLY 정산예정일)** — 주석은 "KST 기준 YYYY-MM-DD"지만 `new Date(now.getFullYear(), now.getMonth() + 1, partner.settlement_day)`의 `getFullYear/getMonth`는 서버 TZ=UTC 기준. KST 월초 01:00(=UTC 전월 16:00) 호출 시 전월의 settlement_day로 계산 → 한 달 어긋남. BIWEEKLY/WEEKLY는 ms 덧셈이라 안전함. `toKstDateParts(now)`로 KST 연/월을 뽑거나 `kstTodayString()`을 파싱하여 `new Date(Date.UTC(y, m, day))` 조립 권장.

## Escalate to Arch

- **`src/app/(dashboard)/inventory/MovementHistoryModal.tsx:75-76`** — `new Date(dateFrom + 'T00:00:00').toISOString()` 패턴 2건이 Step 3 스코프에 포함되는지 Bob이 판단하지 않고 누락. 브라우저 TZ 의존 경로(POS `saleIso`, CampaignTab `toDTLocal`와 같은 부류)로 묶어 **일괄 Step로 이월할지**, 지금 `kstDayStart/End`로 합류시킬지 — 제품 방향 판단 필요.
- **Solapi `sent_at` UTC 저장 유지 (Bob 미해결 #1)** — 동의. timestamptz 정의상 UTC 저장이 정답이며 표시 레이어가 KST 변환 책임. 확정.
- **`reports/page.tsx:401` 데드 코드 `const date = ...`** — 스코프 외. Bob의 판단 수용, 별도 정리 건.

## Cleared

- `src/lib/date.ts` +130줄 — 7함수(kstDayStart/End/MonthStart/MonthEnd/TodayString/YearMonth/DaysAgoStart) 스펙 그대로. Brief 권장안(`new Date('...+09:00').toISOString()`) 채택, offset ms 하드코딩 없음. 12월→1월 연도 넘김은 `kstMonthEnd`의 "다음 달 1일 KST - 1ms" 방식으로 정확. Invalid Date/null/undefined 입력은 `toKstDateParts` 내부에서 현재 KST 폴백. 각 함수 JSDoc 입출력 예시 검증 통과.
- 대시보드(`api/dashboard/route.ts`) — `periodStartISO/periodEndISO` 한 번 계산 후 6개 쿼리에 재사용, 루프 내 반복 호출 없음. 성능 OK.
- 문서번호 prefix — PO/GR/WO/RC/JE-SA/JE-RF/JE-PR/RT/B2B/SA 전부 `kstTodayString().replace(/-/g, '')` 치환. 사용자 대면 번호가 KST 자정 기준으로 교체됨.
- 회계(`accounting-actions.ts`) — getProfitLoss/getLedger/getProductMargins `.gte/.lte` 쌍 전원 `kstDayStart/kstDayEnd` 짝 일관. `getMonthlyTrend` 월 버킷 초기화(`kstYearMonth(d)`)와 집계 버킷팅(`kstYearMonth(order.ordered_at)`) 동일 유틸로 key 매칭 보장.
- 크론(`api/notifications/batch/dormant/route.ts`, `birthday/route.ts`) — cutoff/recentBlock `kstDaysAgoStart`, mmdd는 `kstTodayString().slice(5)`. KST 기준 휴면/생일 판정.
- Cafe24 — `sync-orders`·`orders`·`debug`는 내부 경계만 KST로 변경, 외부 API가 요구하는 `start_date/end_date` YYYY-MM-DD 포맷은 그대로. `members/route.ts`의 3개월 chunking 루프(`new Date(startDate + 'T00:00:00')`)는 calendar iteration이라 미변경 타당. `cafe24/token-store.ts`·`access_token_expires_at` 비교 미변경 확인.
- 세션/감사/경과 시간 — `session_tokens.expires_at` 비교, `created_at/updated_at/sent_at/processed_at` insert/update의 `new Date().toISOString()`, `Date.now() - x.created_at` 패턴 전부 미변경. Solapi HMAC `date` ISO timestamp 미변경.
- `<input type="datetime-local">` (`CampaignTab.toDTLocal`) 및 cron `scheduled_at` 저장 — Step 2 미해결 그대로 두고 건드리지 않음. Brief §6 Flag 준수.
- `npx tsc --noEmit` 로컬 재검증 통과, unused import 없음. Bob의 `npm run build` 주장 별도 재검증 불필요.

---

## Round 2 Review
Date: 2026-04-22
Status: APPROVED

- **C1 (`src/lib/ai/tools.ts:1246-1247` execGetOrders + `:2357-2358` execCompareSales)**: Resolved. 두 callsite 전부 `.gte(kstDayStart(...))` / `.lte(kstDayEnd(...))` 짝 일관. 파일 전체에 잔존 `T00:00:00`/`T23:59:59` 문자열 없음 (grep 0건).
- **C2 (`src/app/(dashboard)/pos/SalesListTab.tsx:9, 192-193`)**: Resolved. Import 라인에 `kstDayStart, kstDayEnd` 정확히 추가. `ordered_at` 경계 두 줄 모두 KST 유틸로 치환 — half-KST 혼용 없음. 파일 내 naive 경계 grep 0건.
- **C3 (`src/lib/b2b-actions.ts:173-189` MONTHLY 정산예정일)**: Resolved. `kstTodayString().split('-')` → KST 연/월 파싱 → `m===12 ? y+1 : y` / `m===12 ? 1 : m+1` wrap 정확. 12월 KST 호출 시 다음해 1월 조립 검증 OK. BIWEEKLY/WEEKLY는 `now.getTime() + Nd*86400000` (ms 덧셈, TZ-agnostic) + `fmtDateKST`로 최종 YYYY-MM-DD 추출 — 유지 타당.

### Drift check
- `git diff --stat`: 44개 파일 중 Round 2에서 수정된 파일은 위 3개 파일에 한정 (REVIEW-REQUEST.md Round 2 추가분 제외). 스코프 확장 없음.
- 외부 API/세션/감사 timestamp 원칙 불변.
- Build: Bob `npm run build` 통과 주장, import·grep 재검증에서 type error 단서 없음.

## Cleared (Round 2)
Round 1 Conditions 4개 callsite 전원 KST 유틸로 정렬 완료 — Step 3 "쿼리 경계 KST 표준화" 종결.
