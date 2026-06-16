# Architect Brief — #15 Step 2 (자사몰 과거주문 total_amount 백필)

## Goal
이미 동기화된 과거 카페24 주문(channel='ONLINE')의 total_amount를 cafe24 재조회 → cafe24OrderTotal 재계산 → 다르면 인플레이스 update. 네이버페이 포인트 등 누락 tender 보정.

## Build Order
- 신규 라우트 생성: `src/app/api/cafe24/backfill-amount/route.ts` (GET). 기존 `src/app/api/cafe24/backfill/route.ts`를 **복제 베이스**로 사용 — 가드/토큰/클라이언트 셋업 패턴 그대로.
- 재사용: `cafe24OrderTotal` from `@/lib/cafe24/types` (모든 tender 합), `Cafe24Client.getOrder`, `getValidAccessToken` from `@/lib/cafe24/token-store`.
- **가드(복제)**: CRON_SECRET 미설정→500, `Authorization !== Bearer ${CRON_SECRET}`→401. 토큰 null→401. Cafe24Client setTokens 동일.
- **쿼리파라미터**: `?offset`(기본 0), `?limit`(기본 20, **최대 50**). `Math.min(parsed, 50)`.
- **대상 SELECT**: `sales_orders` where `channel='ONLINE'` AND `cafe24_order_id NOT NULL` AND `status NOT IN (CANCELLED,REFUNDED,PARTIALLY_REFUNDED)`. select `id, cafe24_order_id, total_amount`. `.order('ordered_at', { ascending: false })` 안정 정렬. `.range(offset, offset+limit-1)` (offset 페이지네이션).
  - Flag: 기존 /backfill의 `.or(recipient_name.is.null,...)` 깨짐필터는 **쓰지 마라** — 금액 틀린 건은 recipient/memo 정상일 수 있다. 전체 대상.
- **건별 처리 루프**: scanned++ → `client.getOrder(cafe24_order_id)`. 실패(success=false/data 없음, 삭제주문) → failed++, failedOrderNos push(상한 20), `continue`(중단 금지). 성공 → `const newTotal = cafe24OrderTotal(order)`.
  - `newTotal !== current total_amount` → `update({ total_amount: newTotal }).eq('id', row.id)`. **total_amount만** update. update 에러 시 failed++.
  - 같으면 unchanged++ (멱등 skip).
- 전체 try/catch로 건별 실패 격리 (기존 라우트 catch 패턴 동일).
- **반환 JSON**: `{ scanned, updated, unchanged, failed, failedOrderNos?, nextOffset?, done }`.
  - `nextOffset` = `scanned === limit ? offset + limit : undefined` (스캔이 limit 꽉 찼으면 다음 페이지 존재).
  - `done` = `scanned < limit` (마지막 페이지).
- 라우트 상단 주석: 목적·호출법(`GET /api/cafe24/backfill-amount?offset=0&limit=20`, Bearer CRON_SECRET)·멱등·회계 무조정(Known Gap) 명시.

## Out of Scope (Known Gap → BUILD-LOG)
- **회계분개 무조정**: total_amount 바뀌어도 createSaleJournal 재게시/조정 안 함. journal_entries 불일치는 별도 처리.
- schema.ts / tools.ts / 마이그레이션 **무변경** — DB 컬럼·enum·로직 변화 없음(읽기+기존 컬럼 update만). 확인하고 손대지 마라.

## Acceptance
- `npm run build` 통과.
- 라우트가 offset/limit으로 페이지네이션, getOrder 재조회, cafe24OrderTotal 재계산, 다를 때만 total_amount update, 같으면 unchanged.
- 건별 실패가 배치를 멈추지 않음. 토큰 null·인증 실패 가드 동작.
- 취소/환불 제외. total_amount 외 컬럼(discount/payment_method/recipient/items/customer/status) 무손상.

## 운영 메모 (배포·실행)
- Vercel 자동배포 매우 지연 — 배포 Ready 확인 후 실행.
- 운영 호출 시 CRON_SECRET·prod URL 필요(오케스트레이터 보유). offset을 올려가며 또는 nextOffset 루프로 전량 처리.
