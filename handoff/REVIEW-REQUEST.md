# Review Request — 대시보드 본부대표용 실용 개선 3종
Date: 2026-06-19
Ready for Review: YES

## Files Changed
- src/app/api/dashboard/route.ts — netAmount() #18 헬퍼 추가; 기존 periodSales/channelSales/online 쿼리 select에 discount_amount 추가; 추이/MTD용 KST 날짜 범위 계산(trendStart 6일 전, monthStart, 항상 today 고정); Promise.all에 신규 쿼리 5종(미수금/미발송/추이7일/이번달누적/지점순위) 병렬 추가; 기존 periodTotal/channelSales/onlineAmount 합산을 netAmount(#18)로 정정; 신규 결과 후처리(7일 KST 버킷팅, today/yesterday, MTD, 활성지점 join+desc); 신규 8필드 반환(기존 필드 전부 보존).
- src/app/(dashboard)/DashboardClient.tsx — DashboardData 인터페이스 8필드 추가; 액션카드 4종 + 매출추이 + 지점순위 3섹션 신규(기존 요약카드 grid 위). 이하 기존 섹션/모달 무변경.

## 확정 결정 반영 (브리프 플래그 오버라이드)
- 브리프는 #18 적용을 신규 쿼리로 한정(기존 periodTotal/onlineAmount/channelSales 동결, Known Gap)했으나 **PO 확정 결정으로 기존 매출 합산도 #18로 정정**. 대시보드 숫자가 할인분만큼 소폭 하향 — 의도된 정정(판매현황/매출관리와 일치).

## Open Questions
- 7일 추이 막대: total=0인 날도 최소 height 3%로 시각화(완전 빈 막대 회피). 의도 확인 바람.
- 미수금 카드는 sales_orders approval_status='UNSETTLED'만 — b2b_sales_orders 미수금 미포함(BUILD-LOG Gap). 본부대표 미수금에 B2B 포함 필요 여부 판단 요청.

## Out of Scope (logged in BUILD-LOG)
- 액션카드 deep-link 쿼리파라미터(/trade?tab=credit 등) — 페이지 미지원, 단순 이동만.
- branch_sales_summary RPC(legacy 통합) 미연계 — 순위는 신규 sales_orders만.
