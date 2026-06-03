# Architect Brief — 대시보드 헤더/탭 통일 · 배치 A

## Goal
공용 PageTabs 컴포넌트 신설 + 중복 h1 3페이지 + 단일 h1 2페이지 헤더 표준화. 탭 전환·URL·딥링크 동작 회귀 0 — 시각/구조만.

## 절대 규칙 (Flag)
- **순수 프레젠테이션만.** 서버액션·데이터·`src/lib/ai/schema.ts` 손대지 말 것.
- **상태관리는 각 페이지 그대로.** PageTabs는 activeKey/onChange만. onChange는 기존 set함수 그대로 호출. URL 동기화 useEffect 손대지 말 것.
- 예외 페이지(서브/상세: customers/analytics, inventory/count, purchases/suppliers·prices·[id], customers/[id], credit 등) **절대 건드리지 말 것.**

## Build Order

### 1. 신설 `src/components/PageTabs.tsx` (프레젠테이션 전용)
```tsx
export interface PageTab { key: string; label: string; }
interface PageTabsProps { tabs: PageTab[]; activeKey: string; onChange: (key: string) => void; actions?: React.ReactNode; }
```
구조/스타일(표준 1종):
- 래퍼 `<div className="flex items-center justify-between gap-3 border-b border-slate-200">`
- nav `<nav role="tablist" className="flex gap-1 overflow-x-auto">`
- 탭 버튼: type="button", role="tab", aria-selected={activeKey===t.key}, key, onClick={()=>onChange(t.key)}, className `px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap` + active `border-blue-600 text-blue-600` / inactive `border-transparent text-slate-500 hover:text-slate-700`.
- actions 있으면 nav 뒤 `<div className="flex flex-wrap items-center gap-3 pb-2">{actions}</div>`.

### 2. production/page.tsx — h1 제거 + PageTabs
- 헤더 L316~343(h1 "생산 관리"+부제 + 우측 액션: 지점 select, BOM 조립 버튼, +생산 지시[canIssueOrder]) + 탭 L345~358(`tab` 'orders'|'bom'|'factories') 전체 교체.
- tabs=[{orders,'생산 지시 목록'},{bom,'BOM 목록'},{factories,'OEM 공장'}], activeKey={tab}, onChange={(k)=>setTab(k as ...)}, actions=기존 우측 액션 3개 그대로. 부제 생략.

### 3. shipping/page.tsx — h1 제거 + PageTabs
- 헤더 L910~913(h1 "배송 관리"+부제) 제거 + 탭 L915~929(`activeTab` TabType cafe24|manual|list, active색 blue-500) 교체.
- tabs=[{cafe24,'카페24 주문'},{manual,'직접 입력'},{list,'배송 목록'}], activeKey={activeTab}, onChange={(k)=>setActiveTab(k as TabType)}, actions 없음. 부제 생략.

### 4. system-codes/page.tsx — h1 제거 + PageTabs
- 헤더 L379~381(h1) 제거 + 탭 L383~474(9버튼, active blue-500) 교체.
- tabs 순서: channels'채널 관리'/branches'지점 관리'/grades'고객 등급'/tags'고객 태그'/categories'카테고리'/staff'직원 관리'/campaign_types'캠페인 유형'/point_rates'지점별 적립율'/permissions'권한 관리'. activeKey={activeTab}, onChange={(k)=>setActiveTab(k as ...)}. 9탭 overflow-x-auto 확인.

### 5. agent-memory/page.tsx — h1 sr-only
- L89 h1 "AI 에이전트 학습 메모리" → `className="sr-only"`(텍스트 유지). L90 부제·L92~94 버튼 유지.

### 6. agent-conversations/page.tsx — h1 sr-only
- L261 h1 "AI 대화 기록" → `className="sr-only"`. L262~265 부제 유지.

## Out of Scope (→ 배치 B / Known Gaps)
- 배치 B 6페이지(pos/accounting/trade/customers/notifications/reports) PageTabs 채택.
- URL 동기화 일반화(customers만 보유 — 변경 금지).
- pos 내부 서브탭(L1754/L2477 등) 손대지 말 것.

## Acceptance
- `npm run build` 통과.
- production/shipping/system-codes: 상단 텍스트 제목 안 보임, 탭만. production 우측 액션 정상 표시·동작.
- 탭 전환 클릭 시 기존과 동일 패널 전환. 활성 탭 = blue-600 통일.
- agent-memory/agent-conversations: 화면 큰 제목 사라짐, DOM에 sr-only h1 존재.
- 예외/서브 페이지 파일 변경 0건.
