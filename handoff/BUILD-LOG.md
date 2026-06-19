# BUILD-LOG — 온라인몰 탭 표시 강화 배지 2종 (#50)

## 🔨 빌드완료 (리뷰대기) — 2026-06-19
감사문서(ONLINE-TAB-AUDIT.md) 결론대로 9요청 중 6개 기충족·1개 저가치 라벨링은 손대지 않고, "표시 강화" 신규 2개만 추가. route.ts·DB·마이그·AI schema.ts·tools.ts 전부 무변경(데이터 이미 존재).

### Bob 빌드 결과
- **(배지1) 품목 매핑상태 행 배지** `src/app/(dashboard)/shipping/page.tsx` 품목 셀 collapsed 영역(toggle 버튼 아래). 서버가 내려주는 `order.order_items[].product_code`/`mapped_name` 재사용. `unmapped = items.filter(i => i.product_code && !i.mapped_name).length` — product_code 없는 품목(매핑불가)은 기존 L1248~1249 규칙과 동일하게 제외. **unmapped>0일 때만** amber 배지 `⚠ 미매핑 N건`(매핑완료/0건/품목없음은 무표시 — 화면 소음 최소화, 감사 E3 권장안).
- **(배지2) 전표생성완료 배지** 같은 파일 마지막 컬럼. `order.already_added` 시 기존 `추가됨`(badge-info, 끝쪽 약함)을 emerald `✓ 전표생성완료`(bg-emerald-50)로 교체. 기존 행 흐림 `opacity-40`(L1172)은 **브리프 지시대로 유지**(감사 E1은 PO 결정사항이라 흐림 변경 안 함).

### 결정
- 미매핑 배지: 추가 쿼리/route 변경 0 — `product_code`(L1223 noCode 분기)·`mapped_name`(L1230)은 이미 페이로드에 존재 확인. 빌드 0 error.
- emerald 양성표시(매핑완료 배지)는 감사 E3 권장(미매핑만 경고)에 따라 의도적으로 미추가.

### Known Gap
- 없음. 보존영역(#25 staged·#48 1전표·필터·고객등록·중복플래그·매핑 데이터층) 전부 무회귀.

---

# BUILD-LOG — 수령상태 일괄변경 임의 대상 확장 (되돌리기 + 배송완료)

## 📋 결정 (브리프 갱신 — 빌드 전) — 2026-06-19
PO 추가지시 2건 반영해 ARCHITECT-BRIEF.md 갱신:
- (1) 드롭다운 최종옵션 '배송완료/수령(최종)'(internal=RECEIVED). 택배건=shipment DELIVERED 동기화→택배관리 '배송완료' 노출(역방향 정합), 오프라인=‘수령’. 기존 RECEIVED 분기가 이미 충족(추가코드 불요, 확인만).
- (2) 예정 3종 되돌림 시 receipt_date **보존(클리어 금지)** — PO #47 원칙.

#### Known Gap (불일치 — 추적)
- **단일 되돌리기 vs bulk 되돌리기 receipt_date 불일치**: 단일 `revertReceiptStatus`(SalesListTab.tsx L1948)·`revertItemReceived`(L2006)는 `receipt_date=null` 클리어. 이번 bulk는 보존. 의도된 불일치(이번 스텝은 bulk만). 추후 단일 UI도 보존으로 통일 필요시 별도 검토.

---

# BUILD-LOG — 시간 기반 자동 배송완료 (track-sync 교체)

## 🔨 시간기반 자동 배송완료 (빌드완료, 리뷰대기) — 2026-06-19
### 정책
SHIPPED+송장 건이 updated_at 기준 N일 경과하면 DELIVERED 자동(추정 마킹). 외부 SweetTracker 추적 API 전면 제거, 같은 경로(/api/shipping/track-sync)에서 로직만 교체 → GitHub Actions 워크플로·middleware 0변경.

### Bob 빌드 결과
- **(1) route 전면교체** `src/app/api/shipping/track-sync/route.ts` — `fetchDelivered`/`sleep`/`SWEETTRACKER_API_KEY` 분기/QUOTA/딜레이 전부 삭제. docstring 시간기반으로 재작성(SweetTracker 의미 흔적 0, grep 검증 완료). N = ?days > env SHIPPING_AUTODELIVER_DAYS > 3 (parseInt 실패/1미만 → 3). limit 기본 40·최대 200(외부 쿼터 없으니 상향). cutoffIso = now - N*86400000. 쿼리: status='SHIPPED' AND tracking_number NOT NULL AND updated_at<=cutoff, updated_at asc, limit. 루프: shipments.status→DELIVERED update + soId(없으면 cafe24_order_id 해소) 있을 때만 syncReceiptStatusFromShipment(...,'DELIVERED') try/catch. 응답 {delivered, candidates, days, message(추정 명시)}. CRON_SECRET Bearer 가드 유지.
- **(2) AI Sync** `src/lib/ai/schema.ts` L133·L137·L139 SweetTracker→택배(송장) 정리 + L139 시간기반 자동완료 설명(updated_at N일 경과·추정·외부API없음·멱등·편집시 시계리셋). DB_SCHEMA 컬럼 무변경(shipped_at 신설 안 함).
- `npm run build` 0 error.

### 멱등/안전
status='SHIPPED' 필터가 DELIVERED/취소/반품 건 자동 제외 → 재처리 없음. soId NULL(cafe24 미해소)건은 shipment.status만 DELIVERED 갱신, receipt 연동 skip. 재무·재고 무관(배송/수령 상태만).

#### Known Gap (자동완료)
- updated_at가 배송 편집에 리셋되는 점은 의도된 보수적 동작(라우트 주석 명시). shipped_at 컬럼 신설은 Out-of-Scope.
- 과거 누적 SHIPPED 백필 일괄처리 없음 — 크론 다음 실행에서 자연 흡수.
- 자동완료 시 고객 알림톡 미발송(추정 마킹이라 별도 결정 대기).

---

# BUILD-LOG — #47 수령일자 보존 / #48 단일원장 정합

## 🔨 #47 수령일자 보존 (빌드완료, 리뷰대기) — 2026-06-19
### 정책
RECEIVED 전이 = 상태값만 변경. receipt_date는 기존값 보존, NULL일 때만 오늘로 fill(COALESCE 시맨틱). PostgREST 컬럼참조 COALESCE 불가 → 2-step(①상태만 update ②receipt_date IS NULL 행만 today fill).

### Bob 빌드 결과
- **(a) 일괄 수령완료 비배송 경로** `src/lib/shipping-actions.ts` `bulkUpdateReceiptStatus` (else 분기, ~L402-422). items/order 각각 2-step으로 분리. 배송 경로(ship?.id)는 (b) 헬퍼 위임이라 무수정.
- **(b) 공용 sync** `src/lib/receipt-sync.ts` `syncReceiptStatusFromShipment` (L20-50). DELIVERED 시 품목·주문 2-step. 예정일 있던 건 보존, 없던 건(NULL) today fill로 #19/#43 동작 유지. allReceived 재집계 로직 무변경.
- **(c) 단건 드로어** `src/app/(dashboard)/pos/SalesListTab.tsx` `markItemReceived`(품목 update + allDone 주문 update)·`markReceiptCompleted`(주문 update) 각 2-step. 로컬 setState는 `it.receipt_date || today` / `prev.receipt_date || today`로 기존값 우선 표시. confirm 문구 "수령일자 → 비어있으면 오늘(기존값 보존)".
- **AI Sync** `src/lib/ai/schema.ts` L213 #43 설명에 "receipt_date 기존 수령(예정)일 보존, 비어있을 때만 오늘로 fill(#47)" 반영. DB/도구 시그니처 무변경(tools.ts 무수정).
- `npm run build` 0 error.

### reaggregate 판단 — **보류**(Known Gap)
`reaggregateOrderReceiptStatus`/`deriveOrderReceiptStatus`(sales-revise-actions.ts L464-491)는 **오직 `convertOrderToParcel`(L635)·`convertOrderToPickup`(L703) 두 전환 액션에서만 호출**된다. 이 두 액션은 브리프 Out-of-Scope의 "의도적 날짜 리셋" 예외 경로다. reaggregate에 보존(.is null)을 적용하면 전환 액션의 의도된 날짜 재설정 시맨틱과 충돌 → 브리프 지침("충돌 우려 시 현행 유지")대로 **현행 유지**. 품목 receipt_date는 (b)/(c)에서 이미 보존되며, 전환 액션은 사용자가 명시적으로 배송방식을 바꾸는 경우라 주문레벨 today 부여가 정상.

#### Known Gap (#47)
- `reaggregateOrderReceiptStatus` 주문레벨 receipt_date는 여전히 `deriveOrderReceiptStatus`에서 전부 RECEIVED 시 today 강제(전환 액션 한정). 보존 정책 미적용 — 충돌회피 의도. 추후 전환 액션에서 보존이 필요해지면 별도 검토.

---

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

## ✅ Phase 2b — 카페24 취소 시 연결배송 처리 + 부분환불 정책 명문화 (배포완료, 2026-06-19)

### 과제
2a backfill로 sales_order_id가 채워진 연결 shipment를, 카페24 취소 webhook(사후통보) 수신 시 정리. 미발송분 삭제·발송완료분 보존+경고. 부분환불 자동복원 영구불가 명문화. **배송처리만 추가** — Phase 1 재고복원·역분개 무수정.

### Locked Decisions
1. webhook=사후통보 → "취소차단" 없음. 부분처리(미발송 삭제, 발송완료 보존). Phase 1 voidShipmentsForOrder(차단형)와 별도 함수 voidUnshippedShipmentsForOrder 신설.
2. 발송완료(SHIPPED/DELIVERED) 배송 = 삭제 금지·보존 + logSyncEvent 경고(운영 수동확인). status 플래그/마이그 신설 안 함.
3. 부분환불(PARTIALLY_REFUNDED) per-line 재고복원 = **영구 자동화 제외**(webhook refund_price 총액만, 품목/수량 부재). 수동 재고조정(InventoryModal) 정책 — 주석·schema·UI동선으로 명문화.
4. 환불(REFUNDED) webhook 배송정리는 범위 밖(취소만). → Known Gap.

### 상태
- 2026-06-19 배포완료. Richard 리뷰 통과. (배송정리 voidUnshippedShipmentsForOrder + 부분환불 수동조정 명문화)

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

---

## ✅ Phase 3 — 택배 상태표시 shipment.status화 + 오프라인 매장만 + 매출처 콤보 활성필터 (리뷰대기)

> 방향 재정의(Project Owner 정본): 역방향 sync 정식화 폐기. 택배 건은 판매현황 표시를 연결 shipment.status로 보여주기만. mutation·재무·재고·forward sync·기존 인라인 update 0줄 변경.

파일: `src/app/(dashboard)/pos/SalesListTab.tsx` (표시/필터 레이어만)

- **A. 택배 상태표시 = shipment.status**:
  - `SHIPMENT_STATUS_LABEL`(PENDING=대기중/PRINTED=출력완료/SHIPPED=발송완료/DELIVERED=배송완료) + `SHIPMENT_STATUS_BADGE` 신설. 택배관리 `shipping/page.tsx` L109 라벨과 문구 일치 확인.
  - 헬퍼 `displayStatusLabel(o)`: 택배(`shipments[0]` 존재) → shipment.status 라벨, status NULL/미지정이면 `receiptStatusLabelFor(...,true)` 폴백(빈칸 금지). shipment 없으면(방문/퀵/직접) 기존 `receiptStatusLabelFor(...,false)`.
  - `displayStatusBadge(o, receiptKey)`: shipment.status 색 우선, 폴백 RECEIPT_STATUS_BADGE.
  - 행 표시·CSV 둘 다 헬퍼로 교체(일관). 수령상태순 그룹/정렬(`receiptGroups`)은 내부 `receipt_status` 버킷 그대로 — 표시 라벨만 바뀌어 회귀 없음.
- **B. "오프라인 매장만" 토글**: `offlineOnly` state + PersistedFilters + 저장 payload/deps(localStorage 영속) + 복원. `filtered` memo 최상단에 `offlineOnly && o.channel==='ONLINE' → 제외`(클라 필터, NULL/STORE 유지). UI는 '미결 건만 보기' 옆 동일 패턴 버튼. '온라인몰' 뷰와 반대방향(주석 명시).
- **C. 매출처 콤보 활성필터**: branchFilter select 옵션을 `is_active!==false || id===branchFilter`(선택된 비활성 지점은 유지)로 렌더. 데이터 로드(비활성 포함)·비활성 지점 주문 라벨 표시는 무손상. compare뷰 `(b as any).is_active!==false` 패턴 재사용.
- **무손상 확인**: forward `syncReceiptStatusFromShipment`, 인라인 shipments update(markItemReceived/markReceiptCompleted/revert/delivery_type), bulkUpdateReceiptStatus 모두 0줄 변경.
- **AI Sync**: 표시/필터뿐 — 스키마·enum·비즈룰·도구 변경 없음. schema.ts/tools.ts 무변경(매트릭스 대입 = 해당없음).
- `npm run build` 0 error.

## Known Gaps (열린 채)
- 부분환불 per-line 재고복원 미지원(데이터 부재 — 영구).
- Phase 3 역방향 정식화 syncShipmentFromReceipt(단건 수령처리→shipment): **방향 재정의로 비범위 확정**(receipt_status 양방향 sync 안 함, 택배는 shipment.status가 단일원천이며 판매현황은 표시만). 필요 시 별도 결정.
