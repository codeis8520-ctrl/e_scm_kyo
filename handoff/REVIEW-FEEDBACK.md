# Review Feedback — Batch 1: AI 에이전트 mutating 도구 5종 + DANGEROUS_TOOLS
Date: 2026-06-03
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
- tools.ts:1041 (findProduct, 기존 코드) — `.single()` 사용으로 product_name 이 2개 이상 제품에 매칭되면 에러→null→"제품을 찾을 수 없습니다"로 잘못 표시됨. set_safety_stock 도 이 헬퍼에 의존. **이번 배치에서 도입된 결함 아님**(모든 product 도구 공통). 수정은 별도 BUILD-LOG Known Gap 으로. 이번 단계 블로킹 아님.

## Escalate to Architect
없음.

## Cleared
AI 에이전트 mutating 도구 5종(settle/cancel_credit·cancel_purchase·cancel_production·set_safety_stock) + DANGEROUS_TOOLS 인프라를 리뷰함. 5개 점검 영역 전부 통과:

1) **시그니처 정확성** — 5개 래핑 액션 실제 소스 대조 완료, 100% 일치:
   - settleCreditOrder({orderId, settledMethod}) — accounting-actions.ts:721 ✅
   - cancelCreditOrder({orderId, reason, userId}) — credit-actions.ts:19, 내부 requireSession ✅ (세션 실패 시 {error} 반환→핸들러 surfacing 정상)
   - cancelPurchaseOrder(bare id) — purchase-actions.ts:297, DRAFT/CONFIRMED 가드 ✅
   - cancelProductionOrder(bare id) — production-actions.ts:599, PENDING/IN_PROGRESS 가드 ✅
   - updateSafetyStock(invId,val)/bulkUpdateSafetyStock(productId,val) — inventory-actions.ts:7/28 ✅
   객체 인자 2종·bare id 2종·inventory 2종 형태 모두 정확.

2) **RBAC/권한 우회** — 안전:
   - settle/cancel_credit/cancel_purchase: order/po 의 실제 branch 조회 후 assertBranchAccess(staff면 ctx.branchId !== target → 한국어 에러 차단). 조회 전 권한검사 누락 없음(조회→가드→액션 순서).
   - cancel_production: requireHq 를 lookup 보다 먼저 호출 → staff 즉시 차단.
   - set_safety_stock: staff 는 항상 isStaffRole 분기로 단건 경로, resolveBranchForWrite 가 타 지점 branch_name 차단·본인 지점 강제. staff 전지점 bulk 도달 불가. bulk 는 HQ+미지정만.

3) **DANGEROUS_TOOLS** — export 정상. route.ts:290-294 confirm 분기는 const→let + 경고 라인 append 만(cancel_credit_order 한정). pending_action/상태머신/executeTool 호출부 구조 미변경, 새 round-trip 없음. ✅

4) **등록 완전성** — 5개 도구 AGENT_TOOLS·WRITE_TOOLS(L1015-1019)·executeTool switch(L1179-1183)·buildConfirmDescription(route.ts) 전부 1회씩 등록, 누락 0. WRITE_TOOLS 누락(=confirm 우회) 없음. ✅

5) **상태/중복 가드** — settle: credit_settled 재수금 차단. cancel_credit: 미존재/non-credit/이미수금 가드(+액션 내부 CANCELLED 재취소 차단). cancel_purchase/production: 상태 화이트리스트 선검증 친절 에러. 부분상태는 래핑 액션 트랜잭션에 위임. ✅

6) **AI Sync** — schema.ts [자주 쓰는 패턴] 5개 매핑 추가. DB_SCHEMA 변경 불필요 확인(새 테이블/enum 없음). ✅

7) **범위 가드** — create_sales_order/캠페인/processPosCheckout/마이그 미접촉. confirm 흐름 구조 보존. ✅
