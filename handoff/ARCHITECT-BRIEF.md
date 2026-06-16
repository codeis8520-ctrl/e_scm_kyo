# Architect Brief — Sprint B Step 2: 카페24 주문 탭 인라인 매핑 UI

## Goal
배송 > 카페24 주문 탭에서 주문 행을 펼쳐 order_items별 매핑 상태를 보고, 미매핑 품목을 내부 제품에 인라인 연결/해제한다. 매핑 후 재조회하면 송장/배송 화면 짧은 내부 품목명 표시(Step 1 적용분).

## Context (Step 1이 깔아둔 것 — 재확인됨)
- `/api/cafe24/orders` route.ts order_items[]: `{name, quantity, price, option, product_code, option_value(정규화키), mapped_name(string|null)}` 노출 완료. DEMO_ORDERS도 신규 필드 채워짐.
- `src/lib/cafe24-actions.ts`: createCafe24ProductMap({cafe24_product_code, option_value, product_id})[본사 RBAC, 저장 직전 normalizeOptionValue 재적용·upsert], listCafe24ProductMaps(), deleteCafe24ProductMap({cafe24_product_code, option_value}).
- 마이그082 cafe24_product_map 적용·검증 완료(라이브).

## Build Order (단일 파일: src/app/(dashboard)/shipping/page.tsx)
1. **인터페이스 동기화** — L45 `order_items?: {name; quantity; price; option}[]` 를 route 실제 shape로 확장: `{name; quantity; price; option; product_code: string; option_value: string; mapped_name: string | null}[]`. (route route.ts L63~70 그대로.)
2. **isHQ 판정** — inventory/page.tsx L69~76 `getCookie` 헬퍼 + L113~116 `userRole=getCookie('user_role')` / `isHQ = userRole==='SUPER_ADMIN' || userRole==='HQ_OPERATOR'` 패턴 **그대로 복제**. (shipping/page.tsx엔 현재 없음 — grep 확인.)
3. **제품 목록 1회 로드** — getProducts(actions.ts:13, `{data}` = products[] with id/name/code) 호출, `allProducts` state. cafe24 탭 진입 시 1회(또는 매핑 패널 첫 오픈 시 lazy). 클라이언트 필터(name/code includes).
4. **행 확장 토글** — 각 cafe24 주문 <tr>(L1061)에 펼치기. 방식: expanded Set<cafe24_order_id> state. 품목 셀(L1086 items_summary 영역) 또는 행 좌측에 ▸/▾ 토글. 펼치면 order_items별 보조 <tr>(colSpan 전체=11) 렌더.
5. **item별 매핑 행** — 각 order_item:
   - 품목명 · option · 수량 표시.
   - mapped_name 있으면: `→ {mapped_name} ✓` + (isHQ일 때만) `[해제]` 버튼.
   - mapped_name null이면: `미매핑` + (isHQ일 때만) `[내부 제품 연결]` 버튼 → 제품 검색/선택 인라인 패널(allProducts 필터 드롭다운, manual 탭 senderResults 드롭다운 L1121~1132 패턴 재사용).
6. **연결 동작** — 제품 선택 시 `createCafe24ProductMap({ cafe24_product_code: item.product_code, option_value: item.option_value, product_id })` → 성공 시 `handleLoadCafe24Orders()` 재조회(L706, mapped_name 갱신).
7. **해제 동작** — `deleteCafe24ProductMap({ cafe24_product_code: item.product_code, option_value: item.option_value })` → 성공 시 `handleLoadCafe24Orders()`.
8. **반복 매핑 안내** — 확장 영역 상단에 1줄: "같은 옵션조합은 모든 주문에 한 번에 반영됩니다."
9. 로딩/빈/실패: createCafe24ProductMap/delete 반환 `{success}|{error}` → error 시 인라인 메시지. product_code 빈 품목('')은 매핑 버튼 비활성+안내(키는 동작하나 실질 매핑 불가).

## 잠근 결정 (LOCKED)
- option_value 인자: order_items의 **이미 정규화된 option_value를 그대로** 넘긴다(action이 저장 직전 재정규화하나 이미 정규화된 값이라 idempotent). product_code도 item.product_code 그대로.
- 제품 출처: getProducts 1회 로드 후 클라 필터. 주문 수와 무관(제품 목록 한정적).
- RBAC: 연결/해제 버튼은 isHQ(SUPER_ADMIN/HQ_OPERATOR)에게만 노출. 서버도 가드됨(이중). 비-HQ는 매핑 상태 **조회만**.
- 갱신 = handleLoadCafe24Orders() 전체 재조회(부분 patch 안 함 — 같은 키 다른 주문에도 반영되므로 전체 재조회가 정합).
- DB/마이그 변경 없음. schema.ts/tools.ts 변경 없음(매핑=UI 표현, Step 1에서 동기화 끝).

## Out of Scope (→ BUILD-LOG Known Gaps)
- 기존 저장된 shipment.items_summary 소급 갱신(재조회·재추가해야 반영 — Step 1 한계 유지).
- 제품 검색 서버 페이지네이션/가상화(클라 필터로 충분).
- 매핑 대량 일괄 편집 화면(별도).

## Acceptance
- npm run build ✓ 에러/경고 0.
- 카페24 주문 행 펼치면 order_items별 매핑상태 표시. 미매핑 품목 '내부 제품 연결' → 제품 선택 → 재조회 후 `→ 내부명 ✓` 로 전환. '해제' → 미매핑 복귀.
- 비-HQ 계정: 매핑 상태 보이되 연결/해제 버튼 없음.
- 기존 '주문자 고객 등록'·'선택 주문 배송 추가'·체크박스 선택·필터·CJ export 무회귀.
- product_code 빈 품목은 연결 버튼 비활성+안내.
