# Architect Brief — 레거시 판매데이터 정규화 2단계 (앱 read 리팩터)

## Goal
앱의 모든 레거시 판매 read 경로를 flat `legacy_purchases`(라인) 에서 정규화본 `legacy_orders`(주문 헤더) + `legacy_order_items`(품목) 로 전환한다. 결과: RFM 빈도(F)·재구매주기·"과거 구매 N건" 뱃지가 라인수 대신 **주문수** 기준으로 정확해지고, 고객 상세 과거구매 탭이 주문 단위로 묶이며 **발송지(recipient)** 가 노출된다.

## 절대 범위 가드
- **읽기 경로만.** `legacy_purchases` 에 대한 ALTER/UPDATE/DROP 절대 금지. DROP 은 다음 별도 스텝.
- 임포터 재작성·복사UI·POS prefill·item_code→products 매핑 = 범위 밖. 건드리지 말 것.
- 아래 5개 파일 외 신규 파일 생성 금지.

## 신규 테이블 참조 스키마 (070 적용 완료, anon read 가능)
**legacy_orders** (주문당 1행, 47,268): `id, legacy_order_no, customer_id, phone, ordered_at(DATE), channel_text, branch_id(FK branches), branch_code_raw, staff_code, recipient_name, recipient_phone, recipient_address, received_at(DATE), payment_status, note, total_amount(주문합계=라인합 VAT포함), source_file`
**legacy_order_items** (라인당 1행, 66,090): `id, order_id(FK legacy_orders ON DELETE CASCADE), line_seq(SMALLINT 1..n), item_code, item_text, option_text, quantity, unit_price_vat, supply_amount, vat_amount, discount_amount, total_amount`
- FK 존재 → PostgREST 중첩 select 가능: `legacy_orders` + `legacy_order_items(*)`, 그리고 `branch:branches(name)`.

## Build Order

### 1. `src/lib/customer-analytics-actions.ts` — 3개 함수, 테이블명만 교체
세 함수 모두 legacy fetch 의 `.from('legacy_purchases')` → `.from('legacy_orders')` 로 변경. **select 컬럼·accumulate 로직·그 외 전부 그대로.** `total_amount`, `ordered_at`, `branch_id`, `customer_id` 모두 헤더에 동일 존재. legacy_orders 는 주문당 1행이라 `count`(누적 +1)가 자동으로 주문수가 되어 F·재구매·이탈위험 카운트가 정확해진다(이게 이 스텝의 핵심 버그픽스).
- L66-71 `getRfmAnalysis` 의 `legacyQ`
- L143-148 `getRepurchaseCycles` 의 `lq`
- L229-234 `getChurnRiskCustomers` 의 `lq`
- 주석 L57/134/220 의 "legacy_purchases" 문구는 "legacy_orders" 로 갱신(혼란 방지). 기능 영향 없음.
- Flag: Monetary(M) 값은 보존되어야 함 — 라인 total 합 = 주문 헤더 total 이므로 `SUM` 동일(070 검증서 SUM 10,498,357,372 일치 확인). select 에서 다른 컬럼 추가하지 말 것.

### 2. `src/app/api/customers/search/route.ts` (~L312-357) — 테이블 교체 + 의미 라벨링
- L313-318 legacy fetch: `.from('legacy_purchases')` → `.from('legacy_orders')`. select `customer_id, ordered_at, total_amount` 그대로(전부 헤더에 존재).
- L354-357 `legacyCount` 집계: 로직 그대로. legacy_orders 는 주문당 1행 → 자동으로 **주문수**. `range(0, Math.max(99, ids.length * 5))` 도 그대로(주문수가 라인수보다 적으므로 커버리지 유지).
- L346-352 latestPurchase legacy 비교 로직 그대로.
- 반환 필드명 `legacy_purchase_count`(L366) **유지** — 의미만 라인수→주문수. UI 라벨이 "과거 구매 N건"이라 그대로 일관됨. 필드명 변경 시 customers/page.tsx·SalesListTab 동시수정 필요 → 변경 안 함(churn 최소화).

### 3. `src/app/(dashboard)/customers/page.tsx`
- L205 진입 카운트: `sb.from('legacy_purchases').select('id', {count:'exact', head:true})` → `.from('legacy_orders')`. `setTotalLegacy` 가 이제 총 주문수. (전역 안내용 숫자 — 의미만 변경, 코드 1줄.)
- L496-505 뱃지: 코드 변경 불필요(`legacy_purchase_count` 값 의미만 주문수로). 그대로 둠.
- Flag: `totalLegacy` 가 표시되는 안내 문구에 "라인/품목" 같은 단어가 있으면 "주문"으로. 없으면 그대로.

### 4. `src/app/(dashboard)/pos/SalesListTab.tsx` (L981-983)
- 뱃지 `과거 {c.legacy_purchase_count}건` — 값이 search route 에서 오므로 자동으로 주문수. **코드 변경 불필요.** 확인만. (route 가 소스이므로 여기 손댈 것 없음 → 변경 0줄. 그래도 파일 검토는 할 것.)

### 5. `src/app/(dashboard)/customers/[id]/page.tsx` — 과거구매 탭 재구조화 (이 스텝의 메인 작업)
현재: legacy_purchases 라인 flat select(L216-221) → 라인별 테이블(L1146-1208). `legacy_purchase_no`·`item_text`·`quantity`·`payment_status` 컬럼 표시.

변경:
**(5a) 페치 (L216-221)** — 중첩 select 로 교체:
```
supabase
  .from('legacy_orders')
  .select('id, legacy_order_no, ordered_at, channel_text, branch_code_raw, recipient_name, recipient_phone, recipient_address, payment_status, total_amount, source_file, branch:branches(name), legacy_order_items(line_seq, item_code, item_text, option_text, quantity, total_amount)')
  .eq('customer_id', customerId)
  .order('ordered_at', { ascending: false })
  .range(0, 9999)
```
- 한 고객당 주문 수백 이내 → 중첩 select 단일 라운드트립으로 충분(성능 OK). items 별도 IN 페치 불필요.
- items 배열은 `line_seq` 오름차순으로 표시(클라이언트 sort).

**(5b) 타입 `LegacyPurchase`(L54-65)** → `LegacyOrder` 로 재정의:
```
interface LegacyOrderItem { line_seq: number | null; item_code: string | null; item_text: string | null; option_text: string | null; quantity: number | null; total_amount: number | null; }
interface LegacyOrder {
  id: string;
  legacy_order_no: string | null;
  ordered_at: string;
  channel_text: string | null;
  branch_code_raw: string | null;
  branch?: { name: string } | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_address: string | null;
  payment_status: string | null;
  total_amount: number | null;
  source_file: string | null;
  legacy_order_items: LegacyOrderItem[];
}
```
state·setter 명은 `legacyOrders`/`setLegacyOrders` 로 바꾸거나 기존 `legacyPurchases` 명 유지해도 무방(내부 변수, churn 판단은 Bob). 단 일관되게.

**(5c) 렌더 (L1120-1210)** — 라인 테이블 → **주문 카드 목록**:
- 안내 배너(L1121-1129): "총 N건"의 N = 주문수(`legacyOrders.length`), 합계 = `sum(total_amount)`(주문 헤더 합). 문구의 "품목은 원본 텍스트…" 유지. "N건"은 주문 기준임을 자연스럽게.
- 검색 input 유지. 필터 대상: 주문의 `channel_text`/`branch.name`/`branch_code_raw` + **품목들의 item_text 중 하나라도** 매칭(`order.legacy_order_items.some(it => it.item_text?.includes(q))`).
- 각 주문 = 카드(또는 묶음 행). 카드 헤더에 표시:
  - 일자(`ordered_at`)
  - 출고처: `branch?.name` 있으면 파란 뱃지, 없으면 `branch_code_raw`, 둘 다 없으면 '-'
  - 매출처(`channel_text` || '-')
  - 결제상태 뱃지(기존 L1191-1200 로직 재사용: '결제 완료'→완료/green, '미결'→미결/amber, 기타→그대로, 빈값→'-')
  - 주문합계(`total_amount` toLocaleString + '원', 없으면 '-')
  - **발송지 블록(신규)**: 수령자/연락처/주소. 형식:
    `🚚 발송지: {recipient_name || '-'} · {recipient_phone || '-'} · {recipient_address || '-'}`
    셋 다 비면 블록 자체를 흐린 '발송지 정보 없음' 한 줄로. **값 정제 금지** — 더러운 값(카드/계좌 메모 등)도 있는 그대로 출력. 빈값만 '-'.
  - 원본 주문번호(`legacy_order_no`)는 카드 우측 하단에 작은 mono 텍스트로(기존 원본ID 자리 대체).
  - source_file 은 표시 불필요(선택).
- 카드 본문 = **품목 나열**(`legacy_order_items` line_seq 순). 각 품목 행: `item_text`(원본, whitespace-pre-wrap) + `option_text`(있으면 회색 작게) + 수량(`quantity ?? '-'`) + 품목합계(`total_amount` toLocaleString 원, 없으면 '-'). item_code 는 있으면 흐린 mono 로 보조 표시(선택, 매핑 전이라 대부분 비매칭).
- 펼침/접힘: 주문이 많을 수 있으니 품목 목록은 카드 내 항상 표시하되, 페이지에 이미 `expandedOrders`/`toggleExpandAll`(L262 주변) 패턴이 sales 주문 탭에 존재 → **그 패턴을 legacy 카드에도 재사용**해 기본 접힘/펼침 토글 제공(헤더 클릭으로 품목 토글). 패턴 재사용이 어렵거나 과하면 항상 펼침으로 단순화 가능(Bob 판단, 단 주문수가 많은 고객에서 세로 길이 폭주 주의 → 토글 권장).
- `legacyPurchases.length === 0` 빈 상태 메시지 유지.

## Out of Scope (BUILD-LOG Known Gaps 로)
- `legacy_purchases` DROP — 다음 스텝.
- 발송지 값 정제(카드/계좌 메모 분리) — 안 함.
- item_code → products 매핑/복사재판매/POS prefill — 다음 스텝.
- 임포터 재작성·phone2 백필 — 다음 스텝.
- search route 반환 필드명 `legacy_purchase_count` 리네이밍 — 의도적 미변경(churn 최소화, 라벨 일관).

## Acceptance
- `npm run build` 통과(0 errors).
- 코드 전역에서 앱 read 의 `.from('legacy_purchases')` 잔존 0 (grep 확인). 단 `customers/analytics/page.tsx:118`·`schema.ts` 의 **설명 텍스트/주석** 내 단어는 별개(아래).
- analytics: legacy fetch 가 legacy_orders 기준 → RFM F·재구매·이탈 카운트가 주문수. M 값은 070 SUM 과 일치(값 보존).
- 고객 상세 과거구매 탭: 주문 단위 카드, 각 주문에 품목 나열 + 발송지(recipient_*) 노출. 빈 발송지 '-'. 합계/건수 = 주문 기준.
- 뱃지(customers/page, SalesListTab): "과거 구매 N건"의 N = 주문수.

## Flags (Bob 가 추측하면 안 되는 것)
- search route 반환 필드명 `legacy_purchase_count` **유지**(의미만 주문수). 리네이밍 금지.
- `customers/analytics/page.tsx:118` 의 안내문 `(legacy_purchases)` → `(legacy_orders)` 로 텍스트 갱신(표시 문구 일관). 기능 영향 없음. **schema.ts(AI 스키마)는 070 에서 이미 동기화됨 → 이번 스텝 미변경.**
- 발송지 값은 절대 정제/파싱하지 말 것. 있는 그대로 출력, 빈값만 '-'.
- 중첩 select 한 번으로 items 까지 가져온다(별도 IN 페치 금지 — 단순성).
