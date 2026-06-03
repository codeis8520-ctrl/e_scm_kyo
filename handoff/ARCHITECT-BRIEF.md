# Architect Brief — Batch 2b: AI 에이전트 갭 메우기 (배송 + B2B)

## Goal
에이전트가 (1) 배송 레코드 생성(create_shipment), (2) B2B 납품 등록(create_b2b_sales_order), (3) B2B 수금(settle_b2b_order), (4) B2B 납품 취소(cancel_b2b_order). send_kakao는 제외(Known Gaps).

## 확인된 시그니처 (재확인 완료)
- `createShipment(data: ShipmentInput)`→`{success}|{success:false,error}` (shipping-actions.ts:49). ShipmentInput 필수: source('CAFE24'|'STORE'), sender_name, sender_phone, recipient_name, recipient_phone, recipient_address. 선택: zipcode/detail, delivery_message, items_summary, branch_id, created_by, sales_order_id, cafe24_order_id. **단순 insert, 외부발송 없음**.
- `createB2bSalesOrder({partnerId, branchId?, items:[{productId,quantity,unitPrice}], memo?, deliveredAt?})`→`{error}|{success,orderNumber}` (b2b-actions.ts:150). RAW/SUB 차단·재고차감(branchId 있을 때)·분개 자동.
- `settleB2bOrder(orderId, amount, method?)`→`{error}|{success}` (b2b-actions.ts:311). orderId=UUID. method 'card'→1120 else 1110. SETTLED/CANCELLED 거부.
- `cancelB2bOrder(orderId, reason?)`→`{error}|{success}` (b2b-actions.ts:376). UUID. settled_amount>0 거부. 재고 IN 복원.
- `b2b_sales_orders`: order_number(B2B-YYYYMMDD-XXXX), partner_id, status, total_amount, settled_amount.
- 헬퍼: findBranch/findProduct/findCustomer(tools.ts:1131~), requireHq/resolveBranchForWrite/assertBranchAccess. **findPartner 없음**→핸들러 인라인(b2b_partners name/code).

## Build Order

### 1. tools.ts
- AGENT_TOOLS 4종(analyze_data 앞, 2a 뒤):
  - create_shipment: recipient_name(req), recipient_phone(req), recipient_address(req), recipient_zipcode?, recipient_address_detail?, delivery_message?, items_summary?, branch_name?. **sender/source 비노출**(핸들러가 채움).
  - create_b2b_sales_order: partner(req, 명/code), items(req `[{product_name,quantity,unit_price?}]`), branch_name?, memo?.
  - settle_b2b_order: order_number(req), amount(req), method?('card'|'cash').
  - cancel_b2b_order: order_number(req), reason?.
- WRITE_TOOLS +4. DANGEROUS_TOOLS +3: create_shipment, create_b2b_sales_order, cancel_b2b_order (settle 제외).
- executeTool switch +4. import: b2b-actions(create/settle/cancel), shipping-actions(createShipment).
- exec 핸들러:
  - execCreateShipment(sb,ctx,args): branch_name 있으면 resolveBranchForWrite(staff 본인지점 강제)→branch_id. sender 기본값=branch 조회(name→sender_name, phone→sender_phone, 없으면 ''). source='STORE' 고정. created_by=ctx.userId. createShipment(input) 반환.
  - execCreateB2bSalesOrder(sb,ctx,args): partner 인라인 `b2b_partners.select('id,name,code').or(name ilike/code eq).limit(1)` 못찾으면 에러. branch resolveBranchForWrite(옵션). items 각 product_name→findProduct, unit_price 미지정시 product.price, 하나라도 미해결 에러. createB2bSalesOrder({partnerId,branchId,items,memo}) 반환.
  - execSettleB2bOrder(sb,args): b2b_sales_orders order_number→id 선조회(SETTLED/CANCELLED 친절 차단). settleB2bOrder(id, amount, method) 반환.
  - execCancelB2bOrder(sb,args): order_number→id 선조회(settled_amount>0 친절 차단). cancelB2bOrder(id, reason) 반환.

### 2. route.ts buildConfirmDescription(L491) — 4 case
- create_shipment: "{recipient_name}님께 배송 레코드 생성 (주소: {recipient_address})."
- create_b2b_sales_order: "거래처 '{partner}'에 {items.length}품목 B2B 납품 전표 등록 (재고차감·분개)."
- settle_b2b_order: "납품 전표 {order_number}에 {amount}원 수금."
- cancel_b2b_order: "납품 전표 {order_number} 취소 (재고 역복원)."
- DANGEROUS 경고는 L292 기존 분기 자동(route 구조 미변경).

### 3. schema.ts (필수)
- [자주 쓰는 패턴] 4줄: 배송 등록→create_shipment / 거래처 납품→create_b2b_sales_order(재고차감+분개) / 거래처 수금→settle_b2b_order / 납품 취소→cancel_b2b_order(수금 0건만).
- B2B 룰 섹션 보강: 상태흐름(DELIVERED→PARTIALLY_SETTLED→SETTLED, CANCELLED), settled>0 취소불가, RAW/SUB 납품불가. shipments 1줄(STORE/CAFE24, SHIPPED 전환 시 알림톡).
- DB_SCHEMA 변경 없음.

## Flag (추측 금지)
- create_shipment sender_*/source는 LLM 인자 비노출, 핸들러가 branch에서 채움. branch.phone 없으면 sender_phone='' fallback.
- settle/cancel 핸들러는 order_number→UUID 선조회 후 액션에 UUID 전달(액션은 UUID 받음).
- B2B 단가 = 제품 price(getPartnerPrices 스코프 밖).
- staff는 resolveBranchForWrite로 본인지점 강제.

## Out of Scope (Known Gaps)
- send_kakao: 제외(Solapi templateId/variableKeys를 LLM이 안전히 못 채움. 대량은 send_campaign 정식경로).
- B2B 단가표 연동, shipment 송장/SHIPPED 전환, deliveredAt 지정.

## Acceptance
- `npm run build` 통과.
- AGENT_TOOLS 4 / WRITE_TOOLS 4 / DANGEROUS_TOOLS 3 / executeTool 4 case + 핸들러 4 + import.
- route buildConfirmDescription 4 case. DANGEROUS 3종 2차경고 자동.
- schema.ts 패턴 4 + B2B/shipments 룰. DB_SCHEMA 무변경.
- 기존 createShipment/createB2bSalesOrder/settle/cancel 호출부(shipping/trade UI) diff 0.
- 보안: 발송·재무·재고 → Richard 리뷰 필수.
