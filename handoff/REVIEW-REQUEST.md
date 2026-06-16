# Review Request — #14 Step 2: 과거 카페24 주문 인플레이스 백필
Date: 2026-06-16
Ready for Review: YES

## Files Changed

### Refactor (회귀 0 목표)
- **src/lib/cafe24/webhook.ts:200-307** — 신규 `export async function syncCafe24OrderItems(salesOrderId, items, orderNoForLog)`. 기존 `handleOrderCreated`의 sales_order_items 생성 블록(구 L357~448)을 바이트 동작 그대로 함수로 이관(멱등 가드·매핑 일괄조회·rows 빌드·42703 minimal 재시도·`order_items_error` 로깅). 단, `logSyncEvent` data 인자는 `cafe24Order` 전체→`{salesOrderId,...}`로 대체(시그니처에 cafe24Order 없음 — Arch가 잠근 시그니처의 불가피한 결과, 기능 동작 동일).
- **src/lib/cafe24/webhook.ts:454-457** — `handleOrderCreated` 인라인 블록 삭제 → `await syncCafe24OrderItems(newOrder.id, cafe24Order.items ?? [], orderNo.toString())` 호출로 교체.

### 신규 라우트
- **src/app/api/cafe24/backfill/route.ts** (전체 신규) — GET, CRON_SECRET Bearer 가드(미설정 500 / 불일치 401, sync-orders 패턴 복제). `?limit`(기본 50, 최대 200). `getValidAccessToken` null이면 401. 대상 쿼리(channel='ONLINE' AND cafe24_order_id NOT NULL AND status NOT IN 취소/환불). for-of 순차: 깨짐 판정(memo undefined/null·recipient_name null·items 0) → 정상이면 skip(getOrder 없이) → `getOrder` → `extractRecipientInfo` → memo+recipient_* 5필드 update(42703 degrade) + 품목 0건이면 `syncCafe24OrderItems`. 건별 try/catch, getOrder 실패=failed+continue. 응답 `{scanned,fixedMemo,fixedRecipient,fixedItems,skipped,failed,failedOrderNos?}`.

## Open Questions / 설계 판정 (리뷰 요청)
1. **"items 0건" 대상 선정** — 브리프 §3은 `.or()`에 "items 0건"을 포함했으나 PostgREST는 자식 0건 anti-join을 `.or()`로 표현 불가. 따라서 임베드 `sales_order_items(count)`로 한 페이지(limit)를 받아 **건별 판정**으로 구현. `limit`은 스캔 페이지 캡 의미(멱등 → 반복 호출로 점진). 이미 정상인 건은 `getOrder` 호출 없이 skip → rate-limit·재호출 비용 안전. 이 해석이 의도와 맞는지 확인 요청.
2. **`order('ordered_at', desc)`** — 페이지네이션 안정성 위해 정렬 추가(최신 주문 우선 보정). 브리프 미명시, 무해 판단.

## Out of Scope (logged in BUILD-LOG)
- ESLint `no-explicit-any` (webhook.ts 전반·신규 라우트 2곳) — 파일 기존 관행 동일, `npm run build` 클린. 신규 회귀 아님.
- 재고/movements/point_history, total_amount 0원 백필, UI 버튼 — 브리프 명시 범위 밖.
