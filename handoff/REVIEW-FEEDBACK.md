# Review Feedback — Sprint B Step 2: 카페24 주문 탭 인라인 매핑 UI
Date: 2026-06-16
Status: APPROVED

## Conditions
(없음)

## Escalate to Arch
(없음)

## Cleared
shipping/page.tsx 단일 파일 인라인 매핑 UI 검증 완료:

- **인터페이스 동기화** — L55 `order_items` 타입(product_code/option_value/mapped_name)이
  `/api/cafe24/orders/route.ts` 실제 반환 shape(route L407-414)와 정확히 일치. option_value는
  route에서 이미 normalizeOptionValue 적용된 키. 타입 불일치 없음, build 통과.
- **RBAC / 방어심층** — isHQ(getCookie + SUPER_ADMIN/HQ_OPERATOR)는 inventory/page.tsx L113-116
  기존 패턴 그대로. 연결/해제 버튼·검색 패널 모두 isHQ 가드. 서버 액션도 PRODUCT_MAP_ROLES로
  독립 게이트(cafe24-actions L166-168, L222-224). 비-HQ는 mapped_name 조회만 가능, mutate 불가.
- **액션 시그니처** — handleConnectProduct → createCafe24ProductMap({cafe24_product_code,
  option_value, product_id}), handleDisconnectProduct → deleteCafe24ProductMap({cafe24_product_code,
  option_value}). 인자 구조가 액션 파라미터와 정확히 일치. 성공 시 'error' in res 가드 후
  handleLoadCafe24Orders() 전체 재조회 → 같은 옵션조합이 모든 주문에 반영(route가 매핑 재계산).
- **product_code 빈 품목** — noCode 분기로 매핑 비활성 + "품목코드 없음 (매핑 불가)" 안내.
- **제품 로드** — getProducts() lazy 1회(cafe24 탭+isHQ+!productsLoaded), 클라이언트 필터
  (slice 30), N+1/refetch storm 없음. getProducts 반환 {data:[...]} shape 일치.
- **확장 토글** — expandedOrders Set(cafe24_order_id 키) 토글 정확. mapped_name 기준
  매핑(→내부명 ✓ [해제]) vs 미매핑([내부 제품 연결]) 분기 정확.
- **무회귀 / 키** — colSpan=11 = 헤더 11열 일치. Fragment/li/match 버튼 key 모두 고유.
  onMouseDown(선택) vs onBlur 200ms(닫기) 순서 정확. 주문자 고객등록·주문추가·CJ export·
  shipments 리스트 불변. loading/empty/failure 처리됨. build 0 error/0 warn.
- **DB/마이그/schema.ts/tools.ts 무변경** 확인.

Bob self-review 항목(공유 mappingError transient, 비-HQ allProducts 미로드) — 의도된 동작이며
BUILD-LOG Gap으로 기록됨, 차단 사유 아님.
