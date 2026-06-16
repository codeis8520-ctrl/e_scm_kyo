# Architect Brief — 판매현황 개선 (수령 현황 / 매출 현황 / 카페24 받는분)

## Goal
판매현황 탭 라벨을 '수령 현황'·'매출 현황'으로 바꾸고, 수령 현황 진입 시 수령일자별 기본 정렬, 카페24 주문 받는분(이름/연락처/주소)을 sales_orders에 저장·표시한다.

## Build Order (한 스텝 — 마이그 미적용 상태에서도 build·런타임 통과해야 함)

### 1) 마이그 083 — Arch가 직접 적용한다. Bob은 파일만 생성.
`supabase/migrations/083_sales_orders_recipient.sql`:
- `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS recipient_name TEXT, ADD COLUMN IF NOT EXISTS recipient_phone TEXT, ADD COLUMN IF NOT EXISTS recipient_zipcode TEXT, ADD COLUMN IF NOT EXISTS recipient_address TEXT, ADD COLUMN IF NOT EXISTS recipient_address_detail TEXT;`
- 전부 nullable. shipments(마이그 012) 5컬럼 형식과 동일하게 맞춤. backfill 없음.

### 2) webhook — `src/lib/cafe24/webhook.ts`
- L160 `extractBuyerInfo` 바로 옆/아래에 `export function extractRecipientInfo(cafe24Order): { name, phone, zipcode, address, addressDetail }` 추가. 원천 = `co.receivers?.[0]` (이미 extractBuyerInfo가 쓰는 recvObj와 동일 경로). 필드 폴백: name = `recvObj.name ?? recvObj.shipping_name`; phone = `recvObj.cellphone ?? recvObj.phone`; zipcode = `recvObj.zipcode`; address = `recvObj.address1 ?? recvObj.address_full ?? recvObj.address`; addressDetail = `recvObj.address2`. 전부 `.trim() || null`.
- `handleOrderCreated` insert(L265~290)에 recipient_* 5필드 채움. **컬럼 누락 방어 필수**: insert가 42703/`column ... does not exist`로 실패하면 recipient_* 5필드를 뺀 객체로 재시도(L240 SalesListTab의 42703 폴백 패턴 동일 적용). 마이그 083 미적용 시점에도 주문 생성이 깨지면 안 됨.
- memo의 `Delivery: ...`(L288)는 그대로 둠(중복이지만 회귀 방지). recipient_address가 더 정확하면 memo도 recipient_address로 채워도 무방 — 결정 위임.

### 3) SalesListTab — `src/app/(dashboard)/pos/SalesListTab.tsx`
- **라벨** L793: `['list','수령 현황'], ['compare','매출 현황']`. subView 값 'list'/'compare'는 내부키 유지. compare 영역 헤더('지점별 일 매출 비교' 등) 텍스트도 '매출 현황' 톤으로 일관 변경(검색해서 다 잡을 것).
- **기본 정렬** L161: `useState<'order'|'receipt'>('receipt')`로 변경(수령 현황 진입 시 수령일자별 기본). 토글로 'order' 전환 가능 유지. compare→list 전환 시 listSort는 그대로 'receipt' 유지(재설정 안 함).
- **받는분 저장 컬럼 select**: `buildQuery` extended 분기(L201~210)에만 `recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail` 추가. 기본(fallback) 분기엔 넣지 말 것 — 기존 42703 폴백(L243)이 마이그 미적용을 그대로 흡수한다.
- **렌더(받는분)** L558 firstShip 인근: 받는분 표시값 = `firstShip?.recipient_name`(shipment 우선) → 없으면 `o.recipient_name`(sales_order). 주소·전화도 동일 우선순위. firstShip 없는 카페24 주문도 받는분 노출되도록. 헬퍼 1개(`const recv = { name: firstShip?.recipient_name ?? o.recipient_name, phone: ..., address: ..., addressDetail: ... }`)로 묶고 기존 렌더(L655~659)·CSV(L766~768)·수령일자별 그룹 렌더 모두 그 헬퍼 사용.
- **검색 술어** L482~492: 받는분/주소 검색이 shipment만 보던 것을 sales_order recipient_*도 포함하도록 OR 추가(shipment 없는 카페24 주문도 받는분 검색에 걸리게).
- OrderRow 타입(L37 인근)에 recipient_name?/phone?/zipcode?/address?/address_detail? (string|null) 추가.

### 4) AI Sync — `src/lib/ai/schema.ts`
- L58 sales_orders 컬럼 나열에 recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail 추가.
- L59 ※ 주석 뒤에 한 줄: recipient_*는 카페24 받는분(수령자) 스냅샷(마이그 083) — buyer_*(주문자)와 별개. 출고 후엔 shipments.recipient_* 우선.
- tools.ts: 신규 enum/액션 없음 → 변경 불필요(확인만).

## Out of Scope (→ BUILD-LOG Known Gaps)
- 기존 카페24 주문 recipient_* backfill 안 함(083 이전 주문은 sales_order 받는분 비어있음 — shipment 있으면 그쪽으로 표시됨).
- b2b_sales_orders, legacy_purchases 받는분 변경 없음.
- compare(매출 현황) RPC(branch_sales_summary) 로직 변경 없음 — 라벨만.

## Acceptance
- npm run build 통과. 마이그 083 적용 전/후 모두 주문 webhook 생성·판매현황 로드 정상(42703 폴백 동작).
- 탭 라벨 '수령 현황'/'매출 현황'. 수령 현황 첫 진입 = 수령일자별 정렬.
- 마이그 적용+신규 카페24 주문 시 shipment 없어도 받는분(이름/전화/주소) 목록·CSV·검색에 노출.

## Builder Plan (Bob)
코드 형상 검증 완료. 마이그 083은 Arch 소유 — 파일 손대지 않음.
1. webhook.ts: `extractRecipientInfo(cafe24Order)` 추가(L178 뒤, recvObj=`co.receivers?.[0]` 경로 동일). handleOrderCreated insert에 recipient_* 5필드 채움. orderError 42703/column-missing 시 recipient_* 제거 객체로 재시도(insert 분기 헬퍼화). memo `Delivery:` 그대로 둠.
2. SalesListTab.tsx:
   - OrderRow 타입에 recipient_name?/phone?/zipcode?/address?/address_detail? (string|null) 추가.
   - listSort 기본값 'order'→'receipt' (L161). compare→list 시 재설정 없음(현행 그대로).
   - extended select(L201~210)에만 recipient_* 5컬럼 추가. fallback 분기는 손대지 않음(42703 폴백이 흡수).
   - renderOrderRow(L546~) 안에 `recv` 헬퍼: name/phone/address/addressDetail = firstShip 우선 → 없으면 o.recipient_*. 받는분 셀(L643~665)을 firstShip 없어도 recv로 노출하도록 재작성(아이콘은 firstShip 있을 때만).
   - CSV(L766~768): firstShip 우선 → o.recipient_* 폴백.
   - 검색 술어 recQ/addrQ(L481~496): shipments OR sales_order recipient_* 포함.
   - 라벨 L793: '목록'→'수령 현황', '지점비교'→'매출 현황'. subView 키 'list'/'compare' 유지. compare 헤더(L1171) '지점별 매출' 톤 유지하되 '매출 현황' 일관(아래 결정).
3. schema.ts L58/L59: sales_orders 컬럼에 recipient_* 추가 + 주석 1줄.

결정사항(위임받은 것):
- memo Delivery 라인 = 현행 유지(회귀 방지).
- compare 헤더 L1171 '지점별 매출 (일/월/연)'은 이미 '매출' 톤이라 라벨만 '매출 현황'으로 토글 통일하고 헤더 텍스트는 의미 명확하므로 유지. (라벨 = '매출 현황', 헤더 = '지점별 매출')

진행함.
