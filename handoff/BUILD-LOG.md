# BUILD-LOG — processPosCheckout 라운드트립 최적화 (A/B/C/D1)

## 🔨 빌드완료 (리뷰대기) — 2026-06-19
결제 핵심경로 `processPosCheckout`(src/lib/actions.ts)의 순차 DB 라운드트립 감소. **숫자·재고·포인트·movements·shipment·분개·에러폴백 100% 보존, 라운드트립만 감소.** 적용: A(알림 비차단)·B(재고 SELECT/movements 배치)·C(products 통합)·D1(point_history 배치). 보류: D2(branches 중복)·D3(resolvePointRate) — 브리프 hold.

### Bob 빌드 결과 (변경 함수: processPosCheckout 만)
- **C — products 단일 조회**: ⓪ select에 `is_taxable` 추가. 폴백 체인 4단 확장(full → is_phantom 제거 → track_inventory 제거 → is_taxable 제거; is_taxable는 006 최고령이라 마지막까지 유지). ⓪ 루프에서 `isTaxableByProduct` 맵 동시 채움(`p.is_taxable !== false`, 컬럼 부재 시 true=과세 폴백). 과세 블록(구 L2570~)의 별도 products 조회 **삭제** → 맵 재사용. 게이트 `if (!taxErr)` → `if (isTaxableByProduct.size > 0)` (⓪ 조회 실패 시 맵 비어 스킵 = 기존 동작 동일, 전부 0).
- **B — 재고 배치**: `decrementStock` 헬퍼 제거(타 호출처 없음, grep 확인). 합산 로직(normalMap/phantomMap dedup·phantom 분해·decimalByMaterial·Math.ceil/round·track skip) **전부 무변경**. 그 뒤 차감 키 집합 `Set([...normalMap.keys(), ...phantomMap.keys()])` → **단일 inventories SELECT** `.eq(branch).in(product_id, ids)` → Map. 키별 `before=toNum(existing?.quantity)`, `after=before−qty`, `stockUpdates[id]=after` (산술 동일). UPDATE(기존행)/INSERT(신규, safety_stock:0) **병렬 유지**(upsert/RPC 금지). movements는 **배열 1회 INSERT** — 행 개수·reference_type(POS_SALE/PHANTOM_DECOMPOSE)·memo·quantity·branch_id·reference_id 모두 키별 1:1 동일. 새 에러게이트 추가 없음(기존도 무처리).
- **A — 알림 비차단**: ⑥ 블록(customers SELECT + branches SELECT + fireNotificationTrigger)을 `void (async () => {...})().catch(()=>{})` 로 감싸 **await 제거**. customers/phone 등이 payload에 없어 조회는 필요 → fire-and-forget 내부로 이동. 알림은 원래 best-effort(.catch fire-and-forget)라 신뢰성 등급 동일. 바로 다음 줄 `return { orderNumber, pointsEarned, stockUpdates }`.
- **D1 — point_history 배치**: use+earn 두 insert → **배열 1회 insert** `[useRow, earnRow]`. balance는 JS 계산(afterUse, afterUse+pointsEarned)이라 DB 의존 없음. type·points·balance·description·순서 동일. else 분기(earn만) 1행 그대로. maybeSingle 잔액 조회 유지.

### 정확성 보존 확인
- stockUpdates·movements 행수·point_history 행수·taxableAmount/exemptAmount/vatAmount 산술 전부 동치. 반환값 `{orderNumber, pointsEarned, stockUpdates}` 무변경.
- 폴백 체인: products 4단·sales_orders·shipments·sales_order_items 전부 유지.
- DB/마이그/AI schema 무변경(읽기통합+쓰기배치, 컬럼·enum·로직 불변 → 매트릭스 해당없음).
- npm run build 0 error.

### Known Gap
- D2(branches L2805/L2930 중복 조회)·D3(resolvePointRate 순차 2쿼리) — 브리프 hold(의존성·회귀위험 > 이득). 미적용.

---

# BUILD-LOG — 대시보드 본부대표용 실용 개선 3종 (액션카드·매출추이·지점순위)

## 🔨 빌드완료 (리뷰대기) — 2026-06-19
본부대표 대시보드에 (1) 처리대상 액션 카드 4종, (2) 오늘/어제/7일 매출 추이, (3) 활성 지점별 매출 순위 막대 추가. 기존 화면 무손상(추가만). **PO 확정 결정 반영: 브리프의 #18 적용범위 한정(기존 필드 동결) 플래그를 오버라이드 — periodTotal·onlineAmount·channelSales 기존 매출 합산도 #18(total_amount − COALESCE(discount_amount,0))로 정정해 대시보드를 판매현황/매출관리와 일치시킴.**

### Bob 빌드 결과
- **route.ts**: `netAmount()` 헬퍼 추가(#18). 기존 periodSales/channelSales/onlineAmount 합산을 raw total_amount → netAmount(#18)로 정정 + 각 쿼리 select에 discount_amount 추가. 신규 쿼리 5종 전부 기존 Promise.all에 병렬 추가:
  - A1 미수금: sales_orders approval_status='UNSETTLED'(status 무관) → unsettledTotal(#18)/unsettledCount.
  - A2 미발송: shipments status IN(PENDING,PRINTED) count head. 지점사용자 .eq(branch_id)(=출고지점, NULL 카페24 제외), 본사 전체 → unshippedCount.
  - A4 추이: 7일 1쿼리(trendStart~today, KST 경계) → JS fmtDateKST 7버킷 #18 합산. monthToDate 독립쿼리(이번달1일~today). 상단 기간필터와 독립(항상 today) → salesTrend/monthToDateTotal/todayTotal/yesterdayTotal.
  - A5 지점순위: sales_orders 기간(상단 기간필터 반영) branch_id별 #18 합 → 활성 branches(is_active=true, 기존 branchesResult)와 join, desc. branchId 미적용(전지점 비교)이나 isBranchUser면 자기지점만 → branchRank.
- **DashboardClient.tsx**: DashboardData에 8필드 추가. 액션카드 grid(grid-cols-2 md:grid-cols-4, next/link, 0건 회색·>0 색강조 red/amber/blue/orange) → 매출추이 card(오늘 큰숫자+어제대비%▲red/▼blue/—, 이번달누적, 7일 div 막대 차트라이브러리 없음) → 지점순위 card(가로 막대, isBranchUser면 섹션 숨김). 모두 기존 요약카드 grid 위에 삽입, 이하 기존 섹션 무변경.

### 결정 (확정 반영)
- #18 통일 범위 확장: 기존 매출 카드도 정정(할인분만큼 소폭 하향 = 의도된 정정). 브리프 Known Gap이던 항목을 이번 스텝에 흡수.
- RBAC: 지점사용자 미수금·미발송·추이 자기지점만, 지점순위 섹션 숨김. 활성지점만 순위 노출.
- 링크 단순 페이지이동(/trade,/shipping,/purchases,/inventory) — URL param deep-link 미지원(아래 Gap).
- DB/마이그/AI schema 무변경(대시보드 화면 전용, 매트릭스 해당없음).
- npm run build 0 error.

### Known Gap
- 액션카드 deep-link 쿼리파라미터(/trade?tab=credit 등) — 대상 페이지 URL param 미지원, 단순 이동만.
- branch_sales_summary RPC(legacy 통합) 미연계 — 지점순위는 신규 sales_orders만 집계(legacy 제외).
- 미수금 카드는 신규 sales_orders 채널만(b2b_sales_orders 미수금 미포함) — 필요 시 별도.

---

# BUILD-LOG — #51 재고현황 클릭 기본 '자가 사용' · '강제 조정' 분리

## 🔨 빌드완료 (리뷰대기) — 2026-06-19
재고현황 숫자 셀 클릭을 강제 조정(ADJUST) → 자가 사용(USAGE, 제품·지점 preselect)으로 전환. ADJUST는 빨강 '⚠ 강제 조정' 버튼으로만 진입. 확정 결정 반영: 자가사용=btn-primary 승격, 강제조정=빨강/경고, 재고 0/없음 칸 비활성.

### Bob 빌드 결과
- **StockUsageModal.tsx**: `defaultProductId?` prop 추가. rows useState 초기화 시 defaultProductId 있으면 inventories에서 찾아 1행(qty 1) 자동 생성. branchLocked·다건 검색/삭제·정수≥1 제출제약 전부 기존 유지.
- **page.tsx 셀 클릭 전환**: `handleUsageClick(item)` 신설 → usagePreselect{productId,branchId} 세팅 후 USAGE 모달 오픈. handleAdjust는 셀에서 분리, 상단 버튼 전용. 데스크톱 매트릭스·모바일/지점별(flat) 관리열 모두 적용.
- **RBAC `usageBlocked`**(데스크톱 셀 + flat 행 동일식): materialBlocked || (isBranchUser && 셀지점≠본인지점) || 현재고≤0. 본사는 materialBlocked·재고0 외 전 지점 허용. title 툴팁 사유별 분기.
- **상단 버튼**: '+ 소모 차감'(secondary) → '+ 자가 사용'(btn-primary). '+ 재고 조정'(primary) → '⚠ 강제 조정'(bg-red-600, isHQUser 유지). flat 관리열에도 '자가 사용'(파랑) + '⚠ 강제 조정'(빨강) 2버튼.
- **InventoryModal.tsx**: 제목 '⚠ 강제 조정', 상단 red 경고 배너("실사·오류 보정 전용, 일상 소모는 자가 사용"). ADJUST 로직 무변경.
- **힌트(L829)**: "숫자 클릭 → 자가 사용(소모) · 강제 조정은 상단 버튼(본사 전용) ..."로 갱신.
- **모달 마운트**: defaultProductId=usagePreselect?.productId, defaultBranchId=preselect.branchId ?? (지점직원 자기지점). onClose/onSuccess에서 usagePreselect 초기화.
- **AI schema.ts** L172~173: 자가사용=지점직원 자기지점 가능(원자재·부자재 제외)·본사 전지점, 강제조정=본사 전용 별도버튼으로 보강.

### 결정 (확정 반영)
- 재고 0/없음 칸 클릭 = 비활성(차감 무의미). isMissing 칸도 동일.
- 자가사용 버튼 btn-primary 승격, 강제조정 빨강/경고.
- 본사 셀 클릭 시 해당 지점으로 지점 select 고정(branchLocked). 본사 branches는 전체 전달(잠금되므로 무방, preselect 지점명 렌더 보장).
- npm run build 0 error.

### Known Gap
- 소수재고 제품 자가사용 수량은 현행 정수≥1만 입력 가능(StockUsageModal handleSubmit Number.isInteger). 소수 입력은 별도 요청 필요 — 이번 스코프 밖.

---

# BUILD-LOG — #46 배송메시지 ↔ 포장/옵션 분리

## 🔨 빌드완료 (리뷰대기) — 2026-06-19
배송메모에 "[옵션] ..."가 섞여 길어지던 문제 해소. 배송메시지=순수 고객 배송요청(delivery_message)만, 포장/옵션은 별도 컬럼으로 노출(#40 가시성 보존). 저장 데이터·order_options 도출(shipping-actions.ts) 무변경.

### Bob 빌드 결과 (`src/app/(dashboard)/shipping/page.tsx`)
- **composeDeliveryMessage** (L147~): `[옵션]` 합성 제거 → `return (s.delivery_message ?? '').trim()`. 시그니처도 `{ delivery_message }` 로 단순화(items_summary/order_options 인자 제거). 호출처 2곳(배송목록 행·CJ export)은 전체 `s` 객체 전달이라 구조적으로 무해.
- **배송목록 '포장/옵션' 컬럼 신설**: thead '배송메모'와 '품목' 사이 violet 헤더 추가. tbody 동일 위치에 `s.order_options` TruncatedCell(violet-700) 셀, 없으면 `-`. 이 테이블 empty-state는 div(colSpan 아님)·소계행 없음 → colSpan 보정 불요(L1222 colSpan은 카페24 탭 별도 테이블, 무관).
- **CJ export(downloadCjExcel)**: 배송메세지1 = 순수 delivery_message(합성 제거 효과). **'포장/옵션' 컬럼을 표준 컬럼 맨 끝(보내는분우편번호 뒤)에 추가**(Flag B 확정). header/rows/cols 3배열 모두 14개로 일치. 표준 CJ 컬럼 순서·개수·#30 내품명(G열) 빈칸 무손상.
- **AI schema.ts** L74 #40 주석에 #46 분리 반영.

### 결정
- CJ 옵션 컬럼 위치 = 맨 끝(Flag B). 표준 양식 순서 보존 우선(CJ 임포트 위치 매칭 안전).
- 배송목록 옵션 컬럼 위치 = 배송메모·품목 사이(화면 전용, 안전).
- npm run build 0 error.

### Known Gap
- **카페24 탭(#3) 원본 message 파싱 분리 안 함**: cafe24 `shipping_message` 자체에 옵션이 섞여오는 케이스. 우리 합성이 아니라 cafe24 원본 데이터. 신뢰 가능한 split 마커 미보장 → 이번 범위 밖. 카페24 탭 배송메모는 원본 그대로 표시 유지.
- items_summary에 옵션이 텍스트로 박힌 과거 카페24 historical 행(sales_order 없음, order_options NULL) — 분리 불가, 현행 유지.

---

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
