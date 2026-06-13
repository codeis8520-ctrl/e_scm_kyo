# Review Request — Feature C: 카페24 주문자 등록 시 구매품목 텍스트 저장 (1 step)
Date: 2026-06-12
Ready for Review: YES

빌드: `npm run build` ✓ Compiled successfully in 6.6s (마이그 080 미적용 상태에서 통과).

## Files Changed
- src/lib/ai/schema.ts:70-72 — sales_order_items DB_SCHEMA 동기화: product_id nullable 표기 + item_text 추가 + 카페24 텍스트 품목 주석(CLAUDE.md AI sync 규칙).
- src/app/api/cafe24/orders/route.ts:62-67 — interface Cafe24OrderForShipping에 order_items{name,quantity,price,option}[] 필드 추가.
- src/app/api/cafe24/orders/route.ts:145-176 — DEMO_ORDERS 3건에 order_items 더미 추가(Omit 타입 통과용).
- src/app/api/cafe24/orders/route.ts:~334 — live 매핑: detailOrder.items → order_items(name=product_name, quantity=quantity??1, price=Number(product_price??payment_amount??0)||0, option=extractItemOptions). items_summary 병존 유지.
- src/lib/cafe24-actions.ts:52-56 — registerCafe24Customers items 타입에 order_items? 추가.
- src/lib/cafe24-actions.ts:93-135 — customerId 확정 후 cafe24_order_id로 soId 확보 → 멱등 가드(sales_order_items 이미 있으면 skip) → product_id=null/item_text/order_option insert. try/catch best-effort(실패해도 고객 등록 성공).
- src/app/(dashboard)/shipping/page.tsx:43-45 — Cafe24OrderForShipping interface에 order_items? 추가.
- src/app/(dashboard)/shipping/page.tsx:756 — handleRegisterCustomers payload에 order_items 포함.
- src/app/(dashboard)/customers/[id]/page.tsx:217 — sales_order_items select에 item_text 추가.
- src/app/(dashboard)/customers/[id]/page.tsx:267-268 — 품목 검색 필터에 item_text 폴백 포함.
- src/app/(dashboard)/customers/[id]/page.tsx:949 — mainItems 폴백 product?.name||item_text.
- src/app/(dashboard)/customers/[id]/page.tsx:1117 — 렌더 폴백 product?.name||item_text||'-'.

## AMENDMENT 수정 (환불 경로 회귀 차단 — Must Fix 대응)
빌드: `npm run build` ✓ Compiled successfully (마이그 080 미적용 상태에서 통과).
- src/lib/return-actions.ts:294 — searchSalesOrdersForRefund 쿼리에 `.neq('channel', 'ONLINE')` 추가. 카페24 ONLINE 주문이 POS 환불 검색에 안 뜸.
- src/lib/return-actions.ts:338-340 — getSalesOrderForRefund: single 결과가 `channel === 'ONLINE'`이면 `{ data: null, error: '카페24(자사몰) 주문은 POS에서 환불할 수 없습니다…' }` 반환(select `*`라 channel 포함).
- src/app/(dashboard)/pos/RefundModal.tsx:150-156 — activeItems를 `i.product?.id` 보유 라인만 filter 후 map, `product_id: i.product?.id`. NULL product 라인 제외.
- src/lib/ai/tools.ts:2901-2907 — 전액환불 map 전에 `.filter((i)=>i.product?.id)` 추가.
- src/lib/ai/tools.ts:2917 — 수량 에러 메시지 `match.product?.name ?? match.item_text ?? '-'`.
- src/lib/ai/tools.ts:2919-2921 — 부분환불 match에 `product?.id` 없으면 `'외부 채널 텍스트 품목은 환불할 수 없습니다.'` 에러 반환(NULL 라인 refundItems 미투입).
- Defense-in-depth: ONLINE 제외와 무관하게 null-safety 방어선 유지(processRefund가 product_id로 재고복원+COGS 분개).

## Open Questions
- 멱등 가드는 sales_order당 "품목 존재 여부"로 판단. 카페24 동기화 주문은 헤더만 생성(품목 미생성)이라 첫 등록 시 비어 있는 게 정상 — 가드는 재클릭 중복만 차단. 의도대로인지 확인.
- price 폴백 i.product_price ?? i.payment_amount: payment_amount가 라인 단위가 아닐 가능성 있으나 브리프 명시 그대로 구현. LTV는 헤더 total_amount 기준이라 무영향.

## Out of Scope (logged in BUILD-LOG)
- 카페24 품목코드 → products 자동 매핑(향후 별도).
- 과거 등록 주문 소급 품목 채우기.
- 마이그 080 .sql 작성/적용 — Arch 소유.
