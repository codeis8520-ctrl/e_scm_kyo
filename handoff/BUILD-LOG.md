# BUILD-LOG — #48 Phase 1: 취소·환불 ↔ 택배/재고/분개 연동 봉합

## 과제
단일원장(#48) 정합. 전표 취소(STORE) + 카페24 취소/환불(webhook)이 연결 택배·재고·매출분개까지 일관 처리. 발송완료건 취소차단(환불유도). DB 마이그 없음(앱레벨).

## Locked Decisions (사인오프 완료)
1. 발송완료(SHIPPED/DELIVERED) 연결 shipment 있으면 STORE 전표 취소 **차단** + 환불유도. 데이터 무변경.
2. 카페24 재고복원 소급범위 = ONLINE_SALE 차감멱등키 존재분만(=컷오프 2026-06-17 이후 자동필터). 이전건 미차감→무대상.
3. 1전표:N배송 허용. sales_order_id UNIQUE 강제 금지. 연결 shipments 다건 처리.
4. shipments.status enum에 CANCELLED 없음 → PENDING/PRINTED 연결건은 **물리삭제**(마이그 회피).
5. 부분환불 재고복원은 범위 밖(전체환불만). 카페24 취소 시 shipment void도 범위 밖(NULL링크 다수, Phase 2 후).
6. AI Sync: schema.ts reference_type에 ONLINE_SALE_CANCEL/ONLINE_REFUND 추가 + 취소 BUSINESS_RULES 갱신. cancel_sales_order 도구는 위임 상속(description 보강).

## 상태
- 2026-06-19 Bob 빌드 완료 → Richard 리뷰 대기. `npm run build` 0 error.

## 빌드 내역 (Bob)
- **A. STORE 취소↔택배**: `voidShipmentsForOrder(db, {salesOrderId, cafe24OrderId, reason})` 신설(shipping-actions.ts). sales_order_id 다건조회→0건이면 cafe24_order_id 폴백. SHIPPED/DELIVERED 1건이라도 있으면 {blocked:true} 무변경, 그 외 .delete().in('id', ids). cancelSalesOrder·cancelCreditOrder 양쪽 try 진입 직후(모든 mutation 전) 호출, blocked면 즉시 환불유도 메시지 반환. 양쪽 revalidatePath('/shipping') 추가.
- **B. 카페24 webhook**: `restoreOnlineOrderInventory(sb, salesOrderId, refType)` 신설(online-inventory.ts, deduct 역연산). ONLINE_SALE movement 존재 품목만 복원(컷오프·미매핑 자동필터) + refType 멱등가드. handleOrderCancelled: order select 확장(status,total_amount,discount_amount,payment_method), 이미 CANCELLED면 skip+success(재진입 멱등), status update 성공 후 재고복원(ONLINE_SALE_CANCEL) + COMPLETED였으면 net 음수 역분개(sourceType=SALE_CANCEL). handleOrderRefunded: 기존 역분개 미변경, 전체환불(!isPartial)만 재고복원(ONLINE_REFUND) 추가.
- **C. AI Sync**: schema.ts reference_type에 ONLINE_SALE_CANCEL/ONLINE_REFUND+CREDIT_CANCEL 명시, 취소 BUSINESS_RULES 1줄 추가. tools.ts cancel_sales_order description에 발송완료 차단·미발송 삭제 보강.
- 멱등키: 재고=reference_id(item.id)+reference_type, 분개=createSaleJournal 내부(source_id=order.id). 가드 실행순서=cancel 본문 try 최상단(재고/포인트/분개보다 먼저).

## Known Gaps (열린 채)
- 부분환불(PARTIALLY_REFUNDED) 수량단위 재고복원 미지원 — 전체환불만.
- 카페24 취소/환불 시 연결 shipment void 미처리 — Phase 2 backfill 후 검토.
- 카드 PG 취소 — 시스템 외부.

## 후속 단계
- Phase 2: 과거 카페24 shipment.sales_order_id backfill(cafe24_order_id 정확매칭, Arch 직접) + STORE 1전표중복 가드(마이그 094).
- Phase 3: 역방향 정식화 syncShipmentFromReceipt(단건 수령처리→shipment).
