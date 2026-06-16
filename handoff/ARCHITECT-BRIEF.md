# Architect Brief — #14 Step 2: 과거 카페24 주문 인플레이스 백필

## Goal
이미 동기화된 과거 `sales_orders`(channel='ONLINE') 중 깨진 건(품목 0종 / memo='Delivery: undefined' / 받는분 빈값)을 **삭제 없이** cafe24 재조회로 memo·recipient_*·sales_order_items를 인플레이스 보정한다. FK(customer_id·환불·분개) 무손상.

## 잠근 결정 (LOCKED)

### 1. 공유 함수 추출 (중복 금지 — 최우선)
webhook.ts `handleOrderCreated`의 sales_order_items 생성 블록(현 L357~448, try 전체)을 **shared 함수로 추출**해서 webhook과 백필이 같이 쓴다.
- 신규 export 예: `export async function syncCafe24OrderItems(salesOrderId: string, items: any[], orderNoForLog: string): Promise<void>`
  - 내부: 멱등 가드(기존 items 있으면 skip) + 매핑 일괄조회(cafe24_product_map→product_id, products.name) + rows 빌드 + insert + 42703 minimal 재시도 + 실패 시 `logSyncEvent('order_items_error', ...)`. **현 블록의 바이트 동작을 그대로 옮긴다(회귀 0).**
  - `handleOrderCreated`는 이 함수 호출로 교체(인라인 블록 삭제). 호출부 동작 동일해야 함.
- memo·recipient: `extractRecipientInfo`(L181, 이미 export·"백필 공용")는 그대로 재사용. memo 문자열 규칙(L314~316)은 백필에서도 동일 재현(또는 작은 헬퍼 `buildDeliveryMemo(recipient)` 추출 — 선택, 2곳뿐이라 인라인 재현도 허용).

### 2. 트리거 = CRON_SECRET 보호 admin GET 라우트
- 신규 `src/app/api/cafe24/backfill/route.ts`. **인증 = `Authorization: Bearer ${CRON_SECRET}`** (sync-orders/route.ts L55~63 패턴 그대로 복제: secret 미설정 500, 불일치 401). 1회성 운영 트리거 + 앱 컨텍스트(getValidAccessToken DB 토큰) 필요 → 서버 라우트가 자연스럽다.
- 쿼리 파라미터: `?limit=N`(기본 50, 최대 200 cap). 멱등이므로 반복 호출로 점진 처리.
- getValidAccessToken으로 토큰 주입(webhook L212~222 패턴) → `new Cafe24Client(...)` → `client.getOrder(cafe24_order_id)`(embed=items,buyer,receivers 이미 내장).

### 3. 대상 선정 (서버측 쿼리)
`sales_orders` where `channel='ONLINE'` AND `cafe24_order_id IS NOT NULL` AND (sales_order_items 0건 OR `memo LIKE 'Delivery: undefined%'` OR `recipient_name IS NULL`).
- 후보 id+cafe24_order_id+memo+status를 limit으로 페치 → 건별 items 존재여부 확인 → 보정 필요 판정. 1회성 소량이라 건당 getOrder 불가피(허용).

### 4. 보정 범위 (무손상 원칙)
건별로:
- cafe24 재조회 성공 시 `extractRecipientInfo` → **memo + recipient_* 5필드 update**(깨진 값일 때만 갱신; 이미 정상이면 skip = 멱등).
- sales_order_items 0건이면 `syncCafe24OrderItems` 호출로 생성. 이미 있으면 내부 멱등 가드가 skip.
- **건드리지 않음**: customer_id, total_amount/discount_amount, buyer_name/phone, status, ordered_at, 환불/분개 레코드. **재고 차감·movements·point_history 없음**(범위 밖, Step 1과 동일).
- recipient_* update는 42703(083 미적용) 방어 재시도 패턴(L326~343) 동일 적용.

### 5. 안전
- 상태 제외: `status IN ('CANCELLED','REFUNDED','PARTIALLY_REFUNDED')` 건은 **대상 제외**(쿼리 술어 NOT IN).
- cafe24 getOrder 실패(토큰 만료·삭제주문·네트워크): 해당 건 **로깅 후 continue**(중단 금지). 토큰 자체 null이면 전체 401 응답 후 종료(처리 0).
- 건별 try/catch — 한 건 실패가 배치 전체를 멈추지 않음. 실패는 카운트 누적(+ logSyncEvent).
- 순차 처리(for-of await). rate-limit 대비 과한 동시성 금지.

### 6. 결과 리포트
라우트 응답 JSON: `{ scanned, fixedMemo, fixedRecipient, fixedItems, skipped, failed, failedOrderNos? }` 카운트 반환. 실패 cafe24_order_id 일부만(과다 출력 금지).

### 7. AI Sync / 마이그
- **schema.ts / tools.ts 무변경**(읽기·보정 라우트, 새 테이블·enum·에이전트 도구 없음). CLAUDE.md 매트릭스 → 해당 없음 확인.
- **마이그레이션 없음**. 083/080/082 기존. 미적용 시 42703 폴백 degrade.

## Build Order
1. webhook.ts: item-생성 블록 → `syncCafe24OrderItems(salesOrderId, items, orderNoForLog)` export 추출 + `handleOrderCreated` 호출로 교체(회귀 0 확인).
2. (선택) `buildDeliveryMemo(recipient)` 헬퍼 추출 — 안 하면 백필 memo 규칙 인라인 재현.
3. 신규 `src/app/api/cafe24/backfill/route.ts`: CRON_SECRET 가드 + 토큰 주입 + 대상 쿼리 + for-of 보정 + 카운트 응답.
4. npm run build.

## Out of Scope (→ BUILD-LOG Known Gaps if surfaces)
- 재고/movements/point_history 생성·역차감.
- total_amount 0원 백필(forward-only 결정 유지).
- UI 버튼 트리거(라우트만; 운영은 curl/Bearer 호출).
- delivery_type/receipt_status 정밀화(DB DEFAULT 수용).
- legacy_purchases / b2b 보정.

## Acceptance
- 추출된 `syncCafe24OrderItems`를 webhook이 호출, 기존 신규주문 품목생성 무회귀(로직 바이트 동일).
- backfill 라우트: CRON_SECRET 없거나 틀리면 500/401. 정상 호출 시 대상만(취소/환불 제외) memo·recipient·items 인플레이스 보정, customer_id/금액/분개 무변경.
- 멱등: 재호출 시 이미 정상인 건 skip(중복 품목·중복 update 없음).
- cafe24 1건 실패가 배치를 멈추지 않고 failed로 집계.
- npm run build 에러/경고 0.
