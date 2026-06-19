# Review Feedback — 대시보드 본부대표용 실용 개선 3종
Date: 2026-06-19
Ready for Builder: NO

## Must Fix
- src/app/api/dashboard/route.ts:234-241 (미수금 카드 쿼리) — 미수금 합산이 `approval_status='UNSETTLED'`만 필터하고 `status`를 전혀 거르지 않는다. 취소(`sales-cancel-actions.ts:195-198`)는 `status='CANCELLED'`만 세팅하고 `approval_status`를 리셋하지 않으므로, UNSETTLED 상태의 credit/cod 주문이 취소되면 `approval_status='UNSETTLED'`가 그대로 남아 대시보드 미수금 총액·건수에 계속 포함된다. 기존 판매현황(`SalesListTab.tsx:372`)은 기본으로 `status not in (CANCELLED, REFUNDED)`를 적용하므로 두 화면의 미수금이 어긋난다(돈 숫자 과대계상). 수정: 미수금 쿼리에 `.not('status', 'in', '(CANCELLED,REFUNDED)')`를 추가해 판매현황과 동일 규약으로 맞출 것.

## Should Fix
(없음)

## Escalate to Architect
- (a) 7일 추이 0원인 날 최소 height 3% — 빈 막대 회피 목적의 시각화 선택. 코드 버그 아님. 본부대표 화면에서 "0원인데 막대가 보임" 오해 소지만 판단 요청(차단 아님).
- (b) 미수금 카드 B2B 미포함 — `b2b_sales_orders`의 미정산분이 본부대표 미수금에 빠져 있다. Bob이 Open Question으로 명시. 포함 여부는 비즈니스 결정이라 코드 레벨에서 못 정함. 단, 이건 "정의 확장" 이슈이지 위 Must Fix(잘못된 포함)와 별개임.

## Cleared
#18 net 매출 통일(periodTotal·onlineAmount·channelSales·trend·MTD·branchRank 전부 netAmount 적용, B2B는 discount 컬럼 없어 raw 유지로 일관), 처리대상 카드 4종 링크/강조 로직, 7일 추이 KST 버킷팅·0나눗셈 방어·기간필터 독립, 지점순위 활성지점 join·desc·지점사용자 숨김, RBAC(지점 사용자 branchId 잠금·스푸핑 불가), 15쿼리 Promise.all 병렬, 기존 모달/최근주문/재고부족 무손상, 빌드·타입 green — 모두 통과. 미수금 status 필터 1건만 Must Fix.
