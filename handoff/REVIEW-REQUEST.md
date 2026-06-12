# Review Request — Cafe24 Bugfix (2 bugs, 1 step)
Date: 2026-06-12
Ready for Review: YES

## Files Changed
- src/lib/cafe24/types.ts:122-131 — `firstPositiveAmount(...vals)` 공유 헬퍼 신규: 우선순위대로 Number() 변환, 첫 유한+양수 반환(없으면 0). Bug ③ 단일 출처.
- src/app/api/cafe24/orders/route.ts:4 — `firstPositiveAmount` import 추가.
- src/app/api/cafe24/orders/route.ts:12-15 — `isNoSelection(v)` 헬퍼 신규(공백제거 후 '선택안함' 비교).
- src/app/api/cafe24/orders/route.ts:17-32 — parseOptionPairs 양 분기에 isNoSelection 적용. 배열 분기: v='' 로 기존 filter 드롭. 문자열 분기: '' 반환(bare k 아님).
- src/app/api/cafe24/orders/route.ts:324-328 — total_price 를 firstPositiveAmount(payment_amount/order_price_amount/total_order_price + detailOrder 변형)로 교체.
- src/lib/cafe24/webhook.ts:3 — import 에 `firstPositiveAmount` 추가.
- src/lib/cafe24/webhook.ts:273-278 — sales_orders.total_amount 의 ?? 체인을 firstPositiveAmount(payment_amount, order_price_amount, total_order_price, actual_payment_amount)로 교체.
- src/lib/ai/schema.ts:271 — BUSINESS_RULES 한 줄 추가(cafe24 total_amount = 결제수단 무관 주문상품금액).

## Verification
- npm run build ✓ 클린(에러/경고 없음).
- ② 선택안함/선택 안함 → 해당 pair 괄호 없음; 혼합은 실옵션만 유지; 전부 선택안함 → `name xQty`(L286 폴백, extractItemOptions 무변경).
- ③ payment_amount=0|"0" + order_price_amount>0 → 주문상품금액; payment_amount>0 → 무변경; 전부 0/빈값 → 0.

## Open Questions
- 없음. 브리프 LOCKED 사양 그대로 구현.

## Out of Scope (logged in BUILD-LOG)
- 기존 0원 rows 백필(total_amount + 잘못 기표된 journal_entries): FORWARD-ONLY 수정 → Project Owner 결정.
- sync-orders.ts: amount/parseOptionPairs 패턴 없음 확인 → 미수정.
