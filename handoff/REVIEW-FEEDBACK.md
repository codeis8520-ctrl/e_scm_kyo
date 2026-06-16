# Review Feedback — 판매현황 수령/매출 분리 + 카페24 받는분
Date: 2026-06-16
Status: APPROVED

## Conditions
없음.

## Escalate to Arch
- 마이그 083(sales_orders recipient_* 컬럼)은 Arch 소유 — 아직 미작성. 코드는 083 미적용 상태에서도
  degrade 정상(아래 Cleared 참조)이나, recipient_* 가 실제 표시/검색되려면 083 작성+적용 필요. 코드 배포와 083 적용 순서는 무관(코드가 양쪽 모두 안전).

## Cleared
webhook.ts·SalesListTab.tsx·schema.ts 3파일 리뷰 완료. 마이그 083 미적용 가정 하에 전부 안전하게 degrade 함을 확인:

1. webhook.ts extractRecipientInfo — co.receivers[0] 경로(extractBuyerInfo와 동일), trim()||null 정규화 정상. insert 42703/recipient_/column-missing 재시도는 destructure-rest 로 recipient_* 5필드만 제거, buyer_*·기타 전 필드 유지. 재시도는 최초 insert 에러 시에만 1회 — double-insert 없음. newOrder.id 는 에러 가드 통과 후에만 사용. (memo L312 의 cafe24Order.recipient_address 플랫 참조는 기존 코드, diff 무관.)

2. SalesListTab —
   - recipient_* 는 extended select 에만 추가. basic/fallback select(L218~225)은 recipient_* 미참조 → 083 미적용 시 기존 42703 폴백이 흡수, crash 없음.
   - recv 헬퍼(L569): firstShip.recipient ?? o.recipient_* 우선순위 정상. render/CSV(L786~788)/검색술어(recQ·addrQ, L487~504) 3곳 모두 shipment-first→sales_order 폴백 일관.
   - renderOrderRow(L555)는 flat(L1159)·receipt 그룹(L1176) 양쪽 공통 사용 → 수령일자별 뷰 받는분 컬럼 회귀 없음. shipment 없는 카페24 주문도 받는분 노출, 택배/퀵 아이콘은 firstShip 있을 때만.
   - listSort 기본 'receipt'(L166), 토글(L1116~1126)로 'order' 전환 정상.
   - 라벨 '수령 현황'/'매출 현황' 변경, subView 키 'list'/'compare' 불변(L813) → 로직 무파손. RBAC(!isBranchUser, L811) 불변 — 지점직원은 수령 현황만.
   - OrderRow 타입 recipient_* 5필드 확장(L68~72), 타입 에러 없음.

3. schema.ts — sales_orders 컬럼에 recipient_* + 주석(L58·L60, shipments 우선·마이그083) 동기화 완료. tools.ts 무변경(신규 도구 없음, 가산 컬럼만) — 적정.

compare/RPC(매출 현황) 뷰 미변경(라벨만). DB 쓰기는 가산 컬럼 5개 한정. 회귀 없음.
