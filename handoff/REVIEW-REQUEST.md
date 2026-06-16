# Review Request — Step 2 (자사몰 total_amount 백필 라우트)
Date: 2026-06-16
Ready for Review: YES

## Files Changed
- src/app/api/cafe24/backfill-amount/route.ts:1-144 — 신규 GET 백필 라우트 전체.
  - L31-45 — 가드(CRON_SECRET 미설정 500 / Bearer 불일치 401) + offset/limit 파싱(limit Math.min 50, offset max 0).
  - L48-67 — getValidAccessToken null 401 + Cafe24Client setTokens (/backfill 복제).
  - L72-85 — 대상 SELECT: channel='ONLINE' AND cafe24_order_id NOT NULL AND status NOT IN (취소/환불), ordered_at desc + .range(offset, offset+limit-1). 깨짐필터 미사용(전체).
  - L94-130 — 건별 루프: getOrder → cafe24OrderTotal 재계산 → 다르면 total_amount만 update(updated), 같으면 unchanged, getOrder실패/update에러 → failed+continue.
  - L132-143 — 반환 JSON: scanned/updated/unchanged/failed + failedOrderNos? + nextOffset?(scanned===limit) + done(scanned<limit).

## Open Questions
- 없음. 브리프 사양 그대로 구현.

## Out of Scope (logged in BUILD-LOG)
- 회계분개 무조정 (createSaleJournal 재게시 안 함) — Known Gap.
- schema.ts / tools.ts / 마이그레이션 무변경 (읽기 + 기존 total_amount 컬럼 update만).

## Build
- npm run build ✓ — 에러/경고 0. /api/cafe24/backfill-amount ƒ(dynamic) 컴파일 확인.
