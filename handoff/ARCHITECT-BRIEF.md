# Architect Brief — 재사용 토대 2개 (택배 프리미티브 + 범용 팬아웃)

이전 전용도구(create_gift_batch) 브리프는 폐기. 이 브리프가 유효본.

## Goal
AI 에이전트가 "전표 생성→택배"를 단일 프리미티브로 조합하고, 임의의 단일대상 쓰기 도구를 리스트에 팬아웃할 수 있게 토대 2개를 깐다. 이후 선물발송·대량 고객등록·B2B 다건은 코드 추가 없이 batch_execute 조합으로 처리.

---

## 토대 A — 택배 매출 프리미티브 (create_sales_order 확장)

### 결정 (LOCK)
- **신규 도구 안 만든다. 기존 `create_sales_order` 도구 + `createSimpleSalesOrder` 액션을 확장한다.** 모든 택배 필드는 optional → 기존 호출 100% 하위호환.
- 엔진 = `processPosCheckout`(src/lib/actions.ts L2437). CheckoutPayload는 이미 `shipping`/`shipFromBranchId`/cart deliveryType을 다 받는다. `createSimpleSalesOrder`(L2967)가 단지 그걸 안 넘길 뿐. **새 회계/재고 로직 0.**

### Build Order
1. **src/lib/actions.ts `createSimpleSalesOrder`(L2967)** — input에 optional 추가:
   ```
   ship_from_branch_id?: string;
   shipping?: {
     recipient_name: string; recipient_phone: string; recipient_address: string;
     recipient_zipcode?: string; recipient_address_detail?: string;
     delivery_message?: string; delivery_type?: 'PARCEL'|'QUICK';
   } | null;
   ```
   - payload 조립부(L3008~)에 `shipping`이 있으면 `payload.shipping = {...input.shipping, delivery_type: input.shipping.delivery_type || 'PARCEL'}`, `payload.shipFromBranchId = input.ship_from_branch_id || input.branch_id` 추가.
   - **sender_*는 안 채운다** (processPosCheckout이 ''로 넣고, 기존 CJ export resolveSenderForRow가 출고지점 폴백 처리 — 기존 정책과 충돌 금지).
   - shipping 없으면 기존 동작 그대로(방문 판매).

2. **src/lib/ai/tools.ts `execCreateSalesOrder`(L3853) + 도구 정의(L1108 인근)** — optional 택배 args 추가:
   ```
   recipient_name?, recipient_phone?, recipient_address?,
   recipient_zipcode?, recipient_address_detail?, delivery_message?
   ```
   - exec: recipient_name/phone/address 중 **하나라도 있으면 택배 모드** → 셋 다 필수 검증(하나만 비면 에러), shipping 객체 조립해 `createSimpleSalesOrder`에 전달. `ship_from_branch_id`=resolveBranchForWrite로 푼 branch.id(판매=출고 동일).
   - 도구 정의 description의 **"미지원: 택배 배송"(L1111) 문구 삭제** + "택배: recipient_* 지정 시 shipments 1:1 자동 생성, 송장발행은 update_shipment_tracking 별도" 추가. 분할/외상/할인 미지원은 유지.
   - 반환에 택배일 때 `배송: '택배 레코드 생성됨(PENDING)'` 한 줄 추가.

### 토대 A Out of Scope (→ Known Gaps)
- 포인트 사용(차감): use_points는 기존 그대로(택배라고 강제 false 아님 — 단건은 사용자가 명시 가능). **단, 팬아웃 대량 시 포인트 차감은 의도 밖 → batch_execute common_args에서 use_points 기본 미설정.**
- 비회원 발송인은 기존 create_sales_order 동작(customer 못 찾으면 비회원 진행) 그대로 — 포인트만 미적립.
- 배송비 개념 없음(금액=상품가 합).

---

## 토대 B — batch_execute 메타도구 (범용 팬아웃)

### 시그니처 (LOCK)
도구명: **`batch_execute`** (WRITE + DANGEROUS)
```
tool: string            // 대상 도구명 (FANOUT_TOOLS 화이트리스트 必). required
common_args?: object    // 전 item 공통 인자 (branch_name, payment_method 등)
items: object[]         // 개별 인자 배열. required, 1~50건
```
- 각 item 최종 인자 = `{ ...common_args, ...item }` (item이 common을 override).
- exec: `execBatchExecute(sb, args, ctx)` (src/lib/ai/tools.ts).

### 내부 디스패치 (LOCK — 재진입 안전)
- **executeTool(args.tool, merged, sb, ctx)를 item마다 직접 호출.** 기존 switch 정식 경로를 그대로 타므로 **대상 도구의 RBAC·검증을 100% 상속**(우회 불가).
- **재귀 차단 (가드 순서대로)**:
  1. `args.tool === 'batch_execute'` → 즉시 에러("batch_execute는 중첩 호출할 수 없습니다.").
  2. `!FANOUT_TOOLS.has(args.tool)` → 에러("'X'는 일괄 실행 대상이 아닙니다.").
- 각 item은 **독립 try/catch + 독립 commit**. executeTool은 item마다 새 processPosCheckout/액션을 호출하고 각자 DB 커밋 → 3번째 실패해도 1·2 생존(전역 트랜잭션 래퍼 없음 = 의도된 설계).
- executeTool 반환은 **JSON 문자열**. 각 item 결과를 `JSON.parse` 시도 → `.error` 있으면 실패, 없으면 성공. parse 실패 시 실패로 간주(raw 일부 보존).

### FANOUT_TOOLS 화이트리스트 (LOCK — 초기 멤버)
```
'create_sales_order',       // 토대 A — 택배/방문 단건 (선물발송·다건 판매)
'create_customer',          // 대량 고객등록
'create_b2b_sales_order',   // B2B 다건 납품
```
- send_campaign·delete_record·refund_sales_order·cancel_* 등 위험·비가역 도구는 **의도적으로 제외**(팬아웃 금지).
- batch_execute 자체는 FANOUT_TOOLS에 **넣지 않는다**(가드1과 이중방어).

### 결과 압축 + 상한 (LOCK)
- items 상한 **50**. 초과 시 에러("일괄 실행은 최대 50건까지 가능합니다.").
- 반환:
  ```
  {
    성공: true,
    대상도구: <tool>,
    총건수: N, 성공건수, 실패건수,
    성공샘플: [ {index, 식별자} ...최대 5건 ],   // 식별자 = 결과의 주문번호/전표번호/수령인/고객명 중 존재하는 것, 없으면 index만
    실패목록: [ {index, item요약, 사유} ...전체 ], // 실패는 전량 노출(없으면 생략)
    안내: "건별 독립 실행됨 — 실패 건은 다른 건에 영향 없음. 재시도하려면 실패 item만 다시 호출하세요."
  }
  ```
  - 성공은 카운트+샘플5만(컨텍스트 폭주 가드). 실패는 전량(사용자가 재시도 판단).
  - `item요약` = item의 첫 1~2개 식별 필드(recipient_name/customer_name/partner 등)만, 길면 절단.

### route.ts 변경 (LOCK)
1. **iteration 상한**: `src/app/api/agent/route.ts` L230 `for (let rounds = 0; rounds < 8; rounds++)` → **`< 12`**. (현재 6 아님, 8이 실제값. batch_execute가 팬아웃을 1턴 흡수하므로 소폭만.)
2. **confirm-gate 동작 확인(코드 변경 불필요, 검증만)**: L284~ WRITE_TOOLS 감지 → batch_execute는 WRITE라 **1회 confirm 발생(전체 팬아웃에 대한 단일 확인)**. 승인 경로 L155-156이 `executeTool(pending_action.tool,...)` 직접 호출 → 내부 루프의 item별 executeTool은 route confirm-gate를 안 거침(정상 — item마다 재확인 안 함).
3. **buildConfirmDescription / buildSuccessDetail (route.ts L420~/L470~ 부근 switch)**: batch_execute용 default/case가 읽을 만한 문장을 내도록 case 추가 — confirm: `"[일괄] {tool} {items.length}건 실행"`. success: 성공/실패 건수 요약. (switch에 없으면 깨지는 게 아니라 밋밋한 기본문구라 **Nice-to-have이나 권장**.)

---

## AI Sync (필수 — 매 커밋 매트릭스)
- **src/lib/ai/tools.ts**:
  - `batch_execute` 도구 정의 추가(AGENT_TOOLS 배열) + `execBatchExecute` + switch case(L1565 인근) 등록.
  - `create_sales_order` 도구 정의에 택배 optional 필드 + description 수정.
  - **WRITE_TOOLS**(L1321)에 `'batch_execute'` 추가. **DANGEROUS_TOOLS**(L1380)에 `'batch_execute'` 추가.
  - **FANOUT_TOOLS** 신규 상수(WRITE/DANGEROUS 인근에 export const) = 위 3멤버.
  - ToolContext RBAC는 대상 도구가 상속하므로 batch_execute 자체엔 추가 게이트 불필요(단, items 상한·화이트리스트가 게이트).
- **src/lib/ai/schema.ts** BUSINESS_RULES [자주 쓰는 패턴]에 1줄:
  `"다건/대량 요청(배송지N·고객N·납품N)은 batch_execute로 팬아웃: {tool, common_args, items[]}. 대상=create_sales_order(택배=recipient_* 지정)/create_customer/create_b2b_sales_order. 건별 독립 실행(부분실패 허용), 최대 50건."`
- **src/lib/actions.ts**: createSimpleSalesOrder 확장(액션 추가/시그니처 변경 — DB스키마 변경 아님, schema.ts DB_SCHEMA 영향 없음).

## 마이그레이션
- **불필요.** CheckoutPayload·shipments·createSimpleSalesOrder 전부 기존 구조 재사용. 094 shipments_sales_order UNIQUE는 건별 1:1이라 위반 없음.

## Out of Scope (→ BUILD-LOG Known Gaps)
- 배송지별 **다른 상품/다른 발송인**: batch_execute items[]에 각자 다른 product_name/customer_name 넣으면 사실상 지원됨(공통이 아닌 건 item에). 단 create_sales_order 단건은 여전히 1발송인. "동일상품 강제" 같은 제약은 없음 — 토대가 더 일반적.
- 송장 자동발행·택배사 연동: shipment PENDING 생성만. 발송=update_shipment_tracking 별도.
- 포인트 차감(use_points): 팬아웃 시 기본 미설정 권장. 전역 정책 강제는 안 함.
- **전역 트랜잭션 롤백 미제공**: 건별 독립 commit이 설계. N건 중 일부 실패 시 성공분은 유지(역롤백 없음).
- 비회원 발송인: create_sales_order 기존 동작 상속(포인트만 미적립).

## Acceptance
- create_sales_order에 recipient_3필드 지정 → sales_order 1 + items + inventory OUT + shipment 1:1(PENDING, recipient 채워짐) + 매출분개 + payments. recipient 미지정 시 기존 방문판매 무회귀.
- batch_execute {tool:'create_sales_order', common_args:{product_name,payment_method,branch_name}, items:[배송지3]} → 전표 3건(고객=common customer면 발송인 귀속), 3번째 일부러 실패시켜도 1·2 생존 + 실패목록에 1건.
- batch_execute {tool:'batch_execute',...} → 가드1 에러. {tool:'send_campaign',...} → 가드2 에러. items 51건 → 상한 에러.
- create_customer/create_b2b_sales_order 팬아웃도 동작(executeTool 정식경로 RBAC 상속 확인).
- route.ts rounds<12. batch_execute 호출 시 confirm 1회만.
- npm run build 0 error.

## Build 순서 권장
A1(actions.ts createSimpleSalesOrder) → A2(execCreateSalesOrder + 도구정의) → B1(execBatchExecute + FANOUT_TOOLS + switch + WRITE/DANGEROUS) → B2(route.ts rounds 12 + confirm/success case) → schema.ts AI Sync → npm run build → self-review → REVIEW-REQUEST.md.
