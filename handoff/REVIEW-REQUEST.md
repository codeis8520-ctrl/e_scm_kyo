# Review Request — Step 1 (카페24 매출 부분결제분 forward)
Date: 2026-06-16
Ready for Review: YES

Build: `npm run build` ✓ (Compiled successfully 7.0s, 에러/경고 0)

## Files Changed
- src/lib/cafe24/types.ts:132-145 — 신규 `cafe24OrderTotal(order)`: payment_amount + naver_point + actual_order_amount.points_spent_amount + actual_order_amount.credits_spent_amount, num(v)=유한 Number else 0. 합 0이면 firstPositiveAmount(payment_amount, order_price_amount, total_order_price, actual_payment_amount) 폴백. firstPositiveAmount(L124) 유지.
- src/lib/cafe24/webhook.ts:3 — import에 cafe24OrderTotal 추가.
- src/lib/cafe24/webhook.ts:399 — `total_amount: cafe24OrderTotal(cafe24Order)` (기존 firstPositiveAmount 4-arg 인라인 교체). discount_amount·payment_method 무변경.
- src/app/api/cafe24/orders/route.ts:4 — import을 firstPositiveAmount → cafe24OrderTotal로 교체.
- src/app/api/cafe24/orders/route.ts:375 — `total_price: cafe24OrderTotal(detailOrder ?? o)` (중첩 actual_order_amount는 detail 응답에만 존재 → detailOrder 우선).
- src/lib/ai/schema.ts:281 — BUSINESS_RULES 카페24 매출 라인 1줄 교체(모든 결제수단 합 공식 + 쿠폰 제외 + 폴백). 마이그/tools.ts 무변경.

## Open Questions
- route.ts L375: `detailOrder ?? o` 가 브리프 §3 의도와 일치 — list(o)에는 actual_order_amount 중첩이 없고 detail에만 있으므로 detail 우선. 확인 요청.

## Out of Scope (logged in BUILD-LOG)
- 기존 행 금액 백필 (Step 2).
- 회계 createSaleJournal 재게시 (분개 무조정).
- discount_amount / payment_method 변경 없음.
