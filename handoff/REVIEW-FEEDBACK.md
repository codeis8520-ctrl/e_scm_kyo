# Review Feedback — 대시보드 헤더/탭 통일 · 배치 A
Date: 2026-06-03
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
없음.

## Escalate to Architect
- system-codes onChange를 `as typeof activeTab`로 캐스팅(9-유니온 재기재 대신). 동작 동일, 타입 안전. Bob이 Open Question으로 올림 — 명시적 유니온 선호 시에만 변경. 코드상 문제 아님.

## Cleared
PageTabs 신설 + 5페이지 헤더 표준화를 리뷰함. 6개 파일만 변경, schema.ts·서버액션·예외/서브 페이지 미접촉.

### 검증 상세
- 탭 키↔state 매핑 100% 일치 (회귀 0):
  - production: state 'orders'|'bom'|'factories' (L160) = 탭 키 = 패널 분기 L351/573/584. 캐스팅 정확.
  - shipping: TabType 'cafe24'|'manual'|'list' (L73/118) = 탭 키 = 패널 L923/1046/1166. `as TabType` 유효.
  - system-codes: 9-유니온 (L163) = 9탭 키 전부 일치 = 패널 L396~1136. `as typeof activeTab` 유효.
- state/useState/URL/핸들러 로직 변경 0 — diff는 헤더+탭 마크업 교체만. 연결만 변경.
- production 우측 액션 3개(지점 select / BOM 조립 / +생산 지시[canIssueOrder]) actions 슬롯으로 누락·조건 손실 없이 이동.
- h1: production/shipping/system-codes h1+부제 제거 / agent-memory·agent-conversations h1 sr-only(텍스트 보존).
- PageTabs: props 시그니처·blue-600 active·role=tablist/tab·aria-selected·actions optional·overflow-x-auto 전부 브리프 일치.
- 범위 가드: customers 등 예외/서브 페이지 변경 0, pos 서브탭 미접촉.
