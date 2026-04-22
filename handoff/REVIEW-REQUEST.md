# Review Request — Step 5 (B2B 납품 등록: 완제품만 노출)

*Bob 작성. Richard 읽음.*

**Ready for Review: YES**
**Build**: `npm run build` 통과 (46 static pages, 0 errors)

---

## 개요

`/trade` B2B 판매 탭의 납품 등록에서 원자재(RAW)·부자재(SUB) 제품이 드롭다운·서버 insert에 끼지 않도록 클라이언트 필터 + 서버 액션 방어 추가. Step 4(POS)와 동일 패턴.

## 변경 파일 목록 (2개)

### 1. `src/app/(dashboard)/trade/B2bSalesTab.tsx` (L37-64 fetchData)

**변경 내용**:
- 제품 로드 쿼리를 `Promise.all`에서 분리 → 1차 `select('id, name, code, price, product_type')` → 에러 시 2차 `select('id, name, code, price')` 폴백
- 나머지(orders/partners/branches/summary)는 `Promise.all`로 병렬 유지
- `productsData = products.filter(p.product_type !== 'RAW' && p.product_type !== 'SUB')` 후 `setProducts(productsData)`
- null은 레거시 FINISHED 취급

**한 줄 요약**: 납품 등록 모달 `<option>` 렌더링이 필터된 `products` state 기반이라 드롭다운에서 RAW/SUB 자동 제외.

### 2. `src/lib/b2b-actions.ts` (L160-172 createB2bSalesOrder 앞단)

**변경 내용**:
- `requireSession` + `createClient` 직후, partner 조회 이전에 `⓪` 가드 블록 신설
- `params.items`의 productId 중복 제거 후 `products.in('id', [...])`로 한 번에 `product_type` 조회
- RAW/SUB 있으면 `{ error: '판매 가능한 제품이 아닙니다.' }` 즉시 반환
- 쿼리 에러 시 검증 스킵(마이그 042 미적용 폴백)

**한 줄 요약**: `b2b_sales_orders` insert(L206)·`b2b_sales_order_items` insert(L228) 이전 시점에서 DB 무변경 차단.

---

## Self-review 답변

### B2bSalesTab 제품 로드 쿼리에 `product_type` 포함 (042 폴백 유지)
- 1차 select에 `product_type` 추가, error 시 2차 select는 기존 컬럼 집합(`id, name, code, price`) 그대로. POS `pos/page.tsx:274-286` 패턴 동일.

### 납품 등록 모달 제품 `<option>` 목록에서 RAW/SUB 제외
- `B2bSalesForm`에 전달되는 `products` props는 `B2bSalesTab` state → 필터된 `productsData` 기반 → `<option>` map에서 자동 제외.

### `createB2bSalesOrder`에 서버 가드 추가 (insert 이전)
- L160 `sb` 생성 직후, partner 조회(L175) 이전에 배치. 총액 계산(L184)·전표번호 조립(L179)보다도 선행.

### 가드 위치: partner 조회·총액 계산 전에 조기 return
- 확인. `sb.from('b2b_sales_orders').insert(...)`(L206)·`sb.from('b2b_sales_order_items').insert(...)`(L228)·재고 차감(L231~)·분개 생성(L253~) 모두 가드 이후에만 실행.

### 에러 메시지 한글, 시스템 용어 숨김
- `"판매 가능한 제품이 아닙니다."` — Step 4와 동일 문구.

### `npm run build` 통과
- 통과. 46 pages, 0 errors, 5.3s compile.

---

## 수동 검증 시나리오

1. FINISHED 제품 납품 → 기존 로직 그대로 통과.
2. `product_type=null` 레거시 제품 → FINISHED 취급, 통과.
3. RAW 제품 드롭다운 → 아예 안 보임.
4. (악의적) RAW productId가 items에 주입 → 서버 가드가 한글 에러 반환, DB 무변경.
5. 마이그 042 미적용 DB → 1차 select 에러 → 기존 컬럼 폴백 + 서버 가드 스킵 → 기존 동작 유지.
6. 여러 품목 중 하나만 RAW → `find(RAW/SUB)` 매치 → 한 번에 전량 차단.

---

## 미해결 질문

1. **`getPartnerPrices` 경로는 스코프 외**: 거래처별 단가표는 RAW/SUB도 BOM 원가 관리용으로 등록 가능성 있어 Brief가 명시적으로 건드리지 말라 지정. 실무상 필요 없으면 후속 Step에서 단가표 화면도 필터링 검토 가능.

2. **B2B 수금·취소 경로**: `settleB2bOrder`, `cancelB2bOrder`는 이미 존재하는 주문을 대상으로 하므로 새 insert 없음 → 스코프 외.

---

## 건드리지 않은 것 (Brief §건드리지 말 것 재확인)

- `getPartnerPrices`, `bulkUpsertPartnerPrices` — 단가표 경로
- `settleB2bOrder`, `cancelB2bOrder` — 수금·취소
- 분개 생성 로직(L253~280)
- `CreditTab.tsx`, `B2bPartnersTab.tsx` — 납품 등록 경로 아님
- POS·재고·생산·매입·BOM 화면

---

Ready for Review: YES
