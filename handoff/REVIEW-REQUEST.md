# Review Request — #48 Phase 2a
Date: 2026-06-19
Ready for Review: YES

빌드: `npm run build` → 0 error. 신규 라우트 `/api/cafe24/backfill-shipment-link` 등록 확인.

## Files Changed
- `src/app/api/cafe24/backfill-shipment-link/route.ts` (신규, 전체) — NULL링크 backfill 라우트. CRON_SECRET Bearer 인증, `?dry=1` 기본/`?dry=0` UPDATE, `?limit`(기본100·최대500). cafe24_order_id 정확매칭 1건일 때만 shipments.sales_order_id 연결. 0건/다건/2중연결(would_duplicate) skip. 휴리스틱 없음. 건별 try/catch·멱등.
- `supabase/migrations/094_shipments_sales_order_unique.sql` (신규, 전체 — Arch 적용) — 092 패턴 복제, PARTITION BY **sales_order_id**. 중복정리 DELETE → 부분 UNIQUE uq_shipments_sales_order_id(WHERE sales_order_id IS NOT NULL).
- `src/lib/shipping-actions.ts:125-155` — createShipment 가드: salesOrderId 확정 후·insert 전 단일 위치에 '전표당 1배송' 차단 추가. 23505 핸들러에 sales_order UNIQUE 메시지 분기 추가.
- `src/lib/ai/schema.ts:85` — shipments 의미주석 1줄(sales_order_id 부분 UNIQUE = 전표당 1건, 1:1, backfill 정확매칭).

## 집중 검증 포인트 (브리프 "되돌릴 수 없음 / Richard 필수리뷰")
1. **backfill 매칭키** = cafe24_order_id 정확매칭만인지(sales_order_id 오인 시 대량오염). 다건매칭 skip(unmatched_ambiguous) 확인. dry=1 기본값 확인.
2. **마이그 094 PARTITION 컬럼** = sales_order_id 인지(092 복붙 시 cafe24_order_id로 안 바뀌면 잘못된 행 삭제). 이 한 줄 집중.
3. **createShipment 가드 위치** = salesOrderId 확정 후·insert 전 단일 위치인지(CAFE24 confirm 분기와 순서 충돌 없는지).
4. backfill 라우트 인증(CRON_SECRET) 누락 없는지.

## Open Questions
- 없음. 브리프대로 빌드.

## Out of Scope (logged in BUILD-LOG)
- 비가역 작업(backfill UPDATE·마이그 094 적용)은 Arch가 직접 DB 적용. Bob은 코드/SQL 파일만 작성, DB 미적용.
- Phase 2b 항목(카페24 취소 시 shipment void, 부분환불 재고복원)은 범위 밖.
