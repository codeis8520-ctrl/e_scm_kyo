# Session Checkpoint

*Arch writes at session end. Next session reads this first.*

---

## Last Updated
2026-06-11

## Current State — 수령 전 전표 수정 (TMT 스프린트, 3-step)

판매 전표를 **수령 전(receipt_status != 'RECEIVED')** 단계에서 수정하는 기능. 3단계로 분할.

### ✅ Step 1 — 품목 추가/삭제 + 자동 재정산 (커밋 59658d9 push 완료)
- `src/lib/sales-revise-actions.ts`: addSalesOrderItem/removeSalesOrderItem + recalcSalesOrderTotals.
  재고 OUT/IN(phantom-BOM 분해)·포인트 delta·과세/면세/VAT 스냅샷 재계산, 결제차액 sales_order_payments **부호보존**(+추가결제/−부분환불), 델타 매출분개(SALE_REVISE).
- SalesDetailDrawer: 품목 삭제 버튼(수령품목 숨김·마지막품목 잠금) + "+ 품목 추가" 폼. 수정게이트=COMPLETED AND receipt_status≠RECEIVED(null=잠금, UI+서버).
- schema.ts AI Sync 완료. Richard Must Fix 1건(음수 amount CHECK 위반) → 마이그 078 + 에러전파로 해결.
- ⚠️ **마이그 078 Supabase 적용 필요**(amount>=0 제약 제거 + payment_method 'mixed' 허용). 미적용 시 부분환불 방향 수정이 하드실패(단, 조용한 누락은 아님).

### ✅ Step 2 — 방문(PICKUP)↔택배(PARCEL) 양방향 전환 (커밋 156fe31 push 완료)
- Step 2+3 병합 1-슬라이스. convertOrderToParcel(방문→택배: 수령자/주소 검증·고객 prefill, 미수령품목 PARCEL_PLANNED, shipments upsert PENDING, receipt_status 재집계) + convertOrderToPickup(택배→방문: **shipment PENDING일 때만** 허용, 행 삭제, 품목 PICKUP) + deriveOrderReceiptStatus(PARCEL>QUICK>PICKUP>RECEIVED).
- SalesDetailDrawer 전환 버튼/폼(editable 게이트=Step1 동일). **배송비 개념 없음→금액 변동 0**, 재계산/결제/분개 미호출. 마이그레이션 추가 없음. schema.ts AI Sync.
- Richard clean(Must Fix 0). 송장 발행(PRINTED+)된 택배는 방문 전환 거부.

### 🎯 사용자 요구 3종 모두 완료: 품목 추가/삭제(S1) + 방문→택배(S2) + 택배→방문(S2).

## ✅ 지점별 매출 통합 조회 (커밋 0719e5b push + 마이그081 적용·RPC 검증 완료)
- 판매현황 지점비교 서브뷰 → legacy(2018~)+sales 통합 일/월/연. RPC branch_sales_summary(컷오프 2026-05-19, KST, 미매칭 NULL 보존, SECURITY DEFINER). 매트릭스 기간×지점+미매칭 열+합계. Richard Must Fix(컷오프 KST 9시간 갭)→해결. 자세히 [[project_branch_sales_analytics]].

## ✅ 브라우저 탭 화면명 표시 (커밋 2cf03c3 push 완료)
- 대시보드 레이아웃 pathname→메뉴명 document.title("판매관리 · 경옥채" 등). 페이지 단위. 서브탭 세분화는 후속 옵션.

## ✅ 카페24 주문 품목 sales_order_items 텍스트 저장 (커밋 f2b99de push + 마이그080 적용 완료)
- 마이그080: sales_order_items.product_id NULL 허용 + item_text 컬럼(2026-06-13 Supabase 적용 확인). registerCafe24Customers가 등록 시점에 기존연결·신규생성 양쪽 모두 품목을 텍스트 저장(product_id=null, item_text=상품명, 멱등 가드, try/catch). orders 라우트 order_items[] 노출, shipping UI 전달, 구매내역 탭 product?.name ?? item_text 폴백.
- Must Fix: 널 품목 행이 POS/에이전트 환불서 크래시 → **카페24 ONLINE 주문 POS 환불 제외**(몰 측 처리 정책) + 3곳 널 안전. Richard APPROVED.

## ✅ 재고이동 서버측 RBAC 하드닝 (커밋 cc6a5fb push 완료)
- transferInventory+transferInventoryBatch에 requireSession + assertFromBranchOwnership(HQ 자유, 지점고정 본인지점만, branch_id null 거부, 도착지 무제한). Richard 보안리뷰 APPROVED.
- 📌 Known Gap: adjustInventory·recordStockUsage 동일 무검증 패턴(범위 밖, 향후 스텝).

## ✅ 카페24 과거 0원 백필 — 안 함(사용자 결정)
- 과거 ONLINE 0원 34건은 sales_order_items 0건이라 재계산 불가. "과거 무시, 앞으로만" 결정 → 백필 미실행. forward 수정(6d8f05f)으로 신규는 정상.

## ✅ 카페24 버그 2건 (커밋 6d8f05f push 완료)
- ② CJ 송장 품목명 '선택안함' 옵션 제거(parseOptionPairs isNoSelection). ③ 네이버페이 포인트 전액결제 0원 매출 누락 → firstPositiveAmount 헬퍼(webhook total_amount + orders/route total_price). 매출분개 자동교정. Richard APPROVED.
- ⚠️ Known Gap: 과거 동기화된 0원 행(total_amount+분개) 백필 미실행(forward-only) — Project Owner 결정 대기.

## 🔶 카테고리 정렬 (Step1 완료, Step2 진행 중)
### ✅ Step 1 — 재고현황 정렬 필터 (커밋 1ec5430 push 완료)
- 4옵션 select(카테고리순→고가순 기본, 이름순, 재고많은순/적은순). 카테고리순=category-tree sortKey + 가격 desc tie-break. 비-카테고리 시 헤더·소계 숨김 평면. inventory 중복 util 삭제→**기존 @/lib/category-tree 일원화**(신규 category-sort.ts 안 만듦). product price 폴백 사다리 맨 위만. Richard APPROVED.
### ✅ Step 2 — POS 판매위젯 정렬 필터 (커밋 16f0124 push 완료)
- 위젯 그리드 정렬 드롭다운 4옵션(카테고리순 기본, 고가순, 이름순, 재고순). 카테고리순=category-tree sortKey(중분류 자동) + 가격 desc. products 3 select에 category_id 추가, categories 로드+buildCategoryInfo. filteredProducts useMemo, 위젯/검색 양쪽. 재고순=getStock 동일(검증). Richard APPROVED. → **카테고리 정렬 전체 완료**.

## 🔶 재고 사용유형 + 다건 이동 (2-feature, 완료)

### ✅ Feature A Step 1 — 사용유형 관리형 코드 (커밋 00e30ed push + 마이그079 적용 완료)
- 마이그079: inventory_usage_types(시드 로스/자가사용/시음용/기타, 기타=is_system) + inventory_movements.usage_type_id FK + RLS/GRANT(anon). 2026-06-12 Supabase 적용.
- actions.ts CRUD 4종(채널 패턴, 삭제가드 is_system+movements참조), system-codes '사용유형' 탭, schema.ts AI Sync. Richard Must Fix 1(GRANT 누락)→해결.
### ✅ Feature A Step 2 — 다건 재고 소모 차감 (커밋 fd66279 push 완료)
- recordStockUsage(지점+사용유형+다품목, 2-pass 검증후 차감, OUT/reference_type='USAGE'/usage_type_id, 음수허용). StockUsageModal + 재고페이지 '+ 소모 차감'. RAW/SUB 본사제한 적용(adjust 동일). 마이그 없음. Richard clean. → **Feature A 전체 완료**.
### ✅ Feature B 개선 — 다건 이동 둘러보기+체크박스 다중선택 (커밋 ef18b75 push 완료)
- TransferBatchPanel 검색드롭다운→출발지 재고 둘러보기 체크박스 목록(현재고 표시). 체크=즉시 담기(rows 단일소스), 전체선택/해제, 검색=목록 필터. 단일 파일. Richard APPROVED. 다수 품목 이동 편의성 개선.

### ✅ Feature B — 직관적 다건 재고 이동 (커밋 6a72df2 push 완료)
- 재고 '재고현황↔지점이동' 서브뷰 탭(모달 아님, 사용자 명시). transferInventoryBatch(2-pass, 출고지 재고부족 거부, 음수 미허용, OUT+IN reference_type='TRANSFER'). 출발지 선택 시 getInventory(fromBranchId) 직접 페치(stale 가드). 지점고정 사용자 출발지 잠금·도착지 자유. 기존 단건 TransferModal 유지. 마이그 없음. Richard clean(qty=0 가드·후보페치갭 해소).
- 📌 후속 파킹: 서버측 출발지 RBAC 검증(단건 transferInventory + 다건 공통 — UI만 막고 서버 미검증).

## ✅ 판매현황 지점 매출 비교 서브뷰 (커밋 5b8c319 push 완료, 별도 스프린트)
- SalesListTab: '목록↔지점비교' 토글(본사/관리자만, !isBranchUser). 다수 지점 multi-select(기본 전체) → 날짜×지점 매트릭스 표(일별/지점별/총 합계). loadCompare=경량 컬럼 페이지네이션(1000캡 우회) 집계, CANCELLED/REFUNDED/PARTIALLY_REFUNDED 제외, KST 경계. 전체 선택=전지점 비교. 단일 파일, DB 변경 없음. Richard clean. 표만(차트X), 매출=total_amount 합(할인 비차감).

## ✅ CJ 발송지 모달 제거 + 행별 자동해결 (커밋 ecea9a9 push 완료, 별도 스프린트)
- shipping/page.tsx: 대한통운 export 발송지 선택 모달 제거. resolveSenderForRow(이름/전화=저장 sender→출고지점→폴백, 주소/우편=항상 출고지점 branches.sender, 카페24/지점없음→본사HQ) + guardSenders(미해결 행 수령인 나열·export 차단). CJ·선택 양쪽. 데드코드 정리. DB 변경 없음. Richard APPROVED.
- ⚠️ 전제: 출고지점·본사에 branches.sender_*(마이그063) 설정돼야 자동해결. 미설정 시 export 차단(빈칸 송장 방지).

### ✅ 마이그 078 Supabase 적용 완료(2026-06-12, scripts/apply_one_sql.py). amount>=0 제거 + payment_method 'mixed' 확인. Step1 부분환불 차액 기록 정상화.

### 알려진 갭(BUILD-LOG): 할인 재배분 범위 밖, payment-delta 하드실패 시 stock/journal 선커밋 잔여(078로 사실상 해소), mixed→cash 수금계정 단순화(회계정책 추후).

---

## (이전) 레거시 정규화 프로그램 — 보류 중

레거시 판매데이터(경옥채판매DATA ~260518) 재적재 완료 후, **정규화 프로그램** 진행 중이었음.
flat `legacy_purchases`(66,090 라인) → 주문 헤더 + 품목 분리.

## What's Done (이번 세션)

### 재적재 (TMT 외, 직접 실행)
- 마이그 069(라인아이템 컬럼 + payment_status/recipient_phone/recipient_name TEXT 확장) 적용
- reset → customers 12,395 / consultations 8,844 / legacy_purchases 66,090 라인 적재
- 도구: `scripts/legacy_reimport.py`, 백업 `legacy-import-v2/_backup-before-reset.sql`(PII, gitignore)
- 커밋 `92e1d82` push 완료

### 정규화 1단계 — 데이터층 (TMT 정식 플로) ✅ 적용+커밋(push 대기)
- Arch 브리프 → Bob 빌드 → Richard APPROVED(Must Fix 0) → Deploy Gate 승인
- **마이그 070_legacy_orders_normalize.sql** 적용 완료:
  - `customers.phone2` 컬럼 추가(백필은 후속 임포터)
  - `legacy_orders`(47,268) + `legacy_order_items`(66,090) 생성, 064 RLS/GRANT 패턴
  - legacy_purchases 에서 멱등 분리적재(헤더 MIN 대표값/SUM total, line_seq=row_number)
  - 검증: 카운트 일치 / SUM 10,498,357,372 일치 / line_seq NULL 0 / 고아 0
- `src/lib/ai/schema.ts` 동기화(phone2, 신규 2테이블, legacy_purchases 정규화 주석)
- legacy_purchases 는 무손상(후속 단계에서 드롭 예정)

### 정규화 2단계 — 앱 read 리팩터 ✅ 적용+커밋+push
- analytics(RFM 빈도=주문수로 버그픽스)·search·고객목록 카운트 → `legacy_orders`
- 고객상세 과거구매 탭 → 주문 카드 + `legacy_order_items` 품목 + **발송지(recipient_*) 노출**
- `from('legacy_purchases')` 앱 read 잔존 0. build ✅. 독립 Richard 리뷰 APPROVED(Must Fix 0)
- ⚠️ 프로세스: Architect 에이전트가 빌드까지 수행 → 독립 Reviewer 따로 돌려 담보함

### POS 개선 — 판매등록 위젯 표시 속성 ✅ 적용+커밋+push
- 마이그 071: `products.pos_widget` 컬럼 + 백필(완제품&비-phantom→true). 활성 위젯 63개.
- ProductModal "판매등록 위젯 표시" 토글, actions create/update 폼값+규칙+폴백, pos/page 그리드=위젯만/검색=세트포함 전체, schema.ts 동기화.
- TMT: Arch 브리프(파일쓰기 막혀 인라인→오케스트레이터 저장) → Bob 빌드 → 독립 Richard APPROVED(Must Fix 0).

### POS 큐 (다음 후보)
- **#1 POS 과거구매 이력** — 판매등록 고객패널에 legacy_orders 표시 + "이 주문 복사"(수령자/주소 자동, 품목 참고).
- **#2b 포장 옵션화** — 쇼핑백/보자기(SUB 18종)를 옵션으로. 결정 필요: 유료라인 여부 / 항목별·주문별 / 대상목록.

## What's Next (정규화 프로그램 남은 스텝 — 한 번에 하나)

1. **legacy_purchases 드롭** — 앱 read 0 확인됨. 백업/뷰 안전망 고려 후 테이블 제거(별도 마이그). AI schema.ts 에서도 제거.
2. **임포터 재작성** — `import_sales.py`: 이카운트 엑셀 1개 → 헤더 upsert(legacy_order_no) + 품목 upsert(order_id,line_seq), phone2 채움, recipient_address 폴백(주소), customers.address 정리. 증분 멱등. (다음 이카운트 export 대비)
3. **복사→재판매 UI + POS prefill** — 과거 주문 1건(헤더 발송지 + 품목) 복사 → POS 신규 판매. 품목은 legacy item_code→products 매핑 점진(현재 224코드 중 3개만 매칭).

## Decisions Locked
- 발송지 = 주문 헤더 1곳 (정규화로 라인 반복 제거). 별도 주소록 테이블 불필요.
- customers.address = "기본 배송지 캐시"로 유지(POS 자동채움 무손상).
- legacy item 매핑은 점진(복사 시 수령자/주소 우선 자동, 품목 수동).

## Active Rules
- Plan 제시 = 진행 신호. Deploy Gate(commit/push)만 명시 확인 (`feedback_work_pace.md`).
- DB 마이그는 Arch 가 psycopg(.env.local DATABASE_URL)로 직접 적용. Windows 콘솔 PYTHONIOENCODING=utf-8 PYTHONUTF8=1.
- `legacy-import-v2/`·`.env.local` 은 gitignore(PII/비번). 절대 커밋 금지.
