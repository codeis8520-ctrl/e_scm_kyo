# Architect Brief

*Arch writes. Bob reads.*

---

## Step 3 — KST 타임존 Phase B: 쿼리 경계 표준화

### 배경

Step 2(2a8e8a2)에서 표시 레이어는 KST로 맞췄지만, "오늘 매출"·"이번 달 매입"·"최근 7일" 같은 **쿼리 경계 계산**은 여전히 UTC 기준. Node(Vercel) 서버 TZ가 UTC이므로 `new Date().toISOString().slice(0, 10)`은 UTC 날짜를 반환. 예: KST 2026-04-22 08:00 (= UTC 2026-04-21 23:00) 시점에 "오늘"은 서버에서 `'2026-04-21'`로 계산되어 KST 사용자가 보는 "오늘" 대시보드와 어긋남.

테스트 데이터 전제라 과거 수치 정합성 제약은 없음.

### 목표

모든 사용자 대면 **날짜 경계 계산**을 KST 기준으로 맞춤. DB `timestamptz`(UTC 저장)와 외부 API(UTC ISO)는 불변. `toISOString()`으로 변환되는 최종 인자 값은 여전히 UTC ISO 문자열이지만, 그 순간이 **KST 자정/월초/월말**을 의미하도록 만든다.

### 아키텍처 원칙 (불변)

- `process.env.TZ` 전역 설정 금지
- 변환은 `src/lib/date.ts`에 집중
- DB 스키마 불변 (`timestamptz` UTC 저장 유지)
- 반환 타입: `string`(ISO) 또는 `Date` (callsite 기존 타입에 맞춤)

### 결정 — 추가 유틸 스펙 (`src/lib/date.ts` 확장)

```ts
// 날짜 객체/문자열을 KST 기준으로 해석하여 UTC ISO 경계 반환.
// `date` 생략 시 현재 시각 기준.

export function kstDayStart(date?: Date | string): string
// KST 00:00:00.000의 UTC ISO. 예: 2026-04-22 기준 → "2026-04-21T15:00:00.000Z"

export function kstDayEnd(date?: Date | string): string
// KST 23:59:59.999의 UTC ISO. 예: 2026-04-22 기준 → "2026-04-22T14:59:59.999Z"

export function kstMonthStart(date?: Date | string): string
// 해당 월의 1일 KST 00:00의 UTC ISO

export function kstMonthEnd(date?: Date | string): string
// 해당 월 말일 KST 23:59:59.999의 UTC ISO

export function kstTodayString(): string
// 현재 KST 날짜 "YYYY-MM-DD"

export function kstYearMonth(date?: Date | string): string
// KST 기준 "YYYY-MM"

export function kstDaysAgoStart(n: number): string
// n일 전 KST 00:00의 UTC ISO. "최근 N일" 쿼리에 사용.
```

**구현 힌트** (Bob에게):
- KST는 UTC+9 고정(서머타임 없음). 단순히 offset 덧셈으로 가능.
- 그러나 정확성 + 가독성을 위해 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', ... })`로 KST 날짜/시각 구성 요소 추출 후 `Date.UTC(y, m-1, d, h-9, ...)` 형태로 조립 권장. 하드코딩된 offset 수식(`+9*60*60*1000`)은 실수 유발.
- 또는 명확히 `new Date(isoLikeString + '+09:00')` 사용. `new Date('2026-04-22T00:00:00+09:00')` → UTC 2026-04-21T15:00:00Z. 이게 가장 간결하고 명료함. **이 방식 권장**.

### 치환 대상 (전수 조사 필수)

**Grep 패턴**
- `new Date().toISOString()` — 단독 "now" 계산 (대부분 OK, 하지만 문맥상 "KST today" 의도면 치환)
- `.toISOString().slice(0, 10)` — "오늘"(YYYY-MM-DD) 계산
- `.toISOString().slice(0, 7)` — "이번 달"(YYYY-MM)
- `startOfDay` / `endOfDay` / `startOfMonth` / `endOfMonth` (date-fns 등 사용 시)
- `setHours(0, 0, 0, 0)` — 로컬 자정 계산 (Node가 UTC이면 UTC 자정이 됨 → KST 기준 필요 시 치환)
- `new Date(year, month, day)` — 로컬 해석 (Node UTC이면 UTC 해석)
- `firstDayOfMonth` / `lastDayOfMonth` 등 커스텀 헬퍼

**치환 매핑 (예시)**
| 기존 | 치환 |
|---|---|
| `new Date().toISOString().slice(0, 10)` (오늘 용도) | `kstTodayString()` |
| `.gte('ordered_at', today + 'T00:00:00')` | `.gte('ordered_at', kstDayStart(today))` |
| `.lte('ordered_at', today + 'T23:59:59')` | `.lte('ordered_at', kstDayEnd(today))` |
| 월초/월말 범위 계산 | `kstMonthStart(...)` / `kstMonthEnd(...)` |
| "7일 전부터" | `kstDaysAgoStart(7)` |

### 건드리지 말 것 (Flag — 추측 금지)

1. **세션/토큰 만료 계산** — `session_tokens.expires_at`, `cafe24_tokens.access_token_expires_at`. UTC 고정 비교가 맞음. 건드리면 보안 이슈
2. **감사 로그 created_at 기록** — `new Date().toISOString()` 그대로 두면 됨. timestamptz는 UTC 저장이 정답
3. **경과 시간 계산** — `Date.now() - record.created_at` 같은 ms 차이. 어느 TZ 해석이든 동일. 건드리지 않음
4. **외부 API 호출 payload** — Cafe24(`start_date`, `end_date` 파라미터는 API 스펙 따름), Solapi(발송 스케줄 timestamp)
5. **`<input type="datetime-local">` 값 생성 로직** — Step 2에서 미해결 처리한 `CampaignTab.toDTLocal` 등. 브라우저 TZ 의존. 이번 스코프 아님
6. **Cron `scheduled_at` 저장** — DB에 timestamptz로 저장, 사용자 입력받은 값. 이미 `datetime-local` + 브라우저 TZ 경로로 처리됨

### 주요 조사 대상 파일 (전수는 grep으로)

- `src/app/api/dashboard/route.ts` — 대시보드 집계
- `src/app/api/dashboard/details/route.ts`
- `src/lib/ai/tools.ts` — 에이전트 날짜 필터 도구
- `src/lib/b2b-actions.ts` — 정산 기간
- `src/lib/campaign-actions.ts` / `campaign-send-core.ts` — 캠페인 윈도우
- `src/lib/accounting-actions.ts` — 월말 마감, 기간 집계
- `src/app/(dashboard)/pos/SalesListTab.tsx` — 클라이언트 날짜 필터
- `src/app/(dashboard)/agent-conversations/page.tsx` — 기간 필터
- `src/app/(dashboard)/customers/[id]/page.tsx` — 타임라인
- `src/app/(dashboard)/reports/page.tsx` — 보고서 기간
- `src/app/api/notifications/batch/dormant/route.ts` — 휴면 기준일
- `src/app/api/notifications/batch/birthday/route.ts` — 생일 크론
- `src/app/api/cafe24/sync-orders/route.ts` / `members/route.ts` — 동기화 시점 (외부 API payload는 불변, 내부 경계만)

### 접근 방법

1. `src/lib/date.ts`에 새 함수 7종 추가 (`+09:00` suffix 방식으로 구현)
2. Grep 전수 수집 — 치환 대상 후보 목록화
3. 파일별 판단:
   - 사용자 "오늘/이번 달/최근 N일" 의미 → 치환
   - 세션/감사/외부 API / ms 차이 계산 → 스킵
   - 애매하면 스킵 + `REVIEW-REQUEST.md` "미해결 질문"
4. `npm run build` 통과
5. Self-review (아래 체크리스트)
6. `handoff/REVIEW-REQUEST.md` 작성

### Self-review 체크리스트

- [ ] `src/lib/date.ts`의 새 함수 7종이 스펙대로 동작? (유닛 테스트 없으므로 예시 주석으로 검증)
- [ ] 세션/토큰/감사 경로를 실수로 치환하지 않았는가?
- [ ] 외부 API payload 경로를 건드리지 않았는가?
- [ ] Step 2 영역(표시 포맷)을 재수정하지 않았는가?
- [ ] `new Date('...+09:00')` 방식이 타입스크립트에서 `Invalid Date` 발생 여지는 없는가? (입력이 확실한 format인지)
- [ ] 치환 후 기존 날짜 비교 로직(`>=`, `<=`)의 양 끝이 일관된 KST 경계인가? (start는 `kstDayStart`, end는 `kstDayEnd` 짝)
- [ ] `.toISOString().slice(0, 7)` 형태 "YYYY-MM" 계산도 확인했는가?
- [ ] `npm run build` 통과?

### Out of scope (BUILD-LOG Known Gaps)

- 과거 데이터 재분류 (테스트 데이터라 불필요)
- `<input type="datetime-local">` TZ 재설계 (별도 건)
- 한글 포맷터 2종 유지 여부 결정 (별도 건)

### Ready for Bob: YES
