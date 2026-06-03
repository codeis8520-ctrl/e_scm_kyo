# Review Request — Batch 2a: AI 에이전트 판매등록 + 캠페인 도구
Date: 2026-06-03
Ready for Review: YES

## Files Changed
- `src/lib/actions.ts:2440-2507` — 신규 `createSimpleSalesOrder`: LLM 최소입력(branch/customer/items/payment_method/use_points)을 CheckoutPayload로 조립 후 **기존 processPosCheckout 위임만**. 미지원(택배/분할/외상/할인) 필드는 비움. payment_method cash/card/kakao만. 포인트는 회원+use_points일 때만 min(balance, finalAmount).
- `src/lib/ai/tools.ts:950-1042` — AGENT_TOOLS 4종 정의(create_sales_order/create_campaign/activate_campaign/send_campaign), analyze_data 정의 앞.
- `src/lib/ai/tools.ts:1027-1041` — WRITE_TOOLS +4, DANGEROUS_TOOLS +2(create_sales_order, send_campaign).
- `src/lib/ai/tools.ts:1198-1203` — executeTool switch +4 case.
- `src/lib/ai/tools.ts:3236-3441` — exec 핸들러 4종 + resolveCampaign 헬퍼(execCancelCreditOrder 직후). execCreateSalesOrder는 branch.code/channel 별도 조회 후 createSimpleSalesOrder 위임. execSendCampaign은 sendCampaignCore 조건을 복제한 count head:true 사전집계 후 sendCampaign 호출.
- `src/app/api/agent/route.ts:733-768` — buildConfirmDescription +4 case. create_sales_order/send_campaign은 DANGEROUS 공통 경고가 호출부에서 append됨.
- `src/lib/ai/schema.ts:213-217` — [자주 쓰는 패턴] +4줄.
- `src/lib/ai/schema.ts:222-232` — 판매(POS)·캠페인 룰 2섹션. DB_SCHEMA 변경 없음.

## Self-Review
- **Richard가 먼저 볼 곳**: (1) processPosCheckout 호출부/시그니처 무변경 — diff 0. createSimpleSalesOrder는 신규 추가, 기존 POS UI 경로 미접촉. (2) send_campaign 사전집계 조건이 sendCampaignCore와 정확히 일치하는지(is_active, cafe24_% 제외, grade, branch_id). (3) DANGEROUS 2건 등록 및 confirm 경고.
- **Brief 요구사항 전부 구현**: createSimpleSalesOrder(위임)·도구4·WRITE4·DANGEROUS2·executeTool4·confirm4·schema패턴4+룰. 미지원 입력 없음(택배/분할/외상/할인 필드 자체 미존재). requireHq 캠페인 3종. staff 지점 강제(resolveBranchForWrite).
- **에러/빈입력 시 사용자에게 보이는 것**: 빈 품목→"판매 품목이 없습니다.", 미존재 제품→"제품 \"X\"을(를) 찾을 수 없습니다.", qty≤0→"\"X\" 수량이 올바르지 않습니다 (1개 이상).", 미존재 지점→resolveBranchForWrite 한글 에러, 캠페인 staff→"...은(는) 본사 권한이 필요합니다." 모두 한글, 내부 DB 용어 비노출.

## Acceptance 대조
- `npm run build` ✅ Compiled successfully (8.1s), 에러/경고 없음.
- create_sales_order: 회원/비회원·cash/card/kakao·use_points 동작, 미존재 제품/지점/빈품목/qty≤0 한글 에러, 택배·할인 입력 불가(파라미터 부재), DANGEROUS 경고.
- 캠페인 3종 requireHq. send_campaign 응답 대상수/성공건수/실패건수.
- 기존 processPosCheckout 호출부(POS) 무변경.
- schema.ts 반영, DB_SCHEMA 미변경.
- grep 검증: AGENT_TOOLS 4 / executeTool 4 / WRITE_TOOLS 4 / confirm 4 / DANGEROUS 2 모두 확인.

## Open Questions
- 없음. 시그니처 전부 실제 파일에서 재확인했고 브리프와 일치.

## Out of Scope (logged in BUILD-LOG)
- send_kakao / create_shipment / B2B 3종 → Batch 2b. 미접촉.
- createSimpleSalesOrder 택배/분할/외상/할인 지원 → 영구 미지원.
- processPosCheckout 리팩터 → 금지(위임만).
