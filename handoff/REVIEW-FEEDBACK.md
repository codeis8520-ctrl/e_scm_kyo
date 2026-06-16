# Review Feedback — Step 1 (카페24 매출 부분결제분 forward)
Date: 2026-06-16
Ready for Builder: YES

## Must Fix
(none)

## Should Fix
- src/lib/cafe24/webhook.ts:3 — `firstPositiveAmount` still imported but no longer
  called anywhere in webhook.ts (only direct caller was the L399 inline that
  cafe24OrderTotal replaced). Dead import. Build/lint passed, so non-blocking.
  Fix inline: drop `firstPositiveAmount` from the L3 import list (keep cafe24OrderTotal).

## Escalate to Architect
(none)

## Notes (no action required)
- Formula correctness depends on tenders being mutually exclusive — payment_amount
  must EXCLUDE points/credits (이민수: 50000 = card only, after 12000 naver_point
  deducted). Diagnosis confirms this; the assumption is documented in the types.ts
  comment. If Cafe24 ever returns payment_amount INCLUDING points for some channel,
  the sum would double-count. Left as a documented assumption, not a defect.
- route.ts L375 `detailOrder ?? o`: when the per-order detail fetch fails
  (detailRes not ok → detailOrder=null), it falls back to list item `o`, which
  lacks actual_order_amount. That degrades gracefully (payment_amount+naver_point
  if present, else firstPositiveAmount fallback) rather than crashing. Acceptable.

## Cleared
Reviewed cafe24OrderTotal (types.ts L132-145), its two call sites
(webhook.ts L399 = getOrder detail `cafe24Order`; orders/route.ts L375 =
`detailOrder ?? o` with detailOrder = single-order detail), the schema.ts L281
BUSINESS_RULES line, and firstPositiveAmount call-site sweep. Field paths exact
(naver_point top-level, points/credits_spent nested in actual_order_amount),
coupons correctly excluded, all 3 tender cases (full-card / full-points / mixed)
and zero-sum defensive fallback verified. discount_amount, payment_method,
migrations, and tools.ts untouched as stated. No double-count under the stated
exclusivity assumption. Passes — one cosmetic dead-import to drop.
