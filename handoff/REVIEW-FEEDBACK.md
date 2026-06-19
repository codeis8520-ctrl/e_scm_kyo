# Review Feedback — Step #51
Date: 2026-06-19
Ready for Builder: NO

## Must Fix
- src/lib/actions.ts:1130 (recordStockUsage) — **서버측 지점 권한 검증 부재.** #51은 지점직원(BRANCH_STAFF/PHARMACY_STAFF)을 재고 mutation 진입점(recordStockUsage)에 새로 연결한다(브리프: "지점직원 권한 확대"). 그런데 이 액션은 `requireSession()`도, 호출자 지점과 `input.branch_id` 일치 검증도 전혀 없다. 현재 "지점직원은 자기 지점만"은 UI(branches 필터 + 셀 disable)에만 존재 → 지점직원이 액션을 직접 호출해 임의 `branch_id`로 타 지점 재고를 차감(음수 가능)할 수 있다. UI 게이트는 보안 통제가 아니다.
  - **How to fix**: recordStockUsage 진입부에 `requireSession()` 추가 후, 이미 존재하는 패턴 `assertFromBranchOwnership(session, input.branch_id)`(actions.ts:1226)를 재사용해 거부. 같은 helper가 transfer에서 정확히 이 규칙(HQ급은 자유, 지점고정은 본인 지점만, branch_id 없으면 거부)을 강제하므로 새 로직 작성 금지·재사용. 비HQ가 타 지점 branch_id를 넘기면 `{ error }` 반환.

## Should Fix
- (없음)

## Escalate to Architect
- (없음) — ADJUST 경로는 adjustInventory(actions.ts:1029)에서 SUPER_ADMIN/HQ_OPERATOR 서버 검증이 이미 있어 의도대로 본사 전용이며 권한 확대 아님. 제품 결정 불요.

## Cleared (Must Fix 외 전부 통과)
UI 전환(셀 클릭→StockUsageModal preselect, ADJUST는 상단 버튼 분리, 데스크톱·flat 양쪽), UI RBAC 매트릭스(usageBlocked = materialBlocked || 타지점 || 현재고≤0), preselect(defaultProductId 1행 qty1·defaultBranchId 잠금·HQ 클릭 지점 고정), 0/없음 칸 비활성, 버튼·경고배너·힌트, 무손상(ADJUST/USAGE/Transfer/PackUnpack/MovementHistory/소수재고/movement 기록), 빌드·타입·schema.ts:172-173 동기화 — 모두 정상. 유일한 결함은 USAGE 액션의 서버측 지점 인가 누락.
