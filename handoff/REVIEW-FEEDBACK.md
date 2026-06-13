# Review Feedback — Feature C: 카페24 주문자 등록 시 구매품목 텍스트 저장
Date: 2026-06-12
Status: APPROVED WITH CONDITIONS

## Conditions

- src/app/(dashboard)/pos/RefundModal.tsx:152 + src/lib/ai/tools.ts:2903,2917,2921 — **환불 경로가 null product 에서 크래시**.
  이 스텝은 카페24 ONLINE 주문(sales_orders, channel='ONLINE', status='COMPLETED', 실제 branch_id·order_number 보유 — webhook.ts:265-289, 결제 시 332에서 COMPLETED 전환)에 product_id=NULL + item_text 품목 행을 처음으로 적재한다.
  그 주문은 `searchSalesOrdersForRefund`(return-actions.ts:293 status IN COMPLETED/PARTIALLY_REFUNDED + branch_id 필터)와 `getSalesOrderForRefund`(order_number)로 **환불 검색에 그대로 노출**된다. 직원이 해당 카페24 주문을 환불 선택하면:
    · RefundModal.tsx:152 `product_id: i.product.id`
    · tools.ts:2903 `product_id: i.product.id` (전액환불)
    · tools.ts:2917 `match.product.name` / 2921 `match.product.id` (부분환불)
  가 NULL product 에서 TypeError 로 터진다.
  **이 스텝 이전엔 카페24 주문에 sales_order_items 가 아예 없어(`(order.items||[]).map`가 빈 배열) 크래시가 없었다 — 즉 본 스텝이 신규로 유발하는 회귀다** (webhook.ts 에 sales_order_items insert 없음 확인).
  수정: 환불 항목 매핑 시 product_id=NULL 행을 안전 처리. 권장은 (a) `getSalesOrderForRefund`/검색 시 product_id=NULL(item_text) 행을 환불 대상에서 제외하거나, (b) RefundModal·tools 환불 경로에서 `i.product?.id` 가 없으면 그 라인을 환불 항목에서 스킵 + 사용자에게 "외부 채널 텍스트 품목은 환불 불가" 안내. processRefund 가 product_id 로 재고 차감/COGS 분개를 하므로 NULL 을 그대로 넘기면 안 됨. 어느 쪽이든 Arch 가 정책(카페24 주문 POS 환불 허용 여부)을 정하는 게 깔끔 — 아래 Escalate 참조.

## Escalate to Arch

- 카페24 ONLINE 주문을 POS 환불 모달/에이전트 환불로 환불 가능하게 둘 것인가? — 카페24 결제·환불은 본래 자사몰 측에서 처리되고 ERP 는 매출 동기화만 한다(개인정보 정책상 고객 자동생성도 안 함). ONLINE 주문을 POS 환불 대상에서 통째로 제외하면 위 크래시는 원천 차단되고 정책상으로도 맞을 가능성이 높다. 코드 레벨에서 단정 불가 — 비즈니스 결정 필요.

## Cleared

- 마이그 080: product_id DROP NOT NULL(멱등) + item_text IF NOT EXISTS + 컬럼 코멘트. 기존 행·정책 무영향. 통과.
- registerCafe24Customers(cafe24-actions.ts:96-136): 고객 연결(97-102)은 try 밖에서 먼저 수행 → 품목 insert 실패해도 고객 등록·연결 성공. 멱등 가드(116-118: 해당 soId 에 품목 1건이라도 있으면 skip) 재클릭 중복 차단 정상. product_id=null/item_text/quantity/unit_price=price||0/total_price=(price||0)*qty/order_option 매핑 정확. 신규·기존 양 경로 모두 cafe24_order_id 로 soId 재확보 후 적재. 통과.
- orders/route.ts: order_items 인터페이스(63), live 매핑(341-346, detailOrder.items→name/quantity/price/option), DEMO 더미(145-176), items_summary 병존 유지. 통과.
- shipping/page.tsx: interface order_items?(45) + payload 포함(757). 통과.
- customers/[id]: select item_text(217), 검색 필터 폴백(268), mainItems 폴백(950), 렌더 폴백(1118) — 전부 `product?.name || item_text` 옵셔널 체이닝. NULL product 무크래시. 통과.
- 그 외 sales_order_items 소비자 null-safety 검증: dashboard/details(62,96,173 `i.product?.name`), dashboard/route, reports/page(372 `item.product?.name`), accounting-actions COGS(133 `item.product?.cost`), SalesListTab(419·511·876·1749·1906 모두 `it.product?.name`) — 전부 옵셔널 체이닝, NULL product 에 "알 수 없음" 폴백. 크래시 없음(환불 경로만 예외 — Condition).
- Arch 주장 검증 결과: "ONLINE 주문 재고 미차감 + dashboard/detail null-safe" 는 dashboard/detail 한해 사실 확인. 단 환불 경로는 그 주장 범위 밖이며 크래시함(위 Condition).
- 빌드: 080 미적용 상태에서 select-only item_text + try/catch insert degrade 로 통과 확인(REVIEW-REQUEST 빌드 로그 + 코드 구조 일치).
- AI Sync: schema.ts:70-72 sales_order_items product_id(nullable—080) + item_text(080) + 카페24 텍스트 품목 주석 갱신 완료. CLAUDE.md AI sync 규칙 준수.

---

# Re-Review — AMENDMENT (환불 경로 회귀 차단)
Date: 2026-06-12
Ready for Builder: YES

## Must Fix
없음 (0건).

## Cleared
- **getSalesOrderForRefund (return-actions.ts:340-342)**: select `*` 라 channel 포함, single 후 `channel==='ONLINE'`이면 product deref 이전에 `{data:null, error}` 즉시 반환. POS 환불의 유일한 order 적재 경로.
- **searchSalesOrdersForRefund (return-actions.ts:294)**: `.neq('channel','ONLINE')` — 카페24 ONLINE 주문이 환불 검색 목록에 미노출. 이중 차단.
- **RefundModal.tsx**: `order`는 L77 setOrder가 유일 적재점이고, L55 getSalesOrderForRefund→L56 error 단락으로 ONLINE 주문은 setOrder 도달 불가. 따라서 NULL product 라인이 모달에 진입할 수 없음. 추가로 제출 경로 activeItems.filter(i.product?.id) + product_id=i.product?.id (L151-154)로 방어선 유지.
- **tools.ts execRefundSalesOrder**: 동일 getSalesOrderForRefund(L2883) → ONLINE 단락(L2884). 전액환불 `.filter(i.product?.id)`(L2902), 수량 에러 메시지 `match.product?.name ?? match.item_text ?? '-'`(L2919), 부분환불 `!match.product?.id`이면 에러 반환 후 refundItems 미투입(L2921-2922). 무가드 deref 잔존 없음.
- **processRefund 도달 보장**: ONLINE 제외(소스)와 per-line product?.id 필터(소비처) 이중으로, processRefund에 넘어가는 모든 라인은 product_id 보유 확정. 재고복원·COGS 분개에 NULL 미유입.
- **scope**: diff 3파일 한정(return-actions +4, RefundModal 14, tools 19줄). 전부 환불 경로 null-safety. 마이그 080 미수정(untracked, Arch 소유). build ✓ (080 미적용 상태 통과).

## Should Fix (비차단 — 선택)
- RefundModal.tsx:351-352 렌더 `item.product.name`/`item.product.code`는 여전히 무가드 deref. 현재는 getSalesOrderForRefund의 ONLINE 거부로 NULL product 라인이 도달 불가하므로 크래시 없음. 단 "channel 제외가 유지된다"는 전제에 의존. 향후 POS 채널에 텍스트 품목이 생기면 렌더가 깨짐(현재 그런 데이터 없음). belt-and-suspenders로 `item.product?.name`/`?.code ?? item.item_text ?? '-'` 권장. 5분 미만이면 인라인, 아니면 BUILD-LOG.
