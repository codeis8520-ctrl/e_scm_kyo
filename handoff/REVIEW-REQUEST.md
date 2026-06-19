# Review Request — #48 Phase 1: 취소·환불 ↔ 택배/재고/분개 봉합
Date: 2026-06-19
Ready for Review: YES

빌드: `npm run build` → ✓ Compiled successfully, 0 error.

## Files Changed

### A. STORE 전표 취소 ↔ 택배
- `src/lib/shipping-actions.ts:239-296` — `voidShipmentsForOrder(db, {salesOrderId, cafe24OrderId, reason})` 신설. sales_order_id 다건조회(.eq, single 금지) → 0건이면 cafe24_order_id 폴백. SHIPPED/DELIVERED 1건이라도 있으면 `{blocked:true, deleted:0}` 무변경 반환. PENDING/PRINTED만 남으면 `.delete().in('id', ids)`. 0건이면 `{blocked:false, deleted:0}`(멱등).
- `src/lib/sales-cancel-actions.ts:71-82` — try 진입 직후(모든 mutation 전) `voidShipmentsForOrder` 호출, blocked면 즉시 환불유도 메시지 반환. revalidatePath('/shipping') 추가.
- `src/lib/credit-actions.ts:46-57` — 동일 가드(try 최상단). revalidatePath('/shipping') 추가.

### B. 카페24 취소/환불 webhook
- `src/lib/cafe24/online-inventory.ts:91-189` — `restoreOnlineOrderInventory(sb, salesOrderId, refType)` 신설(deduct 역연산). 품목별 ONLINE_SALE movement 존재할 때만 IN 복원(컷오프·미매핑·track_inventory=false 자동 무대상) + refType(ONLINE_SALE_CANCEL/ONLINE_REFUND) 복원멱등 가드. reference_id=item.id.
- `src/lib/cafe24/webhook.ts:10` import 추가.
- `src/lib/cafe24/webhook.ts:762-816` (`handleOrderCancelled`) — order select 확장(status, total_amount, discount_amount, payment_method). 이미 CANCELLED면 skip+success(재진입 멱등). status update 성공 후 ① 재고복원(ONLINE_SALE_CANCEL) ② 원래 COMPLETED였던 건만 net(`-(total-discount)`) 음수 역분개(sourceType=SALE_CANCEL, paymentMethod 폴백 'card', cogs:0). 둘 다 try/catch 경고만.
- `src/lib/cafe24/webhook.ts:864-872` (`handleOrderRefunded`) — 기존 역분개(L823-838) 미변경. 전체환불(`!isPartial`)일 때만 재고복원(ONLINE_REFUND) 추가. try/catch 경고만.

### C. AI Sync
- `src/lib/ai/schema.ts:30` reference_type에 ONLINE_SALE_CANCEL·ONLINE_REFUND(+CREDIT_CANCEL 명시) 추가.
- `src/lib/ai/schema.ts:68` 취소 BUSINESS_RULES에 #48 연동 규칙 1줄.
- `src/lib/ai/tools.ts:742` cancel_sales_order description에 발송완료 차단·미발송 삭제 보강.

## 비가역 포인트 (집중 검증 요청)
- **가드 실행순서**: 양 cancel 함수에서 `voidShipmentsForOrder`가 try 본문 **최상단**(재고복원 for문·포인트·역분개·status보다 먼저). blocked일 때 데이터 무변경. 부분복원 후 차단 시 오염 가능성 없음.
- **shipment 물리삭제 비가역**: 삭제는 SHIPPED/DELIVERED 제외 가드(some())를 통과한 뒤에만 delete 실행.
- **멱등키 정확도**: 재고복원 reference_id=item.id(차감 ONLINE_SALE와 동일 키로 존재여부 판정·refType으로 이중복원 차단). 역분개는 createSaleJournal 내부 source_id=order.id 의존.
- **역분개 부호/규약**: 카페24 취소 net=total_amount−discount_amount, sourceType=SALE_CANCEL. 환불 핸들러 기존 역분개는 미변경(중복 없음 확인 요망).

## Open Questions
- `createSaleJournal` 내부 accounting_period_closes 마감기간 가드 의존 — 마감월 취소 webhook 시 역분개 충돌 가능성(브리프 L80, 확인 요청).

## Out of Scope (BUILD-LOG Known Gaps)
- 부분환불(PARTIALLY_REFUNDED) 수량단위 재고복원 — 전체환불만.
- 카페24 취소/환불 시 연결 shipment void — Phase 2 backfill 후.
- 카드 PG 취소 — 시스템 외부.
