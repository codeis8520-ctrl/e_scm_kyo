# Review Request — 레거시 판매데이터 정규화 2단계 (앱 read 리팩터)

**Ready for Review: YES**
**Build**: `npm run build` ✅ Compiled successfully (6.2s, 0 errors)

## 변경 파일 (5)

### 1. `src/lib/customer-analytics-actions.ts`
- L57 주석: `legacy_purchases` → `legacy_orders`.
- L66-68 (`getRfmAnalysis` legacyQ): `.from('legacy_purchases')` → `.from('legacy_orders')`. select 동일(customer_id, total_amount, ordered_at, branch_id).
- L134 주석 + L143-145 (`getRepurchaseCycles` lq): 테이블명 교체. select 동일.
- L220 주석 + L229-231 (`getChurnRiskCustomers` lq): 테이블명 교체. select 동일.
- **무엇/왜**: legacy_orders 는 주문당 1행 → accumulate 의 count 가 자동으로 주문수가 됨 = F(빈도)·재구매·이탈 카운트 정확화(라인수 부풀림 버그픽스). M 은 헤더 total_amount(=라인합)이라 값 보존.

### 2. `src/app/api/customers/search/route.ts` (~L312-356)
- L313-315 legacy fetch: `.from('legacy_purchases')` → `.from('legacy_orders')`. select(customer_id, ordered_at, total_amount) 동일.
- L353 주석 갱신.
- **반환 필드명 `legacy_purchase_count`(L366) 유지** — 의미만 라인수→주문수(Brief Flag). latestPurchase·legacyCount 로직 무변경.

### 3. `src/app/(dashboard)/customers/page.tsx`
- L205 진입 head-count: `.from('legacy_purchases')` → `.from('legacy_orders')`. (`totalLegacy` = 총 주문수.) 뱃지 문구 "과거 구매 N건" 중립어라 코드 변경 없음.

### 4. `src/app/(dashboard)/pos/SalesListTab.tsx`
- **변경 없음**(검토만). 뱃지 `과거 {c.legacy_purchase_count}건` 값은 search route 에서 옴 → 자동 주문수.

### 5. `src/app/(dashboard)/customers/[id]/page.tsx` (메인 작업)
- 타입 `LegacyPurchase` → `LegacyOrder` + `LegacyOrderItem`(L54~). recipient_name/phone/address 추가, legacy_order_items 배열.
- state: `legacyPurchases`→`legacyOrders`/`setLegacyOrders`. 신규 `expandedLegacy` Set state(legacy 카드 전용 토글, sales 탭 expandedOrders 와 분리).
- 신규 헬퍼 `toggleLegacy(orderId)` — toggleOrder 패턴 복제.
- 페치(L216 주변): 중첩 select 1회 — `legacy_orders` + `branch:branches(name)` + `legacy_order_items(line_seq,item_code,item_text,option_text,quantity,total_amount)`. order desc, range(0,9999). 별도 IN 페치 없음.
- 탭 라벨(L619): `legacyOrders.length`.
- 렌더(과거구매 탭): 라인 테이블 → **주문 카드 목록**.
  - 배너: 총 N건(주문) · 합계 = 헤더 total 합.
  - 검색: channel/branch.name/branch_code_raw + 품목 item_text some 매칭.
  - 카드 헤더(클릭=토글): 일자, 출고처(branch.name 뱃지/없으면 branch_code_raw/'-'), 매출처, 결제상태 뱃지, 주문합계, (N품목).
  - 발송지 블록: `🚚 발송지: name · phone · address`(빈값 '-'), 셋 다 비면 '🚚 발송지 정보 없음'. **값 정제 안 함.**
  - 펼침 시 품목 나열(line_seq 정렬): item_text(pre-wrap) + option_text + item_code(보조) + 수량 + 품목합계. 하단에 legacy_order_no mono.
  - 빈 상태 메시지 유지.

### 부수 (표시 문구 일관)
- `src/app/(dashboard)/customers/analytics/page.tsx:118` 안내문 `(legacy_purchases)` → `(legacy_orders)`. 기능 영향 없음.
- **schema.ts 미변경** — 070 에서 이미 AI 스키마 동기화 완료.

## Self-review 답변
- **Richard 가 먼저 볼 것**: 중첩 select FK 경로 정확성 → `legacy_order_items.order_id` FK(070) 존재로 `legacy_order_items(...)` 임베드 유효, `branch_id`→branches FK 로 `branch:branches(name)` 유효. 확인 완료.
- **Brief 요구 전부 구현**: analytics 3곳 ✅ / search ✅ / page count ✅ / SalesListTab 검토(무변경) ✅ / 상세 카드+발송지+품목 ✅ / M 보존 ✅ / legacy_purchases 무손상(읽기만, ALTER/DROP 없음) ✅ / 앱 read `.from('legacy_purchases')` 잔존 0 (grep 확인).
- **빈 데이터/실패 시**: legacyOrders=[] → "과거 구매 이력이 없습니다." / items=[] → "품목 정보가 없습니다." / 발송지 빈값 → '-' 또는 '발송지 정보 없음'. raw 에러 노출 없음.

## 미해결 질문
없음.
