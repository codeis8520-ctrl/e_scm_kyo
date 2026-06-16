# Review Request — Sprint B Step 2: 카페24 주문 탭 인라인 매핑 UI
Date: 2026-06-16
Ready for Review: YES

## Files Changed (단일 파일)
- src/app/(dashboard)/shipping/page.tsx:3 — import에 `Fragment` 추가(key 있는 확장 sub-row 래핑용).
- src/app/(dashboard)/shipping/page.tsx:6-7 — `createCafe24ProductMap, deleteCafe24ProductMap`(cafe24-actions) + `getProducts`(@/lib/actions) import.
- src/app/(dashboard)/shipping/page.tsx:12-19 — `getCookie` 헬퍼(inventory/page.tsx L69~76 그대로 복제).
- src/app/(dashboard)/shipping/page.tsx:55 — `order_items` 인터페이스를 route 실제 shape로 확장(product_code/option_value/mapped_name).
- src/app/(dashboard)/shipping/page.tsx:183-195 — 매핑 state: userRole/isHQ, allProducts, productsLoaded, expandedOrders, mappingKey/Search/Busy/Error.
- src/app/(dashboard)/shipping/page.tsx:752-761 — cafe24 탭+isHQ 진입 시 getProducts() 1회 lazy 로드.
- src/app/(dashboard)/shipping/page.tsx:766-805 — toggleExpandOrder / handleConnectProduct / handleDisconnectProduct (성공 시 handleLoadCafe24Orders 전체 재조회, error 인라인).
- src/app/(dashboard)/shipping/page.tsx:1128-1280 — 행 map을 Fragment로 래핑, 품목 td에 ▸/▾ 확장 토글, colSpan=11 확장 tr(안내문 + item별 매핑상태/연결·해제 드롭다운).

## Self-Review
- **Richard가 먼저 볼 것**: (1) mappingError 단일 공유 — 다른 확장 패널에도 보일 수 있으나 매 액션·패널오픈 시 클리어되는 transient라 허용(BUILD-LOG Gap). (2) 비-HQ는 effect가 isHQ 가드라 allProducts 미로드 — 조회 전용이라 의도된 동작. (3) 드롭다운 onBlur 200ms 지연은 기존 senderResults 패턴과 동일.
- **Brief 요구사항 전수**: 인터페이스 동기화 ✓ / isHQ 복제 ✓ / getProducts 1회+클라필터 ✓ / expanded Set 토글 ✓ / item별 품목·옵션·수량+매핑상태 ✓ / 연결(createCafe24ProductMap)→전체재조회 ✓ / 해제(deleteCafe24ProductMap)→전체재조회 ✓ / 반복매핑 안내 1줄 ✓ / 버튼 isHQ 전용 ✓ / product_code 빈 품목 비활성+안내 ✓ / DB·schema.ts·tools.ts 무변경 ✓.
- **빈/실패/로딩**: items 0건 → "품목 정보가 없습니다." / connect·delete `{error}` → 패널 상단 빨강 인라인 / 검색 0건 → "일치하는 제품이 없습니다." 드롭다운.
- **무회귀**: 주문자 고객 등록(registerCafe24Customers의 order_items 파라미터 타입은 신규 타입의 구조적 부분집합 — build 통과 확인), 선택 주문 배송 추가, 체크박스/필터, CJ export(downloadCjExcel 미변경) 모두 불변.

## Build
npm run build ✓ Compiled successfully in 7.0s (에러/경고 0).

## Open Questions
- 없음. 브리프 LOCKED 결정 그대로 구현.

## Out of Scope (logged in BUILD-LOG)
- shipment.items_summary 소급 갱신, 제품검색 서버 페이지네이션, 매핑 대량 일괄편집 화면.
