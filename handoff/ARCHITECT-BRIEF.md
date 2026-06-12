# Architect Brief — Cafe24 Bugfix (2 bugs, 1 step)

> (이전 category-sort Step1 브리프는 코드 미작성 상태로 파킹 — 추후 재생성. SESSION-CHECKPOINT 참조.)

## Goal
CJ 송장 품목명에서 "선택안함" 옵션이 사라지고, 네이버페이 포인트 전액결제 주문이 0원이 아닌 실제 주문금액으로 매출/표시/분개에 잡힌다.

## Build Order — Bug ② (선택안함 옵션 제거)
- File: src/app/api/cafe24/orders/route.ts → parseOptionPairs (L11-32).
- Add helper isNoSelection(v): whitespace-collapse (v.replace(/\s+/g,'')) === '선택안함'. Covers "선택안함" + "선택 안함". No other fuzzing.
- Array branch (L17-18): after trimming v, if isNoSelection(v) set v='' so the existing `v ? ... : ''` drops it.
- String branch (L28-29): if isNoSelection(v) return '' (NOT k). ⚠️ current L29 returns bare k when v falsy; for 선택안함 we want it FULLY dropped via .filter(Boolean), not key kept.
- Do NOT touch L281-288. extractItemOptions returns '' → L286 already falls back to `name xQty`.

## Build Order — Bug ③ (0원 결제 매출 누락)
- New shared helper firstPositiveAmount(...vals): Number()-coerce each (cafe24 returns strings), return first finite AND > 0, else 0. One location, imported by both spots (src/lib/cafe24/types.ts or new amount.ts — Bob's call, MUST be shared).
- Field PRIORITY (LOCKED): payment_amount, order_price_amount, total_order_price, actual_payment_amount. Same order as today, but 0/empty/NaN now falls THROUGH. point-only (payment_amount=0) → order_price_amount (goods total). Normal orders unchanged.
- Spot 1 — webhook.ts L273-280: replace the `?? ... || 0` chain with firstPositiveAmount(...). Feeds sales_orders.total_amount; L369 createSaleJournal reads it from the DB row → journal fixed transitively. Do NOT touch L369/L391.
- Spot 2 — orders/route.ts L322 total_price: replace Number(o.payment_amount ?? detailOrder?.payment_amount ?? 0) with firstPositiveAmount(o.payment_amount, detailOrder?.payment_amount, o.order_price_amount, detailOrder?.order_price_amount, o.total_order_price, detailOrder?.total_order_price).
- discount_amount (webhook L281-286): DO NOT CHANGE. 0 is a valid discount.

## Out of Scope
- Existing 0원 rows (sales_orders.total_amount + mis-posted journal_entries): FORWARD-ONLY fix. Backfill = Project Owner decision → Known Gaps. Do NOT auto-backfill.
- sync-orders.ts: confirmed NO amount/parseOptionPairs pattern (status-only). Do not modify.

## AI Sync
- No schema/enum change → DB_SCHEMA untouched.
- ADD one BUSINESS_RULES line (cafe24) to src/lib/ai/schema.ts: "cafe24 total_amount = 결제수단 무관 주문상품금액(포인트 전액결제 시에도 order_price_amount 사용, 0 아님)".

## Acceptance
- npm run build clean.
- ②: 선택안함/선택 안함 value → no bracket for that pair; mixed keeps only real ones; all-선택안함 → `name xQty`.
- ③: payment_amount=0|"0" + order_price_amount>0 → order total. payment_amount>0 → unchanged. all-zero/empty → 0.
- Both fixes NO-OP on normal non-zero, real-option orders.
