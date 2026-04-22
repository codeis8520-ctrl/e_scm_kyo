# Architect Brief

*Arch writes. Bob reads.*

---

## Step 2 — KST 타임존 Phase A: 표시 레이어 표준화

### 배경

코드베이스 전체에서 `timeZone: 'Asia/Seoul'` 명시 **0건**. 서버(UTC)에서 렌더/생성되는 날짜가 UTC로 노출됨. 테스트 데이터 환경이라 과거 데이터 정합성은 고려 불필요.

### 목표

모든 UI 표시 날짜·시간을 **한국시간(Asia/Seoul)**으로 일관 표시. DB 저장(`timestamptz`)과 외부 API payload(UTC ISO)는 불변.

### 아키텍처 원칙 (절대 규칙)

- `process.env.TZ` 전역 변경 **금지** — 크론·엣지 런타임·DB 비교에서 사이드이펙트
- 변환은 **명시적 `timeZone: 'Asia/Seoul'` 주입**으로만. 공용 유틸 `src/lib/date.ts`에 집중
- `timestamptz` 컬럼은 그대로 (DB 스키마 불변)
- 쿼리 경계(`new Date().toISOString().slice(0,10)` 같은 "오늘" 계산)는 **Step 3 스코프** — 이번엔 건드리지 않음

### 결정 — 공용 유틸 스펙 (`src/lib/date.ts`)

```ts
// 전부 Intl.DateTimeFormat(..., { timeZone: 'Asia/Seoul' }) 기반, ko-KR 로케일
export function fmtDateTimeKST(input: string | Date | null | undefined): string
// 예: "2026-04-22 14:30" (null/invalid → '-')

export function fmtDateKST(input: string | Date | null | undefined): string
// 예: "2026-04-22"

export function fmtTimeKST(input: string | Date | null | undefined): string
// 예: "14:30"

export function fmtMonthKST(input: string | Date | null | undefined): string
// 예: "2026-04"

export function fmtDateTimeKSTWithSeconds(input: ...): string
// 예: "2026-04-22 14:30:42" — 로그/감사 용도
```

- **포맷**: 숫자 기반 (예: "2026-04-22 14:30") 기본. 한글 년월일은 요청 시에만.
- **Fallback**: null / undefined / 잘못된 문자열 / `Invalid Date` → `'-'` 반환
- 내부적으로 `Intl.DateTimeFormat` 재사용(모듈 상수로 캐싱)해 성능 유지

### 치환 대상 (매핑 가이드)

| 기존 패턴 | 치환 |
|---|---|
| `new Date(x).toLocaleDateString('ko-KR')` | `fmtDateKST(x)` |
| `new Date(x).toLocaleDateString('ko-KR', { hour/min })` | `fmtDateTimeKST(x)` |
| `new Date(x).toLocaleString('ko-KR', ...)` | `fmtDateTimeKST(x)` (옵션 맞추어 적절 포맷터) |
| `new Date(x).toLocaleTimeString('ko-KR'|기본)` | `fmtTimeKST(x)` |
| `new Date(x).getFullYear() + '-' + (month)...` (UI 조합) | 포맷터로 |

### 건드리지 말 것 (Flag — 추측 금지)

1. **DB 저장/비교용 `toISOString()`** — Supabase insert/update, `.gte/.lte` 쿼리 인자, `new Date().toISOString()` DB 씨팅
2. **외부 API payload** — `src/lib/cafe24/**`, `src/lib/solapi/**`, `src/app/api/cafe24/**`, `sweettracker` 관련 — UTC ISO 그대로 보내야 함
3. **쿼리 경계 계산** — `.toISOString().slice(0, 10)`, `startOfDay`, `endOfDay` 유사 패턴 — Step 3 영역
4. **파일명/캐시 키에 쓰는 날짜** — 예: `WO-20260422-XXXX` 같은 주문번호. 원래 한국시간이어야 맞으나 이번 스코프 아님
5. **백엔드 비교 로직** — `new Date() - created_at > 1000*60*60*24` 같은 경과시간 계산. 의미 불변
6. **감사 로그에 원본 타임스탬프 기록하는 곳** — 표시 레이어가 아니므로 건드리지 않음
7. **ICS/iCal 생성 (있다면)** — RFC 표준상 UTC 우선

### 접근 방법

1. `src/lib/date.ts` 작성 (`Intl.DateTimeFormat` 인스턴스 모듈 상수화)
2. Grep으로 후보 수집:
   - `toLocaleDateString\('ko-KR'` / `toLocaleDateString\(\)`
   - `toLocaleString\('ko-KR'`
   - `toLocaleTimeString`
   - 필요 시 `new Date(.*).getFullYear()` 조합
3. 각 callsite를 **한 파일씩** 판단해 치환 — UI 경로이면 치환, 백엔드/외부 API 경로이면 스킵
4. 의심스러운 경우 주석으로 남기지 말고 그냥 스킵 후 `REVIEW-REQUEST.md`의 "미해결 질문"에 적기
5. `npm run build` 통과 확인
6. Self-review — Brief의 치환 대상·제외 대상 전부 체크
7. `handoff/REVIEW-REQUEST.md` 작성

### 건드릴 파일 (예상 — Grep 후 확정)

- 신규: `src/lib/date.ts`
- 수정: 대시보드, POS 목록(SalesListTab/RefundModal/ReceiptModal), 고객 상세·상담, 생산 지시 목록, 재고 변동 이력 모달(MovementHistoryModal), 알림 목록, 배송 목록, 회계(journal list), 에이전트 대화 로그, 신용/외상, B2B 탭들 등

### Self-review 체크리스트 (Bob 제출 전 필수)

- [ ] `src/lib/date.ts`가 null/invalid 입력 시 `-` 반환하는가?
- [ ] DB 쓰기 경로 `toISOString()`을 실수로 치환하지 않았는가?
- [ ] 외부 API 호출(Cafe24/Solapi) 경로를 건드리지 않았는가?
- [ ] 쿼리 경계(`.gte/.lte`, `.slice(0,10)`) 계산 로직을 건드리지 않았는가? (Step 3 영역)
- [ ] 치환 누락된 UI 경로가 없는가? (grep 재실행으로 확인)
- [ ] `npm run build` 통과?
- [ ] 기존에 한글 포맷(YYYY년 MM월 DD일)을 쓰던 곳이 있다면 동일 스타일로 유지했는가, 아니면 통일 사유를 기록했는가?

### Ready for Bob: YES
