# Review Request — 대시보드 헤더/탭 통일 · 배치 B (PageTabs 채택 6페이지)
Date: 2026-06-03
Ready for Review: YES

## 개요
배치 A에서 신설한 공용 PageTabs를 나머지 6페이지에 채택. 순수 프레젠테이션 — state/URL/핸들러/패널 분기 전부 미접촉, onChange/activeKey에 연결만. 서버액션·DB·src/lib/ai/schema.ts 변경 0.

## Files Changed
- `src/app/(dashboard)/customers/page.tsx`
  - L10 — `import PageTabs from '@/components/PageTabs'`.
  - L259~ — list/campaign 인라인 탭 `<div>` → PageTabs. onChange={(k)=>setActiveTab(k as TabType)} (기존과 동일, setActiveTab만). **URL ?tab= 동기화 useEffect·listQs 미접촉**.
- `src/app/(dashboard)/accounting/page.tsx`
  - L18 — import 추가.
  - L175~ — 기존 TABS(6탭) 배열 그대로 PageTabs에 전달. onChange={(k)=>setTab(k as Tab)}. overflow-x-auto 래퍼 제거(PageTabs nav가 overflow-x-auto 내장).
- `src/app/(dashboard)/trade/page.tsx`
  - L5 — import 추가.
  - L16~ — credit/b2b_sales/b2b_partners 3탭 → PageTabs. onChange={(k)=>setActiveTab(k as Tab)}. actions 없음.
- `src/app/(dashboard)/notifications/page.tsx`
  - L12 — import 추가.
  - L150~ — kakao/sms/templates 3탭 → PageTabs. onChange={(k)=>handleTabChange(k as typeof activeTab)} (외부 전환 핸들러 유지). 우측 배치버튼(생일/휴면/+발송, activeTab!=='templates' 조건)은 actions 슬롯으로 이동 — 내부 버튼 본문/조건 미변경.
- `src/app/(dashboard)/reports/page.tsx`
  - L7 — import 추가.
  - L684~ — REPORT_TABS 그대로 PageTabs. onChange={(k)=>setReportTab(k as ReportTab)}. 우측 기간/날짜/채널/지점 셀렉트·조회·CSV·PDF 버튼 블록을 actions 슬롯으로 이동(본문 미변경).
- `src/app/(dashboard)/pos/page.tsx`
  - L12 — import 추가.
  - L1446~ — **최상단** checkout/list(MainTab) 탭만 → PageTabs. onChange={(k)=>setMainTab(k as MainTab)}. 우측 임시저장/불러오기 블록(mainTab==='checkout' 조건)은 actions 슬롯으로 이동. **내부 서브탭(모달/패널) 절대 미접촉**.

## 탭 key ↔ 패널 분기 1:1 일치 확인
| 페이지 | tabs[].key | 패널 분기 |
|---|---|---|
| customers | list, campaign | activeTab === 'list'\|'campaign' |
| accounting | pl, journal, ledger, vat, gl_balance, manual | tab === ... |
| trade | credit, b2b_sales, b2b_partners | activeTab === ... |
| notifications | kakao, sms, templates | activeTab === ... |
| reports | sales, purchase, pl, trend, margin | reportTab === ... |
| pos | checkout, list | mainTab === ... |

(키는 전부 각 페이지 실제 코드에서 그대로 복사 — 오타 0)

## Self-Review
- 캐스팅: accounting/reports는 기존 TABS/REPORT_TABS 배열을 그대로 전달(키 타입이 string 유니온 → PageTab[] 구조 호환). 나머지는 리터럴 배열 + onChange에서 기존 state 타입으로 캐스팅.
- 액션 슬롯 이동(reports/notifications/pos): 기존도 좌탭/우액션 justify-between 레이아웃이라 PageTabs(justify-between) 슬롯과 시각 동등. notifications/pos의 조건부 노출(activeTab!=='templates' / mainTab==='checkout')은 삼항으로 보존(false → undefined → 슬롯 미렌더).
- 로직 변경 0: state/set함수/외부 전환 호출/URL 동기화 전부 그대로.

## Open Questions
- 시각 통일(의도됨): accounting/reports 기존 active 색 blue-500 → 표준 blue-600. accounting 패딩 px-5→px-4, reports 패딩 py-2→py-2.5(PageTabs 표준). 동작 무관.

## Build
- `npm run build` 통과 — error/warning 0. 6개 대상 라우트(/customers, /notifications, /pos, /reports, /trade, accounting 라우트) 모두 컴파일·프리렌더 정상.

## Out of Scope (logged in BUILD-LOG)
- pos 내부 서브탭, customers URL 동기화 로직, 서브/상세 페이지, schema.ts — 미접촉.
