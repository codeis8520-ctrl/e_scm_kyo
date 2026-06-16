# Review Request — 카페24 주문 흐름 수정 (Step 1: webhook memo + sales_order_items 생성)
Date: 2026-06-16
Ready for Review: YES

## Files Changed

- **src/lib/cafe24/types.ts:166-216** — extractItemOptions(+parseOptionPairs/isNoSelection/safeDecode)를 orders/route.ts에서 이관해 export. 표시용 옵션 텍스트 추출("key: value", 정렬X). 기존 normalizeOptionValue 계열(safeDecodeKey/isNoSelectionValue, 매핑키 전용·정렬됨)과 이름·의미 분리 — 충돌 없음.

- **src/app/api/cafe24/orders/route.ts:4** — import에 extractItemOptions 추가.
- **src/app/api/cafe24/orders/route.ts:6-8** — module-local extractItemOptions(+deps) 정의 삭제, 이관 주석으로 교체. 호출부(itemsSummary L329, order_items.option L370)는 동일 구현 import → 무회귀.

- **src/lib/cafe24/webhook.ts:3** — import에 normalizeOptionValue, extractItemOptions 추가.
- **src/lib/cafe24/webhook.ts:312-317** — (A) memo 수정: recipient.address 있으면 `Delivery: addr(+detail)`, 없으면 null. 'Delivery: undefined' 영구버그 제거(임베드 응답에 평면 recipient_address 없음).
- **src/lib/cafe24/webhook.ts:351-449** — (B) order_created 로그 직후 sales_order_items 생성. 멱등 가드(존재 시 skip) → 매핑 일괄조회(N+1 금지) → row 빌드(매핑 product_id+내부명 / 미매핑 null+product_name) → insert + 컬럼미존재(42703) 최소컬럼 재시도 → 실패 시 logSyncEvent('order_items_error'). 전체 try/catch — 주문 생성 성공 불변. 재고/movements/포인트 미생성.

- **src/lib/ai/schema.ts:283** — BUSINESS_RULES 1줄(카페24 동기화 시 sales_order_items 생성, 재고 미차감).

## Self-Review

- **Richard가 먼저 볼 곳**: (1) types.ts 헬퍼 이관 후 route.ts 무회귀 — 동일 구현 import, build ✓로 타입 확인. (2) 멱등 가드가 registerCafe24Customers(cafe24-actions L117)와 동일 계약인지 — sales_order_id 기준 limit 1 존재검사 동일. (3) order_option은 extractItemOptions(표시용)이고 매핑키 normalizeOptionValue와 다름 — 브리프 명시대로 분리.
- **모든 요구사항**: A/B/C/D 전부 구현(BUILD-LOG 대조). 재고차감·movements·point_history 미생성 확인.
- **실패 시 사용자에게 보이는 것**: 품목 insert 실패해도 주문 row는 생성됨(판매현황에 표시). 실패는 cafe24_sync_logs에 order_items_error로 기록만 — raw 에러 사용자 노출 없음.

## Open Questions
- unit_price 폴백에서 Cafe24OrderItem 타입은 price: number만 가지나, 임베드 응답이 product_price를 쓸 수 있어 `(i as any).product_price`로 보강 읽음. route.ts도 동일 패턴(L410 product_price ?? payment_amount). 이중 폴백 의도 맞는지 확인 요망.

## Out of Scope (logged in BUILD-LOG)
- 재고 차감 / inventory_movements / point_history (별도 스프린트).
- delivery_type=PARCEL·receipt_status 정밀화(default 수용).
- 과거 주문 보정 = Step 2(인플레이스 백필).
