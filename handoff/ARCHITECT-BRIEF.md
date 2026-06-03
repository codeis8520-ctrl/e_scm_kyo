# Architect Brief — Batch 1: AI 에이전트 mutating 도구 5종 + 위험도 인프라

## Goal
AI 에이전트가 화면 없이 **외상 수금/취소·발주취소·생산취소·안전재고 설정**을 수행하고, 고위험 도구는 2차 확인을 거치는 `DANGEROUS_TOOLS` 인프라가 생긴다.

## Build Order

### 0) 위험도 인프라 — `DANGEROUS_TOOLS`
- `src/lib/ai/tools.ts`: `WRITE_TOOLS` 선언(L898) 아래 export:
  ```ts
  export const DANGEROUS_TOOLS = new Set<string>([ 'cancel_credit_order' ]);
  ```
- `src/app/api/agent/route.ts`: confirm 분기(L290 `if (WRITE_TOOLS.has(toolName))` 내부, `buildConfirmDescription` 직후) `DANGEROUS_TOOLS.has(toolName)`이면 description 말미 경고 라인 append(`⚠️ 되돌릴 수 없는 작업입니다. 한 번 더 확인해주세요.`). import에 DANGEROUS_TOOLS 추가.
- Flag: 별도 round-trip/새 pending 상태머신 만들지 말 것. confirm 구조·executeTool 호출부 변경 금지. 경고 라인 append만.

### 1) `settle_credit_order` (외상 수금) — `execSettleCreditOrder(sb,args,ctx)`
- order_number로 sales_orders 조회(payment_method='credit', branch 조인). 없음/이미수금(credit_settled) 에러. `assertBranchAccess(ctx, order.branch.id,...)`.
- `const { settleCreditOrder } = await import('@/lib/accounting-actions')` → `settleCreditOrder({ orderId: order.id, settledMethod: args.method })`.
- 파라미터: order_number(req), method(req enum cash/card/kakao/card_keyin). 성공 JSON: 주문번호·수금액·수단.

### 2) `cancel_credit_order` (외상 취소, DANGEROUS) — `execCancelCreditOrder`
- order_number로 조회+assertBranchAccess. `cancelCreditOrder({ orderId, reason: args.reason, userId: ctx.userId })` (credit-actions.ts:19, 내부 requireSession). 세션 의존 문제 시 액션 에러 surfacing.
- 성공 JSON에 복원 재고·역분개 안내 명시. 파라미터: order_number(req), reason(req).

### 3) `cancel_purchase_order` (발주 취소) — `execCancelPurchaseOrder`
- purchase_orders order_number 조회(branch_id, status). DRAFT/CONFIRMED만(친절 에러 위해 선조회). `assertBranchAccess(ctx, po.branch_id,...)`. `cancelPurchaseOrder(po.id)` (bare id). reason은 표시용(액션 미사용).
- 파라미터: order_number(req), reason(optional).

### 4) `cancel_production_order` (생산 취소) — `execCancelProductionOrder`
- `requireHq(ctx,'생산 지시 취소')`. production_orders order_number 조회. PENDING/IN_PROGRESS만. `cancelProductionOrder(po.id)` (bare id).
- 파라미터: order_number(req), reason(optional).

### 5) `set_safety_stock` (안전재고) — `execSetSafetyStock`
- `findProduct(sb, args.product_name)`(L940). branch_name 있으면 `resolveBranchForWrite` → (branch_id,product_id) inventories 행 id → `updateSafetyStock(inventoryId, safety_stock)`. 없으면 staff=본인지점 단건, HQ=`bulkUpdateSafetyStock(product_id, safety_stock)` 전지점.
- 파라미터: product_name(req), safety_stock(req number≥0), branch_name(optional). 성공 JSON: 제품·대상·값·영향행수.

### 6) 공통 등록 (5개 전부)
- AGENT_TOOLS 정의 추가(형식: cancel_sales_order L733 참고, 한국어 사용예).
- WRITE_TOOLS Set에 5개 추가(L898).
- executeTool switch(L1037~)에 5개 case.
- buildConfirmDescription(route.ts L488 switch)에 5개 case(add('라벨',값) 패턴).
- (선택) buildSuccessDetail(route.ts L450) settle/cancel 요약.

### 7) AI Sync — schema.ts BUSINESS_RULES (필수)
- `[자주 쓰는 패턴]`(L202)에 매핑 추가: 외상 수금→settle_credit_order / 외상 취소→cancel_credit_order / 발주 취소→cancel_purchase_order / 생산 취소→cancel_production_order / 안전재고 설정→set_safety_stock.
- DB_SCHEMA 변경 없음(새 테이블/enum 없음).

## Out of Scope (배치1 제외)
- create_sales_order/POS 판매 → 배치2(서버 래퍼 createSimpleSalesOrder 신설 후). processPosCheckout 직접 호출 금지.
- 캠페인·send_kakao·create_shipment·B2B·수동분개/마감·마스터 CRUD·엑셀임포트·삭제확장 → 배치2/3.
- userRole 미지정 RBAC 정책·한 턴 다중쓰기 구조 변경 → 스코프 밖.
- route.ts confirm 상태머신/pending_action 구조·DB 마이그 금지.

## Acceptance
- `npm run build` 통과.
- 5개 도구가 AGENT_TOOLS·WRITE_TOOLS·executeTool·buildConfirmDescription 전부 등록(누락 0).
- DANGEROUS_TOOLS export + route.ts 경고 라인이 cancel_credit_order에만.
- 핸들러: 미해결 식별자 한국어 에러, staff 권한위반 차단.
- 시그니처 일치: cancelPurchaseOrder/cancelProductionOrder=bare id, settleCreditOrder={orderId,settledMethod}, cancelCreditOrder={orderId,reason,userId}.
- schema.ts 패턴 5개 추가.
- 보안: Richard 보안 리뷰 필수(RBAC·세션의존·역분개).

## 확인된 시그니처 (추측 금지)
- settleCreditOrder({orderId, settledMethod:'cash'|'card'|'kakao'|'card_keyin'})→{success,error} (accounting-actions.ts:721)
- cancelCreditOrder({orderId, reason?, userId?})→{error}|성공 (credit-actions.ts:19, 내부 requireSession)
- cancelPurchaseOrder(id)→{error}|{success} DRAFT/CONFIRMED만 (purchase-actions.ts:297)
- cancelProductionOrder(id)→{error}|{success} PENDING/IN_PROGRESS만 (production-actions.ts:599)
- updateSafetyStock(inventoryId, safetyStock) / bulkUpdateSafetyStock(productId, safetyStock) (inventory-actions.ts:7/28)
- RBAC: requireHq(ctx,label)/resolveBranchForWrite(sb,ctx,branchName)/assertBranchAccess(ctx,branchId,label) (tools.ts:978/990/1018)
