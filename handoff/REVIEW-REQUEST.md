# Review Request

*Bob writes. Richard reads.*

---

## Step 2 — KST 타임존 Phase A (표시 레이어 표준화)

### 개요

모든 사용자 대상 UI 날짜·시간 표시를 `Asia/Seoul`로 일관화하기 위해 공용 포맷터(`src/lib/date.ts`)를 신설하고, 표시 경로 callsite 12개를 치환. DB 저장(`timestamptz`), 외부 API payload, 쿼리 경계 계산은 건드리지 않음.

### 변경 파일 (13개 — 신규 1 + 수정 12)

#### 신규

- **`src/lib/date.ts`** (신규 134줄)
  - `fmtDateTimeKST`, `fmtDateKST`, `fmtTimeKST`, `fmtMonthKST`, `fmtDateTimeKSTWithSeconds` — Brief 스펙 5종
  - `fmtKoreanDayKST` (에이전트 컨텍스트 "2026년 4월 22일 수"용), `fmtKoreanMonthKST` ("2026년 4월"용) — 기존 한글 포맷 유지용 추가
  - 전부 `Intl.DateTimeFormat` 기반, 모듈 상수로 캐싱 (로케일 `sv-SE`로 ISO 유사 출력 확보 — ko-KR은 "2026. 04. 22." 형태라 가독성 떨어짐)
  - null/undefined/'' / `Invalid Date` → `'-'` 반환

#### 수정

| 파일 | 라인(approx) | 변경 요약 |
|---|---|---|
| `src/app/api/agent/route.ts` | 6, 112-113 | import 추가 + 에이전트 "오늘" 컨텍스트 `toLocaleDateString('ko-KR', ...)` → `fmtKoreanDayKST(now)` |
| `src/app/(dashboard)/agent-memory/page.tsx` | 4, 171 | import 추가 + 메모리 최근 사용일 표시 `fmtDateKST` |
| `src/app/(dashboard)/agent-conversations/page.tsx` | 4, 36-39 | import 추가 + 대화 로그 `fmtDateTime` 함수 본문 → `fmtDateTimeKST` 위임 (Brief의 `fmtDate`/`todayStr`/`daysAgo`는 쿼리 경계라 미변경) |
| `src/app/(dashboard)/customers/[id]/page.tsx` | 9, 78-81, 249-250, 475 | import 추가 + `fmtDateTime` 함수 본문을 `fmtDateTimeKST`로 위임 + 월 구분자 "YYYY년 M월" 생성부(`d.getFullYear()...`)를 `fmtKoreanMonthKST`로, 등록일 표시를 `fmtDateKST`로. `fmtDate(Date)` (쿼리 경계용)는 유지 |
| `src/app/(dashboard)/customers/CampaignTab.tsx` | 15, 58-61 | import 추가 + `fmtScheduled`(캠페인 예약 시각 표시) 본문 `fmtDateTimeKST` 위임. `toDTLocal`(datetime-local input)은 미해결 질문으로 분류해 미변경 |
| `src/app/(dashboard)/DashboardClient.tsx` | 5, 126-129 | import 추가 + `formatDate` 본문을 `fmtDateTimeKST` 위임 |
| `src/app/(dashboard)/inventory/MovementHistoryModal.tsx` | 5, 42-44 | import 추가 + `fmtDateTime` 본문을 `fmtDateTimeKST` 위임 |
| `src/app/(dashboard)/notifications/page.tsx` | 10, 307 | import 추가 + 알림 목록 `created_at` 표시 `fmtDateTimeKST` |
| `src/app/(dashboard)/pos/ReceiptModal.tsx` | 4, 80-81 | import 추가 + 영수증 dateStr/timeStr 생성 `fmtDateKST`/`fmtTimeKST` (프린트 대상 포함) |
| `src/app/(dashboard)/production/page.tsx` | 16, 371-373 | import 추가 + 생산지시 `created_at`/`produced_at` 표시 `fmtDateKST` (null 분기 제거 — 포맷터가 `'-'` 반환) |
| `src/app/(dashboard)/reports/page.tsx` | 6, 452 | import 추가 + PDF 다운로드 `generatedAt` 표시 `fmtDateTimeKST(new Date())` |

총 변경: 신규 1개 + 수정 11개 = **12개 파일**.

### Self-review 답변

1. **`src/lib/date.ts` null/invalid → `-`?** — YES. 내부 `toDate()` helper가 null/undefined/''/Invalid Date 모두 null 반환, 각 포맷터가 null 시 `'-'` 반환.
2. **DB 쓰기 `toISOString()` 치환하지 않았는가?** — YES, 전혀 건드리지 않음. `customers/[id]/page.tsx`의 `fmtDate(Date)` (query 경계용 `toISOString().slice(0,10)`) 유지.
3. **외부 API(Cafe24/Solapi) 경로 건드렸는가?** — NO. `src/lib/cafe24/**`, `src/lib/solapi/**`, `src/app/api/cafe24/**` 모두 미변경.
4. **쿼리 경계 계산(.gte/.lte/.slice(0,10)/startOf/endOf) 건드렸는가?** — NO. 
   - `pos/SalesListTab.tsx` `fmtDate`/`todayStr`/`daysAgo` 유지
   - `agent-conversations/page.tsx` `fmtDate`/`todayStr`/`daysAgo` 유지
   - `customers/[id]/page.tsx` `fmtDate(Date)` 유지
   - `ai/tools.ts`, `b2b-actions.ts`, `campaign-actions.ts`, `public-registration-actions.ts`, `api/cafe24/members/route.ts`, `api/dashboard/route.ts` 등 서버/쿼리 경계 계산 모두 미변경
5. **치환 누락된 UI 경로?** — grep 재실행: `toLocaleDateString\('ko-KR'` → 0건. `toLocaleString\('ko-KR'` → `src/lib/validators.ts:96` 1건 (숫자 `formatCurrency`, 날짜 아님 → 유지). `toLocaleTimeString` → 0건. 누락 없음.
6. **`npm run build`?** — ✅ 통과 (Next.js 16.2.2 Turbopack, TypeScript 14.8s, 46개 static page 생성).
7. **한글 포맷 유지?** — `customers/[id]/page.tsx` 월 구분자는 기존 `${d.getFullYear()}년 ${d.getMonth() + 1}월` ("2026년 4월") → `fmtKoreanMonthKST`("2026년 4월", Intl 기반). 스펙에 없던 한글 포맷이라 `fmtKoreanMonthKST` 유틸을 추가로 뽑음. 에이전트 컨텍스트도 기존 스타일 유지용 `fmtKoreanDayKST` 추가.

### 미해결 질문 (Richard/Arch 판단 필요)

1. **`CampaignTab.tsx:311` `toDTLocal` (datetime-local input 값 생성)** — 건드리지 않고 넘김. HTML `<input type="datetime-local">`은 TZ 없는 "로컬" 문자열로 해석되는데, 사용자 브라우저가 KST 외 지역이면 `new Date(iso)`의 getFullYear/getMonth가 브라우저 로컬 TZ로 계산됨. `Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', ... })`로 "YYYY-MM-DDTHH:MM" 값을 만들면 `<input>`은 그 값을 "로컬"로 보여주므로 사용자 브라우저 TZ가 KST가 아니면 저장 시 왜곡 가능. 이 전환은 **섬세한 처리 필요**(input onChange 쪽도 같이 바꿔야 함) → **Step 3 또는 별도 step**에서 다루기를 제안. 현재 경옥채 사용자는 전원 KR 브라우저로 추정되므로 당장의 버그는 없음.

2. **`src/lib/accounting-actions.ts:317` 메시지 템플릿의 `.toLocaleString()`** — 숫자 포맷터(차변/대변 금액)라 스펙 밖. 날짜 아님 확인됨 → 미변경. (Richard가 혼동할 수 있어 명시해둠)

3. **`fmtKoreanMonthKST` 추가 정당성** — Brief의 5개 formatter 외에 `fmtKoreanMonthKST`, `fmtKoreanDayKST` 2개를 추가로 export했음. 기존 한글 스타일을 유지하면서 KST 일관성을 얻기 위함(체크리스트 #7 요구). 불필요하다면 해당 callsite를 숫자 포맷 `fmtMonthKST`("2026-04") / `fmtDateTimeKST`로 바꾸면 됨.

### Known Gaps (Out of scope)

- Step 3: 쿼리 경계 KST 정합성 (`.toISOString().slice(0,10)` 같은 "오늘" 계산을 KST 기준으로 통일)
- Step 1 (POS 매출처 기본값) — Build Log에 이미 deferred 기록됨

---

Ready for Review: YES
