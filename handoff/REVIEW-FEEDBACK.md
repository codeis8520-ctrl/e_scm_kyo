# Review Feedback — Step 2 (방문↔택배 양방향 전환)
Date: 2026-06-12
Ready for Builder: YES

## Must Fix
(none)

## Should Fix
(none)

## Escalate to Architect
(none)

## Cleared
방문(PICKUP)↔택배(PARCEL) 양방향 전환을 리뷰했고 전부 통과한다.

검증 항목:
- **편집 게이트 동일성**: 서버는 양 액션 모두 loadEditableOrder(COMPLETED AND receipt_status∉{RECEIVED,null}) 사용, UI는 editable(line 1495) 동일 조건 — Step 1과 일치.
- **방문→택배(convertOrderToParcel)**: 수령자 name/phone/address 클라+서버 양쪽 trim 검증(line 522-527), 미수령 품목만 PARCEL_PLANNED(.neq RECEIVED, line 534)로 RECEIVED 보존, shipment upsert(maybeSingle 존재→update / 부재→insert, line 542-632) 분기 정확, status=PENDING, 42703 폴백(delivery_type→created_by 순차 제거) 안전. recalc/payment/journal 미호출 확인 — delta=0 정책 준수.
- **택배→방문(convertOrderToPickup)**: shipment.status≠'PENDING'이면 거부(line 680-682, PRINTED/SHIPPED/DELIVERED 차단), PENDING이면 하드 DELETE 후 품목 PICKUP/RECEIVED/오늘로 전환.
- **deriveOrderReceiptStatus 우선순위**(line 468-472): PARCEL>QUICK>PICKUP>RECEIVED, null→RECEIVED 간주. SalesListTab markItemReceived allDone 판정(line 1138)과 의미 일치. AI schema.ts(line 194-195)와도 일치.
- **Step 1 미변경**: sales-revise-actions.ts diff는 단일 삽입 훅(+259/-0). SalesListTab은 import 1줄 추가 외 전부 신규 블록 추가 — changeDeliveryType/markReceiptCompleted/revertReceiptStatus/markItemReceived 무변경 확인.
- **AI Sync**: schema.ts BUSINESS_RULES 전환 규칙 1줄 반영(line 195). 신규 컬럼 없으므로 DB_SCHEMA 변경 불필요 — 적절.

부분상태 위험 검토(Bob Open Question 응답): 양 액션 모두 비-트랜잭션 순차 호출이나, 중간 실패 시 함수가 에러 반환하고 전표는 editable 상태로 남는다. 재시도 시 .neq('RECEIVED') 멱등성 + maybeSingle 재조회로 self-healing(영구 오염 없음). 이는 코드베이스 기존 패턴(DB 트랜잭션 미사용)과 동일 수준으로, 신규 위험을 도입하지 않음 — Must Fix 아님.
