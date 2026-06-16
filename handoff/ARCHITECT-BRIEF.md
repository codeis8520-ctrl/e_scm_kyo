# Architect Brief — 카페24 주문 연동 수정 (Step 1: webhook memo + 품목 생성)

## Goal
카페24 주문이 웹훅/크론으로 들어올 때 sales_orders 뿐 아니라 **sales_order_items**(품목)도 생성되고, memo의 `Delivery: undefined`가 실제 받는분 주소로 채워진다. (재고 차감은 범위 밖 — 별도 스프린트.)

## 진단 (확정)
- `handleOrderCreated`(src/lib/cafe24/webhook.ts L200~358): `client.getOrder`로 items/buyer/receivers 포함 전체 주문을 가져오지만 sales_orders insert(L284~314)만 하고 **cafe24Order.items를 전혀 안 씀**.
- L312 `memo: \`Delivery: ${cafe24Order.recipient_address}\`` — recipient_address는 평면 필드, 임베드 응답엔 없음(받는분=receivers[]). → 항상 undefined.
- sync-orders.ts → processCafe24Webhook → handleOrderCreated. **이 함수 한 곳만 고치면 웹훅+크론 양쪽 반영.**

## Build Order

### A. memo 수정 (webhook.ts L312)
- 이미 추출돼 있는 `recipient`(L250 extractRecipientInfo) 사용.
- `recipient.address`(상세는 `recipient.addressDetail`) 사용. 형식 LOCKED:
  - 주소 있으면: `memo = 'Delivery: ' + [recipient.address, recipient.addressDetail].filter(Boolean).join(' ')`
  - 주소 없으면(null): `memo = null` — **'Delivery: undefined' 문자열 절대 금지.**

### B. sales_order_items 생성 (sales_orders insert 성공 직후, L346 logSyncEvent 부근)
- 위치: `newOrder` 확정 후(L344 orderError 가드 통과 후), `linkOrCreateCustomer` 호출 전/후 무관. try/catch로 감싸 **품목 실패가 주문 생성 성공을 깨지 않게** 한다(registerCafe24Customers L133 선례 동일).
- 매핑 조회 = **orders/route.ts L312~360 패턴 그대로 재사용**(N+1 금지, 일괄 조회):
  1. `cafe24Order.items`(Cafe24OrderItem[])에서 `(product_code, normalizeOptionValue(option_value))` 키 수집.
  2. `cafe24_product_map` 전체(또는 해당 code) select → Map(mapKey→product_id). 마이그082 적용됨.
  3. 매핑된 product_id들로 products(id,name) 일괄 select → Map(product_id→name).
  4. try/catch로 감싸 테이블 미적용/조회 실패 시 빈 Map 폴백(미매핑 degrade).
- 각 item → sales_order_items row (shape = cafe24-actions.ts L120~129 선례 그대로):
  - `sales_order_id`: newOrder.id
  - 매핑됨: `product_id` = 매핑 product_id, `item_text` = 내부 product.name (또는 null)
  - 미매핑: `product_id` = null, `item_text` = `item.product_name`
  - `quantity` = item.quantity || 1
  - `unit_price` = Number(item.price ?? item.product_price ?? 0) || 0  ← quantity/unit_price/total_price NOT NULL이므로 폴백 필수
  - `total_price` = unit_price * quantity
  - `order_option` = extractItemOptions(item) || null  (옵션 표시 텍스트. 매핑 키 normalizeOptionValue와 **다름** — 혼동 금지)
  - delivery_type / receipt_status: **명시 안 함** → DB DEFAULT('PICKUP'/'RECEIVED', 마이그052). 카페24=택배지만 이번 범위에서 default 수용, 의미왜곡 아님(Known Gap에 기록).
- 멱등: insert 전 `sales_order_items where sales_order_id=newOrder.id limit 1` 존재 검사 → 있으면 skip(registerCafe24Customers L117 선례와 동일 계약 — 수동 등록이 먼저 만든 경우 중복 방지).
- **재고 차감·inventory_movements·point_history 절대 생성 안 함**(범위 밖, 명시).

### C. extractItemOptions 단일출처화 (drift 방지)
- `extractItemOptions`(+ deps `parseOptionPairs`/`isNoSelection`/`safeDecode`)는 현재 orders/route.ts에 **module-local**. webhook.ts에서 필요.
- LOCKED: 이 함수들을 `src/lib/cafe24/types.ts`로 옮겨 `export` → webhook.ts와 orders/route.ts **둘 다 import**. 복붙 금지.
- 주의: types.ts에 이미 `safeDecodeKey`/`isNoSelectionValue`(normalizeOptionValue 전용, 정렬됨)가 있음 — **이름 충돌·의미 혼동 금지.** extractItemOptions 계열은 별도 함수로 유지(표시용 vs 매핑키용). 옮긴 뒤 orders/route.ts의 local 정의는 삭제하고 import로 교체.
- Flag: 함수 이동 후 orders/route.ts 동작 무회귀 확인(extractItemOptions 호출부 3곳: itemsSummary, order_items.option).

### D. AI Sync (CLAUDE.md 매트릭스)
- 의미변화 없음(컬럼 추가/enum 변경 없음). schema.ts BUSINESS_RULES에 **1줄**: "카페24 주문 동기화 시 sales_order_items 생성(매핑되면 product_id, 미매핑은 item_text 텍스트), **재고 미차감**(별도)." tools.ts 무관. 마이그 없음.

## Out of Scope (→ BUILD-LOG Known Gaps)
- 재고 차감 / inventory_movements / point_history (별도 스프린트).
- delivery_type=PARCEL·receipt_status=PARCEL_PLANNED 정밀화(카페24 전수 택배지만 default 수용).
- **과거 깨진 카페24 주문 보정 = Step 2**(아래 메커니즘 LOCKED, 이번 빌드 미포함).
- total_amount 0원 과거 백필(이미 forward-only 결정).

## Acceptance
- npm run build ✓.
- 신규 카페24 주문(웹훅/크론) → sales_orders 1행 + sales_order_items N행(품목 종수만큼) 생성. 매핑된 품목은 product_id 연결, 미매핑은 item_text.
- memo에 'undefined' 문자열 없음(주소 있으면 주소, 없으면 null).
- 동일 주문 재처리 시 품목 중복 insert 없음(멱등). 수동 등록(registerCafe24Customers) 후 웹훅 재수신해도 중복 없음.
- 재고/movements/포인트 변동 0(범위 밖 미생성 확인).
- orders/route.ts 무회귀(extractItemOptions import 전환).

---

# Step 2 (LOCKED 설계 — Step 1 배포 후 별도 빌드)
## 과거 깨진 카페24 주문 보정
- 메커니즘 LOCKED: **인플레이스 백필(삭제-재생성 아님).** 이유 = 기존 sales_orders에 customer_id 연결·환불·분개 FK가 걸려 있어 삭제 시 위험. 삭제-재생성 금지.
- 형태 LOCKED: **1회성 스크립트**(scripts/, psycopg가 아닌 ts/node로 getOrder 재조회 필요 → 관리 라우트 또는 scripts/*.ts). Arch가 Step 2 브리프에서 라우트 vs 스크립트 최종 결정.
- 동작: cafe24_order_id 있는 기존 sales_orders 순회 → client.getOrder 재조회 → (1) memo·recipient_* UPDATE (2) sales_order_items 없으면 Step 1 로직으로 생성. **삭제 없음, customer_id 불변, 재고 미반영.**
- handleOrderCreated의 'already exists' skip(L258)은 그대로 둠 — 백필은 별도 경로.

## 에스컬레이션 (Project Owner)
- 없음 — 정책 모두 확정(범위=memo+품목, 재고 범위밖, 과거=인플레이스 백필). 신규 제품 동작·UX 변경 없음. Deploy Gate에서만 go-ahead 확인.
