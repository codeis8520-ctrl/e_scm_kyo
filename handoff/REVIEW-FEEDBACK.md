# Review Feedback — Batch 2a: AI 에이전트 판매등록 + 캠페인 도구
Date: 2026-06-03
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
- `src/lib/ai/tools.ts:3422` — send_campaign 대상수 사전집계의 grade 조건이 `campaign?.target_grade && campaign.target_grade !== 'ALL'`로 truthy 가드를 포함. sendCampaignCore(campaign-send-core.ts:51)는 `campaign.target_grade !== 'ALL'`로 가드 없음. target_grade가 null이면 두 경로의 대상수가 갈림(핸들러는 등급필터 생략, core는 grade=null eq). 실무상 target_grade는 createCampaign 기본값 'ALL'로 non-null이라 차이 미발생이고, 표시용 집계라 실제 발송(core)은 영향 없음. 일치시키려면 truthy 가드 제거. 5분 미만 — 인라인 또는 BUILD-LOG.

## Escalate to Architect
없음.

## Cleared
processPosCheckout 회귀 0(actions.ts diff는 +65 전부 신규 createSimpleSalesOrder, 기존 함수·CheckoutPayload·CartItem·POS 호출부 무변경), createSimpleSalesOrder는 미지원 필드(paymentSplits/shipping/shipFromBranchId/cashReceived/discount) 전부 비우고 위임만(외상·택배·할인 누출 불가, payment_method cash/card/kakao만, 포인트 회원+use_points min(balance,final)), create_sales_order 핸들러는 resolveBranchForWrite(staff 본인지점 강제)·findProduct 부분진행 없는 전체거부·qty≤0 거부·price=products.price(클라 입력가 불신)·branch.code 별도조회 정상, send_campaign 사전집계 조건이 sendCampaignCore와 일치(is_active·cafe24_% 제외·grade·branch_id)·sendCampaign(id) 시그니처, 4도구 AGENT_TOOLS/WRITE_TOOLS/executeTool/buildConfirmDescription 전부 등록(confirm 우회 없음)·DANGEROUS_TOOLS에 create_sales_order·send_campaign, requireHq 캠페인 3종(+campaign-actions 내부 requireHQ 이중방어), schema.ts 패턴4+룰2 동기화·DB_SCHEMA 무변경, 범위가드(send_kakao/create_shipment/B2B/마이그 미접촉) — 모두 통과.
