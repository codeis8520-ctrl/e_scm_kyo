# Review Request — Step 4 (POS 판매 등록: 완제품만 노출)

*Bob 작성. Richard 읽음.*

**Ready for Review: YES**
**Build**: `npm run build` 통과 (46 static pages, TypeScript 0 errors)

---

## 개요

POS 판매 등록 화면에서 원자재(RAW)·부자재(SUB) 제품이 그리드·검색·바코드 매칭에 노출되지 않도록 클라이언트 필터링 + 서버 액션 방어 추가. OEM 위탁 생산 모델에서 판매 대상은 완제품(FINISHED)뿐.

## 변경 파일 목록 (2개)

### 1. `src/app/(dashboard)/pos/page.tsx` (약 L274-292 부근, 초기 데이터 로드 블록)

**변경 내용**:
- 제품 로드 쿼리에 `product_type` 컬럼 추가. 마이그 042 미적용 DB 폴백으로 `product_type` 없이 재조회(기존 select 그대로).
- `Promise.all` 분할: products는 폴백 재시도가 필요해 선행, 나머지(branches/customers/grades/inv/users)는 종전대로 병렬.
- 제품 state 설정 직전 in-memory 필터 적용: `p.product_type !== 'RAW' && p.product_type !== 'SUB'` (null은 레거시 FINISHED 취급).
- `productMap`은 필터 후 `productsData` 기준으로 구성 → 바코드/코드 Enter 매칭도 자동으로 RAW/SUB 제외.

**한 줄 요약**: RAW/SUB 제외된 `productsData` 하나로 `setProducts` · `productMap` 모두 구성하여 그리드/검색/바코드를 한 번에 차단.

### 2. `src/lib/actions.ts` (L1111-1122 부근, `processPosCheckout` 앞단)

**변경 내용**:
- 기존 "① 재고 사전 확인" 위에 "⓪ 판매 가능 제품 검증" 블록 신설.
- `cart`의 `productId` 중복 제거 후 `products.in('id', [...])`로 한 번에 `product_type` 조회.
- RAW/SUB 제품이 하나라도 있으면 `{ error: '판매 가능한 제품이 아닙니다.' }` 즉시 반환.
- 마이그 042 미적용 DB에서는 쿼리 에러 → 검증 스킵(운영 차단 방지). 검증 통과 시에만 후속 재고/주문/items/재고차감 흐름 진행.
- 재고 사전 확인 주석을 `①`로 변경(단순 번호 시프트).

**한 줄 요약**: sales_order_items insert 이전 시점에서 RAW/SUB productId 수신 시 한글 에러 반환.

---

## Self-review 답변 (Brief 체크리스트)

### `pos/page.tsx` 제품 로드 쿼리에 `product_type` 포함 (마이그 042 폴백 유지)
- 1차 select에 `product_type` 추가. error 반환 시 2차 select는 기존 컬럼 집합 그대로 재시도. `InventoryModal.tsx`의 기존 패턴과 동일 구조.

### RAW/SUB 제품이 그리드 `filteredProducts` 렌더링에서 제외되는가?
- `filteredProducts = products.filter(...)`는 `products` state를 기반으로 하므로, setProducts 이전 in-memory 필터로 RAW/SUB가 이미 제거됨.

### 검색 결과에 RAW/SUB 제외되는가?
- 동일 원리. 검색어 입력(`filteredProducts`)은 `products` state 기반이라 자동 제외.

### `productMap`(바코드/코드 조회)에 RAW/SUB 제외되는가?
- `productsData.forEach(p => pMap.set(...))`가 필터된 `productsData`를 돌므로 RAW/SUB의 barcode·code 키는 애초에 map에 추가되지 않음. Enter 매칭 시 "제품 찾을 수 없음" UX 자연 발동(Brief §결정).

### 서버 액션(createSalesOrder/POS 주문 생성 경로)에 RAW/SUB 거부 추가되었는가?
- `processPosCheckout` 초반, 재고 확인 이전에 검증. products.in('id', productIds) 한 번으로 전 품목 확인. 폴백 스킵은 마이그 042 미적용 환경 전용.

### 에러 메시지는 한글·시스템 용어 숨김?
- `"판매 가능한 제품이 아닙니다."` — DB 컬럼명/타입 노출 없음.

### 기존 완제품 판매 흐름이 영향 없는지 수동 검증 시나리오 기록
- 시나리오 1: FINISHED 제품 1종 장바구니 → 결제 → 정상 통과(ptRes.data에 RAW/SUB 없음 → 검증 스킵 후 기존 로직).
- 시나리오 2: `product_type=null` 레거시 제품 → 필터에서 포함됨(FINISHED 취급) → 서버 검증에서도 null은 RAW/SUB 아님 → 통과.
- 시나리오 3: RAW 제품이 화면에서 사라졌는지 확인 → 필터로 products 배열에서 제거.
- 시나리오 4: RAW 제품 바코드 스캔 → productMap에 키 없음 → `filteredProducts.length === 0` → "해당 제품이 없습니다" alert.
- 시나리오 5: (악의적·개발자도구 조작으로) RAW productId가 cart에 주입된 요청 → 서버 블록 → 한글 에러 반환, DB 무변경.
- 시나리오 6: 마이그 042 미적용 DB → 1차 select 에러 → 기존 컬럼 폴백 → 필터 스킵(전부 노출) + 서버 검증도 스킵. 기존 동작 그대로 유지.

### `npm run build` 통과
- 통과. 46 pages, 0 errors.

---

## 미해결 질문

1. **"⓪"/"①" 주석 번호 시프트**: 기존 주석 넘버링에 `⓪`을 새로 끼워넣는 대신 다른 스타일(예: `// [guard]`)이 선호되면 조정 가능. 기능적 영향 없음.

2. **폴백 시 완전 차단 vs 허용**: 마이그 042 미적용 환경에서는 현재 클라이언트·서버 모두 RAW/SUB 노출/저장을 허용(운영 차단 방지). 042는 이미 스키마 덤프에 존재하므로 실무상 차단이 안전할 수 있지만, Brief가 "현행 기본값과 부합"을 강조하여 폴백 관대 유지. 엄격 차단이 필요하면 지시 요청.

3. **이중 주입 공격 경로**: `processPosCheckout` 외 POS 판매 트랜잭션을 트리거하는 경로는 Grep 결과 확인되지 않음(actions.ts:processPosCheckout만 sales_order_items insert). `return-actions.ts`의 환불은 이미 존재 주문 기반이라 스코프 외. 놓친 경로 있으면 지적 요청.

---

## 건드리지 않은 것 (Brief §건드리지 말 것 재확인)

- 제품 관리 화면(`/products`) — RAW/SUB 등록·조회 유지
- 재고 화면(Step 2 가드 이미 적용)
- 생산·매입·BOM 화면
- POS의 담당자/매출처/결제/배송 로직 — 제품 필터에만 집중
- `isMaterialType` 등 헬퍼 신규 작성 없음(인라인 조건만 사용)

---

Ready for Review: YES
