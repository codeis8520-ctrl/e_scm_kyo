# Review Request — 택배관리 일괄 배송완료 + 죽은 추적 UI 정리
Date: 2026-06-19
Ready for Review: YES

## Files Changed
- src/lib/shipping-actions.ts:309-360 — 신규 `bulkUpdateShipmentStatus(shipmentIds, 'DELIVERED')`. requireSession 가드 → ids dedup+빈배열 가드 → status!=='DELIVERED' 거부 → 행 루프(조회→이미 DELIVERED skip→update DELIVERED→sales_order_id 있으면 syncReceiptStatusFromShipment) → revalidatePath('/pos','/shipping') → {success,updated,skipped}. 행단위 try/catch 격리. 알림톡 미발송.
- src/app/(dashboard)/shipping/page.tsx:5 — import에 bulkUpdateShipmentStatus 추가(updateShipment는 L696/L1023 잔존 사용으로 유지).
- src/app/(dashboard)/shipping/page.tsx:709-718 — handleBulkDeliver(confirm→액션 호출→alert→fetchShipments+선택해제). 기존 trackOne 함수 자리 대체.
- src/app/(dashboard)/shipping/page.tsx:1512-1520 — 액션 바에 "선택건 배송완료 (N)" 버튼(disabled when size===0).
- src/app/(dashboard)/shipping/page.tsx:274 — trackingId state 제거.
- src/app/(dashboard)/shipping/page.tsx:~1597 — 행별 '추적' 버튼 블록 제거.

## 자가검증
- `npm run build` → ✓ Compiled successfully in 7.0s, 0 error.
- grep `trackOne|trackingId|setTrackingId` (shipping/page.tsx) → No matches.
- 빌드 출력에 `/api/shipping/track`·`/api/shipping/track-sync` 라우트 잔존 확인(보존).
- updateShipment import 유지 근거: trackOne 외 handleEdit(L696)·송장저장(L1023)에서 사용.

## Open Questions
- 없음.

## Out of Scope (logged in BUILD-LOG)
- 범용 임의상태 일괄변경(PRINTED/SHIPPED/PENDING) — DELIVERED 전용.
- 지점 RBAC 서버측 강제 — 기존 화면접근 권한에 위임.
- DELIVERED 일괄 시 알림톡 발송 — 의도적 미발송.
