# Review Request — 대시보드 헤더/탭 통일 · 배치 A
Date: 2026-06-03
Ready for Review: YES

## 개요
공용 PageTabs(프레젠테이션 전용) 신설 + 5페이지 헤더 표준화. 순수 시각/구조만 — state/URL/핸들러/패널 분기 전부 미접촉. 서버액션·DB·src/lib/ai/schema.ts 변경 0.

## Files Changed
- `src/components/PageTabs.tsx` (신설, 1~41) — tabs/activeKey/onChange/actions props. 래퍼 flex justify-between border-b, nav role="tablist", 버튼 type/role="tab"/aria-selected, active=border-blue-600 text-blue-600. actions 있을 때만 우측 div 렌더. 브리프 구조·스타일·a11y 그대로.
- `src/app/(dashboard)/production/page.tsx`
  - L17 — `import PageTabs from '@/components/PageTabs'`.
  - 기존 L316~358(h1 "생산 관리"+부제+우측 액션 3개 + 인라인 탭) → PageTabs 1개로 교체. tabs=[orders/bom/factories], activeKey={tab}, onChange={k=>setTab(k as 'orders'|'bom'|'factories')}. 우측 액션 3개(지점 select / BOM 조립 / +생산 지시[canIssueOrder])는 actions 슬롯으로 그대로 이동. 부제 생략.
- `src/app/(dashboard)/shipping/page.tsx`
  - L9 — import 추가.
  - 기존 L910~929(h1 "배송 관리"+부제 + 탭) → PageTabs. tabs=[cafe24/manual/list], activeKey={activeTab}, onChange={k=>setActiveTab(k as TabType)}. actions 없음. 부제 생략.
- `src/app/(dashboard)/system-codes/page.tsx`
  - L7 — import 추가.
  - 기존 L379~474(h1 "시스템 코드 관리" + 9개 인라인 버튼) → PageTabs(9탭, 순서·라벨 브리프 그대로). activeKey={activeTab}, onChange={k=>setActiveTab(k as typeof activeTab)}.
- `src/app/(dashboard)/agent-memory/page.tsx` — L89 h1 className `text-xl font-bold text-slate-800` → `sr-only`. 텍스트/부제/버튼 유지.
- `src/app/(dashboard)/agent-conversations/page.tsx` — L261 h1 className `text-2xl font-bold text-slate-800` → `sr-only`. 텍스트/부제 유지.

## Self-Review
- **Richard가 먼저 볼 곳**: 탭 키↔state 매핑, 캐스팅 타입, 패널 분기 보존. → tab/activeTab state 타입을 실제 코드에서 재확인(production L159, shipping L72/117, system-codes L162) 후 매핑. 패널 렌더 분기(`tab===`/`activeTab===`)는 전부 미접촉.
- **브리프 요구사항**: PageTabs 신설 ✅ / 3페이지 h1·부제 제거+탭 교체 ✅ / production 액션 슬롯 이동 ✅ / 2페이지 sr-only ✅ / 예외·서브·pos 서브탭·schema.ts 미접촉 ✅.
- **빈 데이터/실패**: 프레젠테이션 변경뿐 — 데이터 흐름·에러 핸들링 경로 무변경.
- **시각 변화(의도됨)**: shipping/system-codes 기존 active색 blue-500 → 표준 blue-600 통일. 패딩 px-3→px-4(표준). 동작 무관.

## Open Questions
- system-codes onChange 캐스팅을 9-유니온 재기재 대신 `as typeof activeTab`로 처리(동일 타입). 동작 동일하나 명시적 유니온 선호 시 알려주세요.

## Build
`npm run build` → ✅ Compiled successfully in 5.7s. 에러/경고 0.

## Out of Scope (logged in BUILD-LOG)
- 없음. 배치 B 6페이지·URL 동기화 일반화·pos 서브탭은 스코프 외로 미접촉.
