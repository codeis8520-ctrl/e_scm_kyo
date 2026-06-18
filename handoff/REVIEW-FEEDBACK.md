# Review Feedback — Step A (resolveSendTargets)
Date: 2026-06-18
Ready for Builder: YES

## Must Fix
(none)

## Should Fix
- notification-actions.ts:452 — `isHQ = !session.role || HQ_ROLES.has(session.role)`. The `!session.role` branch is DEAD CODE, not a live gap: `getSession()` returns null when the `user_role` cookie is missing (session.ts:27) and `requireSession()` throws on null, so `session.role` is always a non-empty string here. No role-less session can reach this line, so mass-send is NOT exposed. Recommend dropping `!session.role` so the mass-send gate reads `HQ_ROLES.has(session.role)` only — explicit allow-list, no "unknown role = HQ" implication for future readers. Under-5-min inline fix.

## Escalate to Architect
- ids-mode RBAC (Open Q②): A non-HQ user passing other-branch customer IDs is correctly filtered by `.eq('primary_branch_id', branchScope)` (L480) — column verified present+indexed (schema.sql:149,377). branchScope is sufficient for ids mode as built. Confirm this silent-drop behavior (other-branch IDs vanish without error) is the intended UX vs. an explicit reject. Code is correct either way; this is a product call.

## Cleared
Reviewed resolveSendTargets (notification-actions.ts:419-526): RBAC mass-send gate (HQ-only), branch-scope filtering on both ids/grade/all queries, 1000-cap pagination while-loop with page<PAGE termination, 200-chunk .in(), phone-null exclusion + normalized dedup with accurate {targets,total,skipped}, and additive-only exports leaving sendSmsAction/sendKakaoAction/runNotificationBatch/Solapi signatures untouched. Build + types pass. No Must Fix.
