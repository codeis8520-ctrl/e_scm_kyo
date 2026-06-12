# Review Feedback — Step 1: 지점 매출 비교 서브뷰
Date: 2026-06-12
Ready for Builder: YES

## Must Fix
(none)

## Should Fix
(none)

## Escalate to Architect
(none)

## Cleared
Reviewed the 지점비교 서브뷰 in src/app/(dashboard)/pos/SalesListTab.tsx
(state 158-163, init 314-316, loadCompare 320-345, fetch gate 348-350,
compareMatrix 352-380, toggle 382-386, UI gates 555/601/617/668/690/797/1014,
matrix table 1013-1062). Permission gate is on both UI and the data fetch:
isBranchUser hides the toggle so subView can never become 'compare' for a
branch user, and loadCompare only fires on subView==='compare', so a branch
user never issues the multi-branch .in() query. Aggregation uses .range()
pagination (no silent cap), excludes CANCELLED/REFUNDED/PARTIALLY_REFUNDED at
the query, and groups by fmtDateKST — consistent with kstDayStart/kstDayEnd
(all Asia/Seoul), no KST-midnight off-by-one. Matrix row totals, column totals,
and grand total all derive from one pass over compareRows and reconcile; empty
cells default to 0 (no NaN/blank). Default selection = all active branches;
전체/해제 work; empty selection early-returns with a sensible empty state.
List view controls and compare controls are mutually gated — no leak, no
regression. No schema.ts/tools.ts changes (none warranted). Build passes. Clear.
