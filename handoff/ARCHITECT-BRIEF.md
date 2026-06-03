# Architect Brief — Batch 2a: AI 에이전트 판매등록 + 캠페인 도구

## Goal
에이전트가 (1) 자연어로 단순 POS 판매 등록(create_sales_order), (2) 알림톡 캠페인 생성·활성화·발송(create_campaign/activate_campaign/send_campaign). 판매등록·발송은 DANGEROUS, send_campaign은 대상수 사전집계.

## 변경 파일 (4개, DB 변경 없음)
- `src/lib/actions.ts` — 신규 `createSimpleSalesOrder` 1개 (기존 함수 미변경)
- `src/lib/ai/tools.ts` — AGENT_TOOLS 4 + WRITE_TOOLS 4 + DANGEROUS_TOOLS 2 + executeTool case 4 + exec 핸들러 4
- `src/app/api/agent/route.ts` — buildConfirmDescription case 4
- `src/lib/ai/schema.ts` — BUSINESS_RULES [자주 쓰는 패턴] 4 + 판매/캠페인 룰

## A. `createSimpleSalesOrder` (actions.ts) — 먼저 구현
위치: processPosCheckout 인근. CheckoutPayload/processPosCheckout/CartItem/resolvePointRate/ShippingInfo **미변경, 재사용만**.
시그니처:
```ts
export async function createSimpleSalesOrder(input: {
  branch_id: string; branch_code: string; branch_name: string; branch_channel?: string;
  customer_id?: string|null; customer_grade?: string|null;
  items: { product_id: string; name: string; price: number; quantity: number }[];
  payment_method: 'cash'|'card'|'kakao'; use_points?: boolean; user_id?: string|null;
}): Promise<{ orderNumber?: string; pointsEarned?: number; error?: string }>
```
구현(페이로드 조립 후 위임):
1. items 비면 `{error:'판매 품목이 없습니다.'}`.
2. cart: CartItem[] = items.map→`{productId,name,price,quantity}` (discount/orderOption/deliveryType/receiptDate 미설정=기본 PICKUP·할인0).
3. totalAmount=finalAmount=Σ(price×quantity), discountAmount=0.
4. 포인트: use_points && customer_id 일 때만. min(보유 balance, finalAmount). 비회원 false/0.
5. CheckoutPayload 조립 — 미지원 필드 전부 비움: paymentSplits 미설정, shipping:null, shipFromBranchId 미설정, cashReceived 미설정. gradePointRate=1.0(서버 resolvePointRate 재계산).
6. `return processPosCheckout(payload)` 결과 그대로.
Flag: processPosCheckout 내장 로직(음수재고·RAW/SUB거부·phantom BOM·과세배분·ORDER_COMPLETE 알림톡) 재구현 금지, 위임만. payment_method 3종만(card_keyin/credit/cod/mixed 거부). 할인/택배/분할/외상 입력 없음→영구 미발생.

## B. 도구 4종 (tools.ts)
**B-1 create_sales_order** (DANGEROUS): params customer_name?/phone?/branch_name?/items[{product_name,quantity}](req)/payment_method(enum cash/card/kakao req)/use_points?. description에 미지원 명시(택배·분할·외상·할인→POS). exec `execCreateSalesOrder`:
1. resolveBranchForWrite(sb,ctx,branch_name)→실패 error(staff 본인지점 강제).
2. customer_name||phone 있으면 findCustomer→없으면 비회원 진행. 찾으면 id/grade.
3. items 각 product_name→findProduct, 하나라도 못찾으면 error(부분진행 금지), quantity≤0 거부, price=products.price.
4. branch.code 확보: `sb.from('branches').select('code').eq('id',branch.id)` 1회(resolveBranchForWrite 시그니처 변경 금지, 핸들러 보강).
5. createSimpleSalesOrder({...}) 호출. 성공 시 {성공,주문번호,합계,적립포인트,고객}.
**B-2 create_campaign**: params name(req)/description?/target_grade?(기본 ALL)/branch_name?/solapi_template_id?/template_content?/scheduled_at?. requireHq. branch_name→findBranch→target_branch_id. `createCampaign(params)`. DRAFT 안내.
**B-3 activate_campaign**: params campaign_id|name(DRAFT 1건 조회). requireHq. `activateCampaign(id)`.
**B-4 send_campaign** (DANGEROUS): params campaign_id|name(ACTIVE). requireHq. 캠페인 조회→**대상수 사전집계**(sendCampaignCore 조건: customers is_active=true, phone NOT LIKE 'cafe24_%', target_grade≠ALL→grade eq, target_branch_id→branch_id eq; count head:true)→`sendCampaign(id)`. 응답에 targetCount/successCount/failCount.

## C. WRITE_TOOLS/DANGEROUS_TOOLS
- WRITE_TOOLS +4: create_sales_order, create_campaign, activate_campaign, send_campaign.
- DANGEROUS_TOOLS +2: create_sales_order, send_campaign.

## D. route.ts buildConfirmDescription — case 4
- create_sales_order: 🧾 판매 등록 / 고객·지점·품목(제품명×수량)·결제수단 (DANGEROUS 경고 공통 append).
- create_campaign: 📢 캠페인 생성 / 이름·대상등급·지점·예약.
- activate_campaign: ▶️ 활성화 / 식별자.
- send_campaign: 📨 발송 / 식별자 + "다수 고객 실발송"(정확 대상수는 exec 응답 targetCount).

## E. schema.ts 동기화
- [자주 쓰는 패턴] 4줄: 판매 등록→create_sales_order(택배·할인·외상 미지원→POS) / 캠페인 생성→create_campaign / 활성화→activate_campaign / 발송→send_campaign(다수 실발송).
- 판매(POS) 룰: create_sales_order=단순 현장판매 전용(단일결제·할인0·현장수령), 택배/분할/외상/할인 미지원→POS 안내, 등급·적립율 서버 자동(067).
- DB_SCHEMA 변경 없음.

## Out of Scope (→ 2b)
send_kakao, create_shipment, B2B 3종. createSimpleSalesOrder 택배/분할/외상/할인 지원(영구 미지원). processPosCheckout 리팩터 금지.

## Acceptance
- `npm run build` 통과.
- create_sales_order: 회원/비회원·cash/card/kakao·use_points 동작, 미존재 제품/지점/빈품목/qty≤0 한글 에러, 택배·할인 입력 불가, DANGEROUS 경고.
- 캠페인 3종 requireHq. send_campaign 응답 targetCount/successCount/failCount.
- 기존 processPosCheckout 호출부(POS) 무변경.
- schema.ts 반영, DB_SCHEMA 미변경. Richard 보안 리뷰 필수.

## 확인된 시그니처
- processPosCheckout(payload: CheckoutPayload)→{orderNumber,pointsEarned,stockUpdates}|{error} (actions.ts:1956). CartItem={productId,name,price,quantity,discount?,orderOption?,deliveryType?,receiptDate?}(1892).
- createCampaign(params) requireHQ→{success,data}|{error} DRAFT (campaign-actions.ts:80). activateCampaign(id) DRAFT→ACTIVE(200). sendCampaign(id) requireHQ→{success,successCount,failCount}(259).
- sendCampaignCore 대상: customers is_active=true, phone NOT LIKE 'cafe24_%', target_grade≠ALL→grade eq, target_branch_id→branch eq (campaign-send-core.ts:45-56).
- findBranch/findProduct/findCustomer/getPoints(tools.ts:1035-1057), requireHq/resolveBranchForWrite/assertBranchAccess(1078-1125). findBranch/resolveBranchForWrite code 미포함→핸들러서 별도 조회. 핸들러 패턴: execSettleCreditOrder(3175) 모범.
