# BUILD-LOG — #48 단일원장 정합

## ✅ Phase 1 — 취소·환불 ↔ 택배/재고/분개 연동 봉합 (배포완료)
- 커밋 `c25e7e1` push 완료(2026-06-19). Richard 리뷰 통과.
- A. STORE 취소↔택배: `voidShipmentsForOrder(db,{salesOrderId,cafe24OrderId,reason})`(shipping-actions.ts L254). sales_order_id 다건조회→0건이면 cafe24_order_id 폴백. SHIPPED/DELIVERED 1건이라도 있으면 {blocked:true} 무변경, 그 외 .delete().in('id',ids). cancelSalesOrder·cancelCreditOrder 양쪽 try 진입 직후 호출, blocked면 환불유도 반환.
- B. 카페24 webhook: `restoreOnlineOrderInventory(sb,salesOrderId,refType)`(online-inventory.ts). ONLINE_SALE movement 존재 품목만 복원(컷오프 2026-06-17 자동필터). handleOrderCancelled 재고복원(ONLINE_SALE_CANCEL)+COMPLETED 역분개. handleOrderRefunded 전체환불만 재고복원(ONLINE_REFUND).
- C. AI Sync: schema.ts reference_type/BUSINESS_RULES, tools.ts cancel_sales_order description.
- Phase 1 Known Gaps(여전히 열림): 부분환불 수량단위 재고복원 / 카페24 취소 시 연결 shipment void → **Phase 2b에서 처리/결정**.

---

## ✅ Phase 2a — 과거 NULL링크 backfill + 1:1 UNIQUE 강제 + 2중배송 가드 (배포완료)

### 과제
shipments↔sales_orders 1:1 원장 정합 완성. (1) 과거 카페24 NULL링크(~86건)를 cafe24_order_id 정확매칭으로 sales_order_id 연결, (2) backfill 후 sales_order_id 부분 UNIQUE 강제(마이그 094), (3) 직접배송입력 STORE 경로 2중배송 앱가드.

### Locked Decisions (Project Owner 사인오프)
1. **1전표=1발송지**(분할배송 불가). Phase 1의 "1전표:N배송 허용"은 **철회**. sales_order_id 부분 UNIQUE 강제.
2. 과거 NULL링크 = **전체 소급 backfill**. cafe24_order_id **정확매칭만**(휴리스틱 금지 — staged_posting/카페24제품매핑 교훈).
3. 카페24 재고복원 컷오프 = 2026-06-17(Phase 1 확정 유지).
4. **backfill·UNIQUE 마이그는 Arch(오케스트레이터)가 DB에 직접 적용**. Bob은 backfill 라우트 코드 + 마이그 SQL 파일 + 앱 가드만 작성. 적용 전 Arch가 읽기전용 점검 SQL 실행.
5. 전표당 shipment 2건 이상 중복 발견 시 정리정책 = 092 패턴 재사용(DELIVERED>SHIPPED>PRINTED>PENDING → tracking有 → created_at 최신 1건 유지, 나머지 삭제). **단 발송완료(SHIPPED/DELIVERED) 2건 동시 존재 시 자동삭제 금지 → Arch 수동검수**.

### 상태
- 2026-06-19 배포완료. Richard 리뷰 통과. 코드배포 + DB적용 끝남(backfill 74건 sales_order_id 연결, 마이그094 UNIQUE 적용).

### Bob 빌드 결과 (2026-06-19)
- **A. backfill 라우트** (신규) `src/app/api/cafe24/backfill-shipment-link/route.ts` — GET, CRON_SECRET Bearer 인증, `?dry=1` 기본/`?dry=0` 실제UPDATE/`?limit`(기본100·최대500). 대상=shipments where sales_order_id IS NULL AND cafe24_order_id NOT NULL. 각 행 cafe24_order_id로 sales_orders 조회(.select 배열, single 금지): 1건만 매칭→연결, 0건 unmatched_no_order, 다건 unmatched_ambiguous. 2중연결 가드(이미 그 sales_order_id에 다른 shipment 있으면 would_duplicate skip). 응답 {dry,scanned,matched,updated,unmatched_no_order,unmatched_ambiguous,would_duplicate,samples}. 건별 try/catch·멱등.
- **B. 마이그 094** (신규 SQL, Arch 적용) `supabase/migrations/094_shipments_sales_order_unique.sql` — 092 패턴 복제, PARTITION BY **sales_order_id**(092의 cafe24_order_id 아님). 중복정리 DELETE→부분 UNIQUE uq_shipments_sales_order_id(WHERE sales_order_id IS NOT NULL). 헤더에 선행조건(backfill 완료+발송완료 2건 동시 점검) 명시.
- **C. STORE 2중배송 가드** `src/lib/shipping-actions.ts` `createShipment` — salesOrderId 확정 후·insert 전 단일 위치에 가드(STORE/CAFE24 공통). 이미 그 전표에 배송 있으면 '이미 배송이 추가된 전표입니다(전표당 1배송).' 차단. 23505 핸들러에 sales_order UNIQUE 케이스 메시지 분기 추가. convertOrderToParcel 무수정(멱등).
- **D. AI Sync** `src/lib/ai/schema.ts` shipments 섹션에 의미주석 1줄(sales_order_id 부분 UNIQUE = 전표당 1건, 1:1, backfill 정확매칭). 신규 컬럼/enum/도구 없음 → DB_SCHEMA 구조·tools.ts 무변경.
- `npm run build` 0 error. 신규 라우트 `/api/cafe24/backfill-shipment-link` 등록 확인.
- Known Gaps: 없음(브리프 Out of Scope는 Phase 2b로 이미 명시됨).

## 🎯 Phase 2b — 카페24 취소 시 연결배송 처리 + 부분환불 정책 명문화 (현재)

### 과제
2a backfill로 sales_order_id가 채워진 연결 shipment를, 카페24 취소 webhook(사후통보) 수신 시 정리. 미발송분 삭제·발송완료분 보존+경고. 부분환불 자동복원 영구불가 명문화. **배송처리만 추가** — Phase 1 재고복원·역분개 무수정.

### Locked Decisions
1. webhook=사후통보 → "취소차단" 없음. 부분처리(미발송 삭제, 발송완료 보존). Phase 1 voidShipmentsForOrder(차단형)와 별도 함수 voidUnshippedShipmentsForOrder 신설.
2. 발송완료(SHIPPED/DELIVERED) 배송 = 삭제 금지·보존 + logSyncEvent 경고(운영 수동확인). status 플래그/마이그 신설 안 함.
3. 부분환불(PARTIALLY_REFUNDED) per-line 재고복원 = **영구 자동화 제외**(webhook refund_price 총액만, 품목/수량 부재). 수동 재고조정(InventoryModal) 정책 — 주석·schema·UI동선으로 명문화.
4. 환불(REFUNDED) webhook 배송정리는 범위 밖(취소만). → Known Gap.

### 상태
- 2026-06-19 브리프 작성 → Bob 빌드 완료 → Richard 리뷰 대기.

### 빌드 내역 (Bob, 2026-06-19)
- **A. 신규 함수** `src/lib/shipping-actions.ts:305-360` `voidUnshippedShipmentsForOrder(db, {salesOrderId, cafe24OrderId?})`. voidShipmentsForOrder 조회패턴 복제(sales_order_id 우선·cafe24_order_id 폴백, select id,status). SHIPPED/DELIVERED=preservedIds 보존, 그 외(PENDING/PRINTED)=unshippedIds 삭제. 0건 no-op. 차단개념 없음(부분처리). {deleted, preservedShipped, preservedIds} 반환.
- **B. handleOrderCancelled** `src/lib/cafe24/webhook.ts`: select에 `cafe24_order_id` 추가. 재고복원①·역분개② 블록 **이후** 별도 try블록 ③에서 voidUnshippedShipmentsForOrder 1회 호출. preservedShipped>0이면 `order_cancelled_shipment_preserved` 경고로그. **동적 import**(shipping-actions↔webhook 순환참조: shipping-actions.ts L7 confirmCafe24OrderAsSale import 확인 → 정적 불가). already-cancelled 가드 선행 그대로(멱등).
- **C-1. 부분환불 주석 강화** `webhook.ts` L875 영역: "refund_price 총액만·품목/수량 부재 → per-line 자동복원 영구 불가, InventoryModal 수동조정" 명문화. 재고복원 skip 로직 무변경.
- **C-2. schema.ts BUSINESS_RULES**: 취소 webhook 배송정리(미발송삭제/발송완료보존+경고) + 부분환불 수동조정 정책 2줄 추가.
- **C-3. UI 식별동선 점검**: SalesListTab.tsx에 PARTIALLY_REFUNDED **이미 노출** — 한글 라벨 '부분환불'(L86), 상태배지 색(L92), 필터 드롭다운 옵션(L1044). **동선 존재 확인** → 추가 UI 작업 없음.
- **D. AI Sync**: schema.ts C-2에서 처리. 신규 컬럼/enum/도구 없음 → DB_SCHEMA 구조·tools.ts 무변경.
- `npm run build` 0 error(Compiled successfully 7.1s).

### Phase 2b (다음, 범위 밖)
- 카페24 취소/환불 시 연결 shipment void(backfill로 NULL링크 해소 후 가능. Phase 1 voidShipmentsForOrder 재사용).
- 부분환불(PARTIALLY_REFUNDED) 재고복원 — webhook은 refundAmount(총액)만 있고 품목/수량 데이터 없음 → **per-line 복원 불가, 영구 범위 밖 확정**(수동 처리 정책). Phase 2b에서 최종 명문화.

## Known Gaps (열린 채)
- 부분환불 per-line 재고복원 미지원(데이터 부재 — 영구).
- Phase 3 역방향 정식화 syncShipmentFromReceipt(단건 수령처리→shipment) 미착수.
