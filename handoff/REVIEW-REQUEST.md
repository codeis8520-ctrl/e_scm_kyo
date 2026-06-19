# Review Request — #47 수령일자 보존
Date: 2026-06-19
Ready for Review: YES

## 정책 요약
RECEIVED 전이 시 receipt_date를 기존값 보존, NULL일 때만 오늘로 fill. PostgREST 컬럼참조 COALESCE 불가 → 모든 경로 2-step(①상태만 update ②`.is('receipt_date', null)` 행만 today fill).

## Files Changed
- src/lib/shipping-actions.ts (bulkUpdateReceiptStatus, else 비배송 분기 ~L402-422) — items·order 각각 상태 update + receipt_date NULL-only fill로 2-step 분리. 배송 경로는 (b) 헬퍼 위임이라 무수정.
- src/lib/receipt-sync.ts:20-50 (syncReceiptStatusFromShipment) — DELIVERED 시 품목(PARCEL_PLANNED→RECEIVED)·주문(allReceived) 2-step. 예정일 있던 건 보존, NULL이던 실배송 건만 today fill → #19/#43 동작 무회귀.
- src/app/(dashboard)/pos/SalesListTab.tsx (markItemReceived 품목+allDone 주문 update, markReceiptCompleted 주문 update) — 각 2-step. 로컬 setState `it.receipt_date || today`/`prev.receipt_date || today`로 기존값 우선. confirm 문구 수정.
- src/lib/ai/schema.ts:213 — #43 설명에 receipt_date 보존(#47) 반영.

## reaggregate 적용/보류
**보류(Known Gap)**. `reaggregateOrderReceiptStatus`는 convertOrderToParcel/convertOrderToPickup 두 전환 액션에서만 호출되며, 이들은 브리프 Out-of-Scope의 "의도적 날짜 리셋" 예외 경로. 보존 적용 시 전환 의도와 충돌 → 브리프 지침대로 현행 유지. 품목 receipt_date는 (b)/(c)에서 이미 보존됨.

## Open Questions
- (b) 공용 헬퍼는 webhook/AI/단건·일괄 배송완료 전부 영향. 2-step 사이에 동시성 가드 없음(기존 코드도 단일 await 시퀀스, 멱등). 현재 호출 패턴상 문제 없다고 판단했으나 확인 요망.
- (c) markItemReceived: 상태 update 성공(!error) 시에만 date-fill 2번째 쿼리 실행하도록 배치. 052 미적용(컬럼부재) 환경에서는 첫 update가 error → date-fill 스킵 + 기존 alert 폴백 유지 확인 요망.

## Out of Scope (logged in BUILD-LOG)
- reaggregate 주문레벨 today 강제(전환 액션 한정) — 보존 미적용, 충돌회피 의도. Known Gap 기재.
- 방문↔택배 전환 날짜 리셋(convertOrderToParcel/Pickup), cafe24 webhook 택배예정일 세팅, POS 신규생성 receiptDate — 브리프 예외, 무수정.
