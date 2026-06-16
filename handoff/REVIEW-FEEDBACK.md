# Review Feedback — Step 1 (카페24 주문 memo + sales_order_items 생성)
Date: 2026-06-16
Status: APPROVED

## Conditions
(없음 — Must Fix 0건)

## Escalate to Arch
(없음)

## Cleared
webhook.ts handleOrderCreated의 memo 수정과 sales_order_items 생성, extractItemOptions의
types.ts 이관, route.ts import 변경, schema.ts 1줄을 리뷰했고 모두 통과.

- **memo (webhook.ts:314-316)**: recipient.address 유무로 분기. truthy면 `Delivery: addr(+detail)`
  ([addr,detail].filter(Boolean).join), falsy면 null. 템플릿 리터럴은 truthy 분기 안에만 있고
  거기서 recipient.address는 비어있지 않음이 보장 → 'Delivery: undefined' 불가. 빈 문자열도
  null 분기로 떨어짐. recipient는 L250 extractRecipientInfo로 추출, scope OK.
- **sales_order_items (webhook.ts:352-449)**: newOrder.id 사용(L345 early-return로 non-null 보장).
  멱등 가드(L356, sales_order_id limit1, registerCafe24Customers와 동일 계약). 매핑 일괄조회 2쿼리
  (N+1 없음). quantity||1 / unit_price=Number(price??product_price??0)||0 / total=unit*qty —
  NOT NULL 충족. order_option=extractItemOptions(i)||null. 재고/movements/point_history 미생성 확인.
  42703 degrade(order_option·product_id 제거 후 재시도) + 외곽 try/catch → 품목 insert 실패는
  order_items_error 로그 후 continue, uncaught throw 없음. 주문은 이미 커밋됨 → 웹훅 success 반환,
  cafe24 재시도 유발 안 함. 실패 모드는 유효한 주문(품목 0건)을 남김.
- **extractItemOptions 이관**: types.ts 구현이 route.ts 삭제분과 byte-equivalent(export만 추가).
  route.ts L4 import·로컬 정의 삭제·호출부 L329/L370 무변경. webhook.ts L3 import. normalizeOptionValue
  계열(safeDecodeKey/isNoSelectionValue, 매핑키·정렬)과 이름·의미 충돌 없음. tsc --noEmit 통과.
- **Open Question (price 폴백)**: (i as any).price ?? product_price ?? 0 — 타입상 price가 우선
  소비되어 always-0 아님. 임베드 변형(product_price)은 백업. acceptable. price는 단가이므로
  total_price=unit*qty 정확(타입에 별도 quantity 존재).
- migration/tools.ts 미변경 확인. schema.ts BUSINESS_RULES 1줄(재고 미차감 명시) 적절.
