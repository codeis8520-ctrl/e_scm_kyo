# Architect Brief — 대시보드 헤더/탭 통일 · 배치 B

## Goal
배치 A에서 신설한 공용 `src/components/PageTabs.tsx`를 나머지 6개 탭 페이지에 채택해 탭 시각/구조를 통일한다. **상태관리·URL 동기화·패널 분기·동작 회귀 0 — 인라인 탭 마크업만 PageTabs로 교체.**

## 절대 규칙 (Flag)
- 순수 프레젠테이션. 서버액션·데이터·`src/lib/ai/schema.ts` 미접촉.
- 각 페이지 기존 탭 state/set함수/타입/전환 핸들러 **로직 변경 금지** — PageTabs의 activeKey/onChange에 **연결만**.
- 탭 라벨·key·순서는 **각 페이지 실제 코드에서 그대로** 가져올 것(추측 금지, grep/read로 확인). 패널 렌더 분기(activeTab==='x')의 key와 PageTabs tabs[].key가 정확히 일치해야 함.
- h1 제거 대상 없음(이미 탭만). 서브/상세 페이지·예외 미접촉.

## 대상 6페이지 (PageTabs로 교체)
| 파일 | 상태 훅 | onChange 연결 | 주의 |
|---|---|---|---|
| `customers/page.tsx` | `activeTab`/`setActiveTab` (list\|campaign), 탭 ~L260 | onChange={(k)=>setActiveTab(k as TabType)} | **URL ?tab= 동기화(useEffect ~L200)·listQs 절대 미접촉** — onChange는 setActiveTab만(기존과 동일). 회귀 위험 최상위 |
| `accounting/page.tsx` | `tab`/`setTab` (~L44), 탭 ~L181 (패딩 px-5 불일치) | onChange={(k)=>setTab(k as ...)} | 6탭 |
| `trade/page.tsx` | `activeTab`/`setActiveTab` (~L13 default 'credit'), 탭 ~L25 | setActiveTab | 3탭 |
| `notifications/page.tsx` | `activeTab`/`setActiveTab` (~L33 kakao\|sms\|templates), 탭 ~L161 | setActiveTab | 외부 전환 호출(L82/L361 등) 유지 |
| `reports/page.tsx` | `reportTab`/`setReportTab` (~L110), 탭 ~L690 (패딩 py-2 불일치) | setReportTab | REPORT_TABS 라벨 재사용 |
| `pos/page.tsx` | `mainTab`/`setMainTab` (~L315 MainTab), **최상단** 탭 ~L1456 | setMainTab | **L1754/L2477 등 내부 서브탭(모달/패널) 절대 미접촉** — 최상단 판매등록/판매현황 탭만 |

## 작업 방식 (각 페이지 공통)
1. 해당 페이지 상단 인라인 탭 `<div>/<nav>` 블록을 `<PageTabs tabs={[...]} activeKey={state} onChange={...} actions={기존 우측액션 있으면}/>`로 교체.
2. tabs 배열 = 기존 탭 버튼들의 라벨/키 그대로(순서 보존).
3. 우측 액션 버튼(있으면)은 actions 슬롯으로. 없으면 actions 생략.
4. `import PageTabs, { PageTab } from '@/components/PageTabs'` (또는 default만; 실제 export 형태에 맞춰).

## Out of Scope
- pos 내부 서브탭, customers URL 동기화 로직, 서브/상세 페이지, h1(이미 없음), schema.ts.

## Acceptance
- `npm run build` 통과.
- 6페이지 탭이 PageTabs(blue-600 표준)로 렌더, 클릭 시 기존과 동일 패널 전환.
- customers: ?tab= URL 동기화·뒤로가기 복원 기존대로 동작(미변경).
- pos: 최상단 탭만 교체, 내부 서브탭 그대로.
- 각 페이지 우측 액션(있으면) 위치·동작 보존.
