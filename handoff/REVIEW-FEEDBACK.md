# Review Feedback — 대시보드 헤더/탭 통일 · 배치 B
Date: 2026-06-03
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
없음.

## Escalate to Architect
없음.

## Cleared
6페이지(customers/accounting/trade/notifications/reports/pos) 인라인 탭 → 공용 PageTabs 교체 리뷰 완료. 탭 회귀 0:

- **탭 key ↔ 패널 분기 1:1 일치 (전수 확인)**:
  - customers: list/campaign ↔ activeTab 분기(L270/L272) — 일치
  - accounting: TABS(L165, pl/journal/ledger/vat/gl_balance/manual) ↔ tab 분기(L184~431) + Tab 타입(L20) — 일치
  - trade: credit/b2b_sales/b2b_partners ↔ activeTab 분기 — 일치
  - notifications: kakao/sms/templates ↔ activeTab(L34 타입) — 일치
  - reports: REPORT_TABS(L676, sales/purchase/pl/trend/margin) ↔ reportTab 분기(L738~891) + ReportTab 타입(L88) — 일치
  - pos: checkout/list ↔ mainTab(L19 타입) 분기(L1492/L1598/L1600) — 일치
- **customers 최상위 위험 — 로직 변경 0**: URL ?tab= 동기화 useEffect(L201/L204), 검색 포커스/하이라이트(L225-226), listQs, TabType(L70) 전부 diff 미접촉. onChange는 setActiveTab만(L267).
- **액션 조건부 노출 삼항 보존**: notifications `activeTab!=='templates' ? (...) : undefined`(L160), pos `mainTab==='checkout' ? (...) : undefined`(L1455), reports 기간/CSV/PDF 블록 actions 슬롯 이동 — 본문/조건 미변경. PageTabs는 `actions &&`로 falsy 미렌더(L38).
- **pos 내부 서브탭 미접촉**: 교체 영역 L1445~1486, 서브탭은 그 밖. setMainTab 외부 호출(L606/687/1404) 유지.
- **PageTabs 계약**: default export(L17), props(tabs/activeKey/onChange/actions) 정합. onChange 시그니처 (key:string) → 각 페이지 캐스팅 정상.
- **범위 가드**: 6파일 + handoff 문서만. schema.ts·서버액션·서브/상세 페이지·데이터 미접촉.
- **Build**: npm run build 통과 — error/warning 0.
