# BUILD-LOG — #48 단일원장 정합

## ✅ Phase 1 — 취소·환불 ↔ 택배/재고/분개 연동 봉합 (배포완료)
- 커밋 `c25e7e1` push 완료(2026-06-19). Richard 리뷰 통과.
- A. STORE 취소↔택배: `voidShipmentsForOrder(db,{salesOrderId,cafe24OrderId,reason})`(shipping-actions.ts L254). sales_order_id 다건조회→0건이면 cafe24_order_id 폴백. SHIPPED/DELIVERED 1건이라도 있으면 {blocked:true} 무변경, 그 외 .delete().in('id',ids). cancelSalesOrder·cancelCreditOrder 양쪽 try 진입 직후 호출, blocked면 환불유도 반환.
- B. 카페24 webhook: `restoreOnlineOrderInventory(sb,salesOrderId,refType)`(online-inventory.ts). ONLINE_SALE movement 존재 품목만 복원(컷오프 2026-06-17 자동필터). handleOrderCancelled 재고복원(ONLINE_SALE_CANCEL)+COMPLETED 역분개. handleOrderRefunded 전체환불만 재고복원(ONLINE_REFUND).
- C. AI Sync: schema.ts reference_type/BUSINESS_RULES, tools.ts cancel_sales_order description.
- Phase 1 Known Gaps(여전히 열림): 부분환불 수량단위 재고복원 / 카페24 취소 시 연결 shipment void → **Phase 2b에서 처리/결정**.

---

## 🎯 Phase 2a — 과거 NULL링크 backfill + 1:1 UNIQUE 강제 + 2중배송 가드 (현재)

### 과제
shipments↔sales_orders 1:1 원장 정합 완성. (1) 과거 카페24 NULL링크(~86건)를 cafe24_order_id 정확매칭으로 sales_order_id 연결, (2) backfill 후 sales_order_id 부분 UNIQUE 강제(마이그 094), (3) 직접배송입력 STORE 경로 2중배송 앱가드.

### Locked Decisions (Project Owner 사인오프)
1. **1전표=1발송지**(분할배송 불가). Phase 1의 "1전표:N배송 허용"은 **철회**. sales_order_id 부분 UNIQUE 강제.
2. 과거 NULL링크 = **전체 소급 backfill**. cafe24_order_id **정확매칭만**(휴리스틱 금지 — staged_posting/카페24제품매핑 교훈).
3. 카페24 재고복원 컷오프 = 2026-06-17(Phase 1 확정 유지).
4. **backfill·UNIQUE 마이그는 Arch(오케스트레이터)가 DB에 직접 적용**. Bob은 backfill 라우트 코드 + 마이그 SQL 파일 + 앱 가드만 작성. 적용 전 Arch가 읽기전용 점검 SQL 실행.
5. 전표당 shipment 2건 이상 중복 발견 시 정리정책 = 092 패턴 재사용(DELIVERED>SHIPPED>PRINTED>PENDING → tracking有 → created_at 최신 1건 유지, 나머지 삭제). **단 발송완료(SHIPPED/DELIVERED) 2건 동시 존재 시 자동삭제 금지 → Arch 수동검수**.

### 상태
- 2026-06-19 브리프 작성 → Bob 빌드 완료, Richard 리뷰 대기.

### Bob 빌드 결과 (2026-06-19)
- **A. backfill 라우트** (신규) `src/app/api/cafe24/backfill-shipment-link/route.ts` — GET, CRON_SECRET Bearer 인증, `?dry=1` 기본/`?dry=0` 실제UPDATE/`?limit`(기본100·최대500). 대상=shipments where sales_order_id IS NULL AND cafe24_order_id NOT NULL. 각 행 cafe24_order_id로 sales_orders 조회(.select 배열, single 금지): 1건만 매칭→연결, 0건 unmatched_no_order, 다건 unmatched_ambiguous. 2중연결 가드(이미 그 sales_order_id에 다른 shipment 있으면 would_duplicate skip). 응답 {dry,scanned,matched,updated,unmatched_no_order,unmatched_ambiguous,would_duplicate,samples}. 건별 try/catch·멱등.
- **B. 마이그 094** (신규 SQL, Arch 적용) `supabase/migrations/094_shipments_sales_order_unique.sql` — 092 패턴 복제, PARTITION BY **sales_order_id**(092의 cafe24_order_id 아님). 중복정리 DELETE→부분 UNIQUE uq_shipments_sales_order_id(WHERE sales_order_id IS NOT NULL). 헤더에 선행조건(backfill 완료+발송완료 2건 동시 점검) 명시.
- **C. STORE 2중배송 가드** `src/lib/shipping-actions.ts` `createShipment` — salesOrderId 확정 후·insert 전 단일 위치에 가드(STORE/CAFE24 공통). 이미 그 전표에 배송 있으면 '이미 배송이 추가된 전표입니다(전표당 1배송).' 차단. 23505 핸들러에 sales_order UNIQUE 케이스 메시지 분기 추가. convertOrderToParcel 무수정(멱등).
- **D. AI Sync** `src/lib/ai/schema.ts` shipments 섹션에 의미주석 1줄(sales_order_id 부분 UNIQUE = 전표당 1건, 1:1, backfill 정확매칭). 신규 컬럼/enum/도구 없음 → DB_SCHEMA 구조·tools.ts 무변경.
- `npm run build` 0 error. 신규 라우트 `/api/cafe24/backfill-shipment-link` 등록 확인.
- Known Gaps: 없음(브리프 Out of Scope는 Phase 2b로 이미 명시됨).

### Phase 2b (다음, 범위 밖)
- 카페24 취소/환불 시 연결 shipment void(backfill로 NULL링크 해소 후 가능. Phase 1 voidShipmentsForOrder 재사용).
- 부분환불(PARTIALLY_REFUNDED) 재고복원 — webhook은 refundAmount(총액)만 있고 품목/수량 데이터 없음 → **per-line 복원 불가, 영구 범위 밖 확정**(수동 처리 정책). Phase 2b에서 최종 명문화.

## Known Gaps (열린 채)
- 부분환불 per-line 재고복원 미지원(데이터 부재 — 영구).
- Phase 3 역방향 정식화 syncShipmentFromReceipt(단건 수령처리→shipment) 미착수.
