# Architect Brief

*Arch writes. Bob reads.*

---

## Step 4 — POS 판매 등록: 완제품만 노출

### 배경

POS 판매 등록 화면의 제품 그리드·바코드 검색에 **원자재(RAW)·부자재(SUB)**도 함께 노출됨. Step 2(dee1300)에서 재고 화면의 RAW/SUB 입출고를 본사로 제한했지만, POS 판매 흐름은 미조치 상태. OEM 위탁 생산 모델에서 **판매 대상은 완제품(FINISHED)뿐**이므로 실수로 원자재가 판매 항목으로 찍히는 것을 막아야 함.

### 목표

POS 판매 등록 화면에서 `product_type ∈ {RAW, SUB}` 제품은 **UI 어디서도 선택 불가**:
- 제품 그리드(타일 목록)에서 노출 금지
- 제품명/코드 검색 결과에서 제외
- 바코드 스캔 시 RAW/SUB 바코드는 "판매 불가 제품" 안내와 함께 장바구니 추가 거부
- productMap(바코드/코드 hash)에서도 제외하여 Enter 매칭 차단

기존에 이미 등록된 RAW/SUB 제품 데이터는 불변. 필터만 추가.

### 아키텍처 원칙

- 클라이언트(POS page.tsx) 필터링으로 충분. 서버 액션 createSalesOrder 레벨의 방어 검증은 **선택** — 스코프에 포함 (신뢰 경계 원칙)
- `product_type` 컬럼 null인 레거시 데이터는 완제품으로 간주(`!== 'RAW' && !== 'SUB'`) — 현행 기본값과 부합

### 건드릴 파일

- `src/app/(dashboard)/pos/page.tsx` — 제품 로드 직후 필터링 + productMap 구성에서 RAW/SUB 제외 + 바코드 입력 방어(필터링된 products로 productMap 만들면 자동 처리, 추가 체크 불필요)
- `src/lib/actions.ts` 또는 POS 결제 서버 액션 — **서버 측 방어**: `createSalesOrder`가 RAW/SUB 제품 id를 받으면 거부 (Grep으로 정확한 함수 위치 확인 필요)

### 결정 — UX

- RAW/SUB가 제품 그리드/검색 결과에 **아예 보이지 않음** (별도 배지·토글 없이 숨김)
- 바코드 스캔으로 RAW/SUB 매칭 시도 시: 제품 grid에 없는 상태이므로 `productMap` 실패 → 이미 존재하는 "제품을 찾을 수 없습니다" 계열 UX가 자연 발동. 별도 메시지 불필요.
- 서버 거부 시 메시지: "판매 가능한 제품이 아닙니다." (한글, 시스템 용어 노출 금지)

### Flag (추측 금지)

- `products.product_type` 값은 `'FINISHED' | 'RAW' | 'SUB'` 세 가지 (null은 레거시 → FINISHED 취급)
- POS 제품 로드 쿼리는 현재 `supabase.from('products').select('id, name, code, barcode, price, unit').eq('is_active', true).order('name')` (pos/page.tsx:274 부근). 여기서 `product_type`을 select에 **추가**하고 in-memory 필터 `p.product_type !== 'RAW' && p.product_type !== 'SUB'` 적용
- 재고 화면에 쓰는 `isMaterialType` 같은 헬퍼는 **POS 페이지에 재정의하지 말고** 인라인 조건으로 처리 (스코프 최소화)
- 마이그 042 미적용 DB에서는 `product_type` 컬럼이 없을 수 있음 — select 실패 시 기존 폴백 select로 재시도(컬럼 없이) + 필터 스킵 (기존 패턴 존재 확인)
- 서버 액션에서 RAW/SUB 거부 검증은 `sales_order_items`에 넣을 제품들의 `product_type`을 한 번에 조회(`SELECT product_type FROM products WHERE id IN (...)`) 후 하나라도 RAW/SUB면 에러 반환

### 건드리지 말 것

- 제품 관리 화면(`/products`) — RAW/SUB 제품 등록·조회는 유지 (재고·BOM 관리용)
- 재고 화면 — Step 2에서 이미 가드 적용
- 생산·매입·BOM 화면 — RAW/SUB 사용처
- POS의 담당자/매출처/결제/배송 로직 — 제품 필터에만 집중

### Self-review 체크리스트

- [ ] `pos/page.tsx` 제품 로드 쿼리에 `product_type` 포함 (마이그 042 폴백 유지)
- [ ] RAW/SUB 제품이 그리드 `productList` 렌더링에서 제외되는가?
- [ ] 검색 결과(`searchResults` 계산)에 RAW/SUB 제외되는가?
- [ ] `productMap`(바코드/코드 조회)에 RAW/SUB 제외되는가?
- [ ] 서버 액션(createSalesOrder/POS 주문 생성 경로)에 RAW/SUB 거부 추가되었는가?
- [ ] 에러 메시지는 한글·시스템 용어 숨김?
- [ ] 기존 완제품 판매 흐름이 영향 없는지 수동 검증 시나리오 기록
- [ ] `npm run build` 통과

### Out of scope (BUILD-LOG Known Gaps)

- 제품 관리 화면의 RAW/SUB UX 개선 (별도 건)
- product_type 마이그 042 적용 여부 검증 — 이미 스키마 덤프에서 컬럼 존재 확인됨

### Ready for Bob: YES
