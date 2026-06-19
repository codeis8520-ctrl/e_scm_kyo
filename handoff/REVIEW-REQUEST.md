# Review Request — 시간 기반 자동 배송완료 (track-sync 교체)
Date: 2026-06-19
Ready for Review: YES

## Files Changed
- src/app/api/shipping/track-sync/route.ts:1-75 — SweetTracker 추적 전면 제거, 시간기반 자동 배송완료로 같은 경로에서 로직 교체. SHIPPED+송장+updated_at<=now-N일 → DELIVERED update + (soId 있을 때) syncReceiptStatusFromShipment 연동. N = ?days > env SHIPPING_AUTODELIVER_DAYS > 3, limit 기본40·최대200, CRON_SECRET Bearer 가드 유지. 응답 {delivered, candidates, days, message(추정 명시)}.
- src/lib/ai/schema.ts:133,137,139 — AI Sync. SweetTracker→택배(송장) 정리 + 시간기반 자동완료 설명(updated_at N일·추정·외부API없음·멱등·편집시 시계리셋) 반영. DB_SCHEMA 컬럼 무변경.

## 검증 완료
- npm run build 0 error.
- track-sync 라우트 SWEETTRACKER/fetchDelivered/level===6 grep 0건.
- 쿼리 = status='SHIPPED' AND tracking_number NOT NULL AND updated_at<=now-N일, asc, limit.
- soId NULL(cafe24 미해소)건 = shipment.status만 DELIVERED, receipt 연동 skip.
- 멱등 = SHIPPED 필터로 DELIVERED/취소/반품 자동 제외.

## Open Questions
- N 기본값 3일 적정 여부(브리프 확정값). 운영 중 env로 조정 가능.
- limit 상한 200으로 상향(외부 쿼터 제거에 따른) — 단일 배치 처리량 의도대로인지.

## Out of Scope (logged in BUILD-LOG)
- shipped_at 컬럼 신설(updated_at 편집 리셋 — 의도된 동작).
- 과거 누적 SHIPPED 백필(크론 자연 흡수).
- 자동완료 시 고객 알림톡 발송(별도 결정).
- track/route.ts 개별 추적 라우트의 SweetTracker 잔재(이번 범위 아님 — track-sync만 교체).
