# Review Request — #48 Phase 2b: 카페24 취소 시 연결배송 처리 + 부분환불 정책 명문화
Date: 2026-06-19
Ready for Review: YES

## 빌드 요약
카페24 취소 webhook(사후통보) 수신 시 2a backfill로 연결된 shipment 정리: 미발송(PENDING/PRINTED)만 삭제, 발송완료(SHIPPED/DELIVERED)는 보존+경고로그. **배송처리만 추가** — Phase 1 재고복원·역분개 무수정. 부분환불 자동복원 영구불가 명문화.

## Files Changed
- `src/lib/shipping-actions.ts:305-360` — 신규 export `voidUnshippedShipmentsForOrder(db, {salesOrderId, cafe24OrderId?})`. sales_order_id 우선·cafe24_order_id 폴백 조회(voidShipmentsForOrder 패턴 복제). SHIPPED/DELIVERED 보존(preservedIds), PENDING/PRINTED만 delete().in('id', unshippedIds). 0건 no-op·멱등. **차단개념 없음**(Phase 1과 핵심 차이).
- `src/lib/cafe24/webhook.ts` (handleOrderCancelled) — select에 `cafe24_order_id` 추가. 재고복원①·역분개② **이후** 별도 try블록 ③에서 위 함수 1회 호출, preservedShipped>0 시 `order_cancelled_shipment_preserved` 경고로그. 순환참조(shipping-actions.ts L7 → webhook.ts confirmCafe24OrderAsSale) 회피 위해 **동적 import**.
- `src/lib/cafe24/webhook.ts` (handleOrderRefunded L875 영역) — 부분환불 주석 강화(per-line 복원 영구불가·수동조정). 재고 skip 로직 **무변경**.
- `src/lib/ai/schema.ts` (BUSINESS_RULES) — 취소 webhook 배송정리 + 부분환불 수동조정 정책 2줄 추가.

## 집중 검증 요청 (브리프 "되돌릴 수 없음")
1. **shipments.delete() 안전성**: `unshippedIds` 필터가 정확히 PENDING/PRINTED만(=SHIPPED/DELIVERED 제외)인지 — shipping-actions.ts:351-354. 발송된 배송기록 비가역 소실 방지.
2. **Phase 1 무간섭**: 배송정리 ③이 restoreOnlineOrderInventory①/createSaleJournal② 중복호출·간섭 없는지(별도 try·이후 위치).
3. **순환참조 동적 import 타당성**: shipping-actions.ts가 webhook.ts(confirmCafe24OrderAsSale, L7)를 정적 import → webhook.ts→shipping-actions 정적 불가 판단. 빌드 0 error.
4. **멱등**: already-cancelled 가드(L774) 선행 + 대상 0건 no-op → 이중삭제·이중로그 없음.
5. **부분환불 재고 무변경**: 주석/schema만, 복원로직 추가 안 함 확인.

## 부분환불 UI 식별동선
**존재 확인** — SalesListTab.tsx에 PARTIALLY_REFUNDED 한글 라벨('부분환불', L86)·상태배지(L92)·필터 드롭다운(L1044) 이미 노출. 추가 UI 작업 없음(Known Gap 아님).

## Out of Scope (BUILD-LOG 기록)
- 전체환불(REFUNDED) webhook 시 연결배송 정리 — 본 스텝은 취소(cancelled)만.
- 부분환불 per-line 재고복원 자동화 — 데이터 부재로 영구 불가.
- 발송완료 후 취소 보존 shipment의 별도 status/플래그/대시보드 — 로그경고로만.
