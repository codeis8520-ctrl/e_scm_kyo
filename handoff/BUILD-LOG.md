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

## Current Status

Step 2 배포 완료 (commit `2a8e8a2`) — 다음: Step 3(쿼리 경계) 또는 Step 1 재개 대기
