# Review Feedback — #14 Step 2: 과거 카페24 주문 인플레이스 백필
Date: 2026-06-16
Status: APPROVED

## Conditions
(없음)

## Verified

### Refactor — syncCafe24OrderItems 추출 (회귀 0)
- 추출 함수 본문은 구 인라인 블록(HEAD b8a4917)과 라인 동등: 멱등 가드, mapKey, productMap/productNameById
  일괄조회, rows 빌드, 42703 minimal 재시도(order_option/product_id drop), order_items_error 로깅 동일.
  치환은 newOrder.id→salesOrderId, orderNo.toString()→orderNoForLog 뿐.
- 유일한 동작 델타: logSyncEvent data 인자 cafe24Order→{salesOrderId,...}. 진단 로그 페이로드일 뿐
  주문 데이터 아님. Bob 명시. 수용.
- 호출부(handleOrderCreated): 인라인 블록 삭제 → await syncCafe24OrderItems(newOrder.id, cafe24Order.items ?? [], orderNo.toString())
  로 교체. 구 `const items = cafe24Order.items ?? []` 의미 보존. 포워드 webhook 경로 무회귀.

### backfill 라우트 — 인증
- CRON_SECRET 미설정 500 / Bearer 불일치 401 — sync-orders·refresh 라우트와 동일 패턴.
- getValidAccessToken null → 401. 확인.

### 대상 선정 / 깨짐 판정
- channel='ONLINE' AND cafe24_order_id NOT NULL AND status NOT IN (CANCELLED,REFUNDED,PARTIALLY_REFUNDED). 확인.
  (CAFE24_STATUS_TO_LOCAL은 PARTIALLY_REFUNDED를 산출 안 하지만 초과 제외는 무해 — 환불흐름이 별도로 셋팅하는 경우 방어.)
- "items 0건" anti-join을 .or()로 표현 불가 → 임베드 sales_order_items(count) + 건별 판정. 의도 부합.
- 이미 정상인 건(!needsMemoFix && !needsRecipientFix && !needsItems)은 getOrder 호출 없이 skip++.
  낭비 API/불필요 쓰기 없음. 확인.

### IN-PLACE 안전성 (critical)
- update 페이로드 = memo + recipient_name/phone/zipcode/address/address_detail 만. customer_id·total_amount·
  buyer_name/phone·status·환불·분개 미포함. 확인.
- 42703 degrade: recipient_* 5필드 제거 후 memo-only 재시도. 확인.
- delete 없음. 재고/movements/point_history 없음. syncCafe24OrderItems는 멱등(존재 시 skip)·insert-only.

### 실패 격리 / 멱등
- 건별 try/catch. getOrder 실패(success=false 또는 data 없음) → failed++ + continue, 배치 중단 없음.
- catch 블록도 failed++ + continue. failedOrderNos 최대 20개 캡.
- 재실행 안전(이미 보정된 건은 다음 호출에서 skip).

### 반환 형태
- {scanned, fixedMemo, fixedRecipient, fixedItems, skipped, failed, failedOrderNos?}. 확인.

### Edge — limit = 스캔 페이지 캡
- 정상 다수 페이지에서 fix 0건 + scanned>0 가능. 멱등·운영자 재호출 모델이므로 수용.
  무한루프/파괴적 동작 아님(매 호출 유한 limit, 쓰기는 깨진 건만).

### 스키마/스코프
- 마이그레이션·schema.ts·tools.ts 변경 없음 — DB_SCHEMA 동기화 불필요(신규 컬럼/테이블/enum 없음). 확인.
- npm run build 클린. /api/cafe24/backfill 동적 라우트 등록 확인.

## Escalate to Arch
(없음)

## Cleared
syncCafe24OrderItems 추출은 구 인라인 블록과 동작 동등(로그 페이로드 델타만)이며 포워드 webhook 무회귀.
backfill 라우트는 CRON_SECRET 가드·토큰 null 401·취소/환불 제외·정상건 무-getOrder skip·in-place 안전
(memo+recipient_*만, delete/재고/분개/금액/상태/주문자 무손상)·건별 실패 격리·멱등을 모두 충족. 배포 가능.
