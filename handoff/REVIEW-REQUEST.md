# Review Request — Batch 1: AI 에이전트 mutating 도구 5종 + DANGEROUS_TOOLS

Date: 2026-06-03
Ready for Review: YES

## Files Changed

### src/lib/ai/tools.ts
- AGENT_TOOLS (cancel_sales_order 정의 직후) — settle_credit_order / cancel_credit_order / cancel_purchase_order / cancel_production_order / set_safety_stock 정의 추가(한국어 사용예 포함).
- WRITE_TOOLS Set — 5개 도구 등록.
- `export const DANGEROUS_TOOLS = new Set(['cancel_credit_order'])` 신설(WRITE_TOOLS 직후).
- executeTool switch — 5개 case 추가.
- 파일 말미(execAnalyzeData 직후) — exec 핸들러 5종:
  - execSettleCreditOrder: order_number+payment_method='credit' 조회, credit_settled/미존재 한국어 에러, assertBranchAccess, settleCreditOrder({orderId,settledMethod}). 성공 JSON: 주문번호·수금액·수금수단.
  - execCancelCreditOrder: order_number 조회, payment_method/credit_settled 가드, assertBranchAccess, cancelCreditOrder({orderId,reason,userId:ctx.userId}). 성공 JSON에 재고복원·역분개 안내.
  - execCancelPurchaseOrder: order_number 조회, DRAFT/CONFIRMED 선검증, assertBranchAccess, cancelPurchaseOrder(bare id). reason은 표시용.
  - execCancelProductionOrder: requireHq, order_number 조회, PENDING/IN_PROGRESS 선검증, cancelProductionOrder(bare id).
  - execSetSafetyStock: findProduct, branch_name지정 또는 staff면 resolveBranchForWrite→inventories 행 id→updateSafetyStock(단건); HQ+미지정이면 bulkUpdateSafetyStock+count 조회(전지점). safety_stock<0 한국어 에러.

### src/app/api/agent/route.ts
- import에 DANGEROUS_TOOLS 추가.
- confirm 분기(WRITE_TOOLS.has 내부): description을 const→let, DANGEROUS_TOOLS.has(toolName)이면 경고 라인(`⚠️ 되돌릴 수 없는 작업입니다. 한 번 더 확인해주세요.`) append. pending_action/상태머신/executeTool 호출부 구조 미변경.
- buildConfirmDescription switch(delete_record case 직후, Phase B 앞) — 5개 case(add() 패턴).

### src/lib/ai/schema.ts
- BUSINESS_RULES [자주 쓰는 패턴] — 5개 매핑 추가. DB_SCHEMA 변경 없음(새 테이블/enum 없음).

## Self-review

- **Richard가 먼저 볼 것**: cancelCreditOrder의 세션 의존(credit-actions.ts:19 내부 requireSession). 에이전트 라우트는 세션 쿠키 컨텍스트에서 실행되므로 정상 동작 예상. 실패 시 액션이 {error} 반환 → 핸들러가 surfacing(브리프 #2 허용).
- **브리프 요구사항 전수 확인**: 5개 도구 × (AGENT_TOOLS·WRITE_TOOLS·executeTool·buildConfirmDescription) 전부 등록(grep count 1씩 확인). DANGEROUS_TOOLS export + 경고 라인 cancel_credit_order에만.
- **빈 데이터/실패 시 사용자에게**: 미해결 식별자/상태위반은 전부 한국어 에러 JSON. staff 권한위반은 assertBranchAccess/requireHq가 한국어 에러 차단.
- **시그니처 일치**: 실제 파일 5개 모두 재확인, 브리프와 100% 일치(불일치 없음). bare id 2종(purchase/production), 객체 인자 2종(settle/cancelCredit), inventory 2종 확인.

## Build / 누락 검증
- `npm run build` ✅ 통과 (compiled successfully, 전 라우트 정상).
- grep 검증: 5개 도구가 AGENT_TOOLS(name)·WRITE_TOOLS·executeTool case·buildConfirmDescription case 각 1회씩 등록(누락 0). cancel_credit_order는 DANGEROUS_TOOLS에도 추가되어 WRITE_TOOLS grep 2회 카운트(정상).

## Open Questions
- 없음. 보안 리뷰 포인트: (1) cancelCreditOrder 세션 의존, (2) set_safety_stock의 staff/HQ 분기 권한, (3) 역분개 흐름은 기존 액션 위임이라 신규 분개 로직 추가 없음.

## Out of Scope (BUILD-LOG 기록)
- 없음 (Known Gaps 0).
