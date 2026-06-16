# Architect Brief — 카페24 매출 부분결제분 누락 (Step 1: forward)

## Goal
신규 카페24 주문의 total_amount(매출)가 카드 실결제만이 아니라 **모든 결제수단 합**(카드 + 네이버포인트 + 적립금 + 예치금)으로 집계된다. (예: 50,000+12,000=62,000.)

## 잠근 결정 (LOCKED)
- **공식**: `cafe24OrderTotal(order) = num(order.payment_amount) + num(order.naver_point) + num(order.actual_order_amount?.points_spent_amount) + num(order.actual_order_amount?.credits_spent_amount)`. `num(v)` = `Number.isFinite(Number(v)) ? Number(v) : 0`.
- **합이 0이면** 기존 `firstPositiveAmount(...)` 폴백 사용(전액 정보없음 방어). firstPositiveAmount는 **삭제하지 말고 폴백 용도로 유지**.
- 쿠폰은 tender 아님(discount) → 제외. discount_amount는 현행(total_discount_price) 유지. payment_method도 현행('card' 등) 유지 — **total만 보정**.
- 회계 createSaleJournal 조정은 **범위 밖(Known Gap)** — DB total_amount 갱신만, 분개 재게시 없음.

## Build Order
1. **src/lib/cafe24/types.ts** — `firstPositiveAmount` 바로 아래에 신규 export:
   ```
   export function cafe24OrderTotal(order: unknown): number {
     const o = order as any;
     const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
     const sum = num(o?.payment_amount) + num(o?.naver_point)
       + num(o?.actual_order_amount?.points_spent_amount)
       + num(o?.actual_order_amount?.credits_spent_amount);
     return sum > 0 ? sum : firstPositiveAmount(
       o?.payment_amount, o?.order_price_amount, o?.total_order_price, o?.actual_payment_amount,
     );
   }
   ```
   - 주석: 매출=모든 결제수단 합(포인트 포함). 쿠폰 제외. 합 0이면 폴백.
2. **src/lib/cafe24/webhook.ts** L399 — `total_amount: firstPositiveAmount(...)` → `total_amount: cafe24OrderTotal(cafe24Order)`. import에 `cafe24OrderTotal` 추가(L3 `firstPositiveAmount` 옆).
3. **src/app/api/cafe24/orders/route.ts** L375 — `total_price: firstPositiveAmount(...)` → `total_price: cafe24OrderTotal(detailOrder ?? o)`. (detailOrder가 actual_order_amount 중첩을 가진 풀 응답. 없으면 o 폴백.) import에 `cafe24OrderTotal` 추가(L4).
   - Flag: route는 list+detail 2소스다. detailOrder 우선이 맞는지(중첩 actual_order_amount는 detail에만 있음) — 그대로 detailOrder ?? o.
4. **src/lib/ai/schema.ts** BUSINESS_RULES 카페24 섹션 — 한 줄: "카페24 매출 total_amount = 모든 결제수단 합(payment_amount + naver_point + points_spent_amount + credits_spent_amount). 포인트/적립금도 결제수단으로 매출 포함. 쿠폰은 할인(제외)." 마이그 없음.

## Out of Scope (→ BUILD-LOG Known Gaps if surfaces)
- 기존 행 금액 백필 (Step 2).
- 회계 createSaleJournal 재게시.
- discount_amount / payment_method 변경.

## Acceptance
- `npm run build` 통과.
- cafe24OrderTotal 단일 출처, 3 적용지점 모두 헬퍼 경유. firstPositiveAmount는 헬퍼 내부 폴백으로만 잔존(직접 호출 0).
- 부분포인트 주문(payment_amount 50000 + naver_point 12000) → 62000. 전액포인트 주문(payment_amount 0) → firstPositiveAmount 폴백으로 0 회피(기존 동작 무회귀).
