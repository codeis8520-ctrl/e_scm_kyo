# Architect Brief — Cafe24 주문자 등록 시 구매품목 텍스트 저장 (단일 스텝)

## Goal
배송 카페24 '주문자 고객 등록' 시 해당 자사몰 주문의 구매 품목을 sales_order_items에 텍스트(product_id=null, item_text=상품명)로 저장한다. 등록 후 고객 구매내역 탭에 카페24 품목이 보인다.

## 락된 결정 (변경 금지)
- 저장 위치 = sales_order_items 텍스트 확장 (B안). legacy_orders 재사용 안 함.
- 마이그 번호 = **080** (079까지 존재 확인됨). Arch가 직접 Supabase 적용. Bob은 .sql 작성만.
- 캡처 시점 = registerCafe24Customers. **기존 고객 연결 + 신규 생성 양쪽 모두** 품목 저장.
- 가격 비필수: unit_price/total_price NOT NULL → 카페24 price 없으면 0. LTV는 sales_orders.total_amount 헤더 기준이라 영향 없음.
- 단일 배포 스텝. DB+route+action+UI+렌더+AI sync 한 PR. (마이그 미적용 상태에서도 build·런타임 방어.)

## Build Order

### 1. 마이그 080 (.sql만, 적용은 Arch)
- 파일: `supabase/migrations/080_sales_order_items_text.sql`
- `ALTER TABLE sales_order_items ALTER COLUMN product_id DROP NOT NULL;`
- `ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS item_text TEXT;`
- 멱등(IF NOT EXISTS). 기존 행 product_id 값 보존 — DROP NOT NULL은 기존 데이터 무영향.
- option은 기존 `order_option` 컬럼 재사용 (새 컬럼 X).

### 2. AI 스키마 동기화 (같은 PR 필수 — CLAUDE.md 규칙)
- `src/lib/ai/schema.ts` DB_SCHEMA의 sales_order_items: `product_id` nullable 표기 + `item_text` 추가.
- 주석: `item_text = 카페24 텍스트 품목(우리 products 매핑 안 됨, product_id=null인 행)`.

### 3. orders route — 구조화 품목 노출
- `src/app/api/cafe24/orders/route.ts`
- interface `Cafe24OrderForShipping`(L51~68)에 필드 추가: `order_items: { name: string; quantity: number; price: number; option: string }[]`
- detailOrder.items(L286~)에서 매핑: name=`i.product_name`, quantity=`i.quantity ?? 1`, price=`Number(i.product_price ?? i.payment_amount ?? 0)`(없으면 0), option=`extractItemOptions(i)`. items_summary는 그대로 유지(둘 다 노출).
- DEMO_ORDERS(L135~)에도 order_items 더미 추가(타입 통과용).

### 4. registerCafe24Customers 시그니처 확장
- `src/lib/cafe24-actions.ts` (L52~109)
- items 타입에 `order_items?: { name: string; quantity: number; price: number; option?: string }[]` 추가.
- customerId 확정 후 sales_orders update로 받은 `upd[0].id`(sales_order pk)에 대해:
  - **멱등 가드**: `sb.from('sales_order_items').select('id').eq('sales_order_id', soId).limit(1)` → 이미 있으면 insert 스킵(재클릭 중복 방지).
  - 없으면 it.order_items를 insert: `{ sales_order_id: soId, product_id: null, item_text: oi.name, quantity: oi.quantity, unit_price: oi.price||0, total_price: (oi.price||0)*(oi.quantity||1), order_option: oi.option||null }`.
- 기존 고객 연결(customerId=exist.id) 경로에서도 동일하게 insert — 단, 그 경로는 `.is('customer_id', null)` 조건으로 update upd가 비어있을 수 있음(이미 연결됨). soId가 없으면(upd 비었으면) 기존 연결 주문의 sales_order id를 별도 조회해서라도 품목 가드+insert. → 정확히: customerId 있으면 항상 `eq('cafe24_order_id').select('id')`로 soId 확보 후 품목 처리.
- Flag: insert 실패해도 고객 등록 자체는 성공 처리(품목은 best-effort). 카운트 메시지는 기존 유지.

### 5. shipping page UI — 등록 호출에 품목 포함
- 카페24 주문탭에서 registerCafe24Customers 호출하는 곳(shipping page 컴포넌트) 찾아, 선택 주문의 `order_items`를 payload에 포함. Bob: grep `registerCafe24Customers(` 호출처 확인 후 수정.

### 6. 구매내역 렌더 폴백
- `src/app/(dashboard)/customers/[id]/page.tsx`
- L217 select: `items:sales_order_items(... order_option, item_text, product:products(name))` — item_text 추가.
- L1117 렌더: `{it.product?.name || it.item_text || '-'}`
- L949 mainItems: `.map((i:any) => i.product?.name || i.item_text).filter(Boolean)`
- 품목 검색 필터: sales_order items 대상 필터가 있으면 item_text도 포함(legacy L1216처럼). 없으면 skip.

## Out of Scope
- POS/매출분개/재고차감 경로 — ONLINE 주문은 재고 미차감, product_id=null 텍스트 품목 안 탐. 가드 불필요(확인 완료). dashboard route L271·details는 이미 null-safe(`product?.name || '알 수 없음'`).
- 카페24 품목코드 → products 매핑(향후 별도).
- 과거 이미 등록된 카페24 주문 소급 품목 채우기.

## Acceptance
- `npm run build` 통과(마이그 미적용 상태에서도 — item_text는 select에만, insert는 런타임).
- 마이그 080 적용 후: 카페24 주문 등록 → 구매내역 탭에 품목 표시.
- 같은 주문 재등록(재클릭) 시 품목 중복 insert 안 됨.
- 신규 고객·기존 고객 연결 양쪽 모두 품목 저장.
- DB_SCHEMA 동기화 diff 포함.

## Escalation
없음 — 정책 전부 Project Owner 확정. 신규 제품 동작 추가 없음.

---

# AMENDMENT — 환불 경로 회귀 차단 (Step 후속, 같은 PR)

## 결정 (Arch 락)
**both = 정책 제외(b) + null-safety(1).**
근거: 카페24 ONLINE 주문은 자사몰 결제·환불 채널이고 ERP는 매출 동기화 전용 — 이미 Project Owner가 락한 "sync-only / 고객 자동생성 안 함" 정책과 동일 선상. 따라서 ONLINE 주문을 POS·에이전트 환불 검색에서 통째로 제외하는 것이 정책에 맞고 크래시를 원천 차단한다. 신규 제품 동작이 아니라 기존 정책의 적용이므로 **Project Owner 추가 확인 불필요(이미 락된 결정의 귀결)**.
null-safety는 제외와 무관하게 방어선으로 유지(향후 다른 텍스트 품목 소스 대비). processRefund가 product_id로 재고복원+COGS 분개를 하므로 NULL product 라인은 환불 대상이 될 수 없다.

## Build Order (환불 경로만 — 다른 영역 확장 금지)

### A. ONLINE 주문 환불 검색 제외 (return-actions.ts)
- `searchSalesOrdersForRefund` (L286~): 쿼리 빌더에 `.neq('channel', 'ONLINE')` 추가 (status `.in(...)` 체인 근처). channel 컬럼 존재 확인 후. ONLINE 주문이 검색 결과에 안 뜨게.
- `getSalesOrderForRefund` (L322~): `.eq('order_number', ...)` 결과 single 받은 뒤, `data.channel === 'ONLINE'`이면 `{ data: null, error: '카페24(자사몰) 주문은 POS에서 환불할 수 없습니다. 자사몰에서 처리하세요.' }` 반환. (select에 channel 미포함이면 select 목록에 `channel` 추가 — 현재 `*`라 이미 포함됨, 확인만.)

### B. null-safety (방어선 — 3개 site)
- `RefundModal.tsx:152` → `product_id: i.product?.id ?? null`. 추가로 `activeItems.map` 직전(또는 activeItems 산출 지점)에서 `i.product?.id`가 없는 라인은 환불 항목에서 제외(filter). 즉 텍스트 품목 라인은 매핑 대상에서 빠지게.
- `tools.ts:2901~2906` 전액환불 map: `i.product?.id`가 없는 라인 제외 후 매핑 (`(order.items||[]).filter((i:any)=>i.product?.id).map(...)`, 내부 `product_id: i.product.id` 유지).
- `tools.ts:2911` 부분환불 find: `i.product?.name` (이미 옵셔널). `:2917` `match.product?.name ?? match.item_text ?? '-'`, `:2921` `match.product?.id`가 없으면 그 req는 에러 반환(`"외부 채널 텍스트 품목은 환불할 수 없습니다."`) — NULL product_id를 refundItems에 넣지 말 것.

## Out of Scope (AMENDMENT)
- processRefund 내부 로직 변경 X. 환불 외 경로 X. UI 안내 카피 외 신규 화면 X.

## 마이그레이션
**없음.** 080 그대로. 스키마 변경 없음 (channel은 기존 컬럼).

## Acceptance (AMENDMENT)
- ONLINE 주문이 POS 환불 검색·order_number 조회에 안 뜬다(또는 명확한 거부 메시지).
- NULL product 라인이 어떤 환불 경로로도 processRefund에 안 들어간다.
- `npm run build` 통과.
