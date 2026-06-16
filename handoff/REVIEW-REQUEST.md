# Review Request — 판매현황 수령/매출 분리 + 카페24 받는분
Date: 2026-06-16
Ready for Review: YES

## Build
npm run build ✓ Compiled successfully in 5.3s (에러/경고 0)

## Files Changed

### src/lib/cafe24/webhook.ts
- L180~199 — 신규 `extractRecipientInfo(cafe24Order)`: `co.receivers?.[0]`에서 받는분 스냅샷 추출(name/phone/zipcode/address/addressDetail, trim()||null).
- L231 — handleOrderCreated에 `const recipient = extractRecipientInfo(cafe24Order)` 추가.
- L265~320 — sales_orders insert를 `insertPayload` 객체로 추출, recipient_* 5필드 포함. orderError가 42703/`recipient_`/column-missing이면 5필드 제거 후 재시도(마이그 083 미적용 방어). memo `Delivery:` 라인 현행 유지.

### src/app/(dashboard)/pos/SalesListTab.tsx
- L66~72 — OrderRow 타입에 recipient_name?/phone?/zipcode?/address?/address_detail? 추가.
- L166 — listSort 기본값 `'order'`→`'receipt'` (수령 현황 첫 진입 = 수령일자별).
- L206 — extended select에만 recipient_* 5컬럼 추가(fallback 분기 미변경).
- L487~503 — 검색 술어 recQ/addrQ에 sales_order recipient_* OR 추가(shipment 없는 카페24 주문도 검색).
- L563~571 — renderOrderRow에 `recv` 헬퍼(firstShip ?? o.recipient_*) + `hasRecv`.
- L655~679 — 받는분 셀: shipment 없어도 recv 노출, 택배/퀵 아이콘은 firstShip 있을 때만.
- L779~782 — CSV 받는분 3컬럼 firstShip ?? o.recipient_* 폴백.
- L811 — 서브뷰 라벨 '목록'→'수령 현황', '지점비교'→'매출 현황' (subView 키 'list'/'compare' 유지).

### src/lib/ai/schema.ts
- L58~60 — sales_orders 컬럼에 recipient_* 추가 + 주석 1줄(받는분 스냅샷·shipments 우선).

## Self-Review
- **Richard가 먼저 볼 것**: webhook 42703 retry의 unused destructure — `void` 문으로 lint 통과. retry 조건은 code='42703' OR msg에 'recipient_' OR ('column'+'does not exist) 포함이라 컬럼 누락을 폭넓게 흡수.
- **브리프 요구사항 전부 구현**: extractRecipientInfo·insert·42703 retry·라벨·기본정렬·extended-only select·recv 헬퍼(render/CSV/검색/수령일자 그룹 공통)·OrderRow 타입·schema 동기화·tools.ts 무변경 확인. 모두 ✓.
- **빈/실패 UX**: 받는분 없으면 셀 '-'. 마이그 083 미적용 시 extended select 42703→기존 fallback 흡수, webhook insert 42703→recipient 제거 재시도. 주문 생성·목록 로드 안 깨짐.
- 수령일자별 그룹 렌더(L1156 receiptGroups.flatMap)도 동일 renderOrderRow 사용 → recv 헬퍼 자동 적용.

## Open Questions
- 없음.

## Out of Scope (logged in BUILD-LOG)
- 기존 카페24 주문 recipient_* 백필 없음(shipment 있으면 그쪽 표시).
- b2b_sales_orders/legacy_purchases 미변경.
- compare RPC 로직 미변경(라벨만).
- 마이그 083 파일은 Arch 소유 — Bob 미생성.
