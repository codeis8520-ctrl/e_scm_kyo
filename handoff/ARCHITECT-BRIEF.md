# Architect Brief

*Arch writes. Bob reads.*

---

## Step 5 — B2B 납품 등록: 완제품만 노출

### 배경

Step 4(commit `cd75a6d`)에서 POS 판매 화면은 RAW/SUB 차단을 완료했지만, **B2B 납품 경로(`/trade` B2B 판매 탭)**는 동일 가드가 없다. Richard가 Step 4 리뷰에서 이를 Escalate:

> B2B 판매 경로(`src/lib/b2b-actions.ts` → `b2b_sales_orders` / `b2b_sales_order_items` insert at L193, L215)는 `processPosCheckout` 가드의 적용 범위 밖이다. OEM 위탁 생산 모델에서 B2B도 완제품 전용이라면 별도 Step으로 RAW/SUB 거부 블록을 추가해야 한다.

OEM 위탁 생산 모델에서 **B2B 납품 대상도 완제품(FINISHED)뿐**이므로 동일 정책을 적용.

### 목표

`/trade` B2B 판매 탭의 납품 등록 모달에서 `product_type ∈ {RAW, SUB}` 제품은 **선택 불가**:
- 제품 드롭다운(`<select>`)에서 노출 금지
- `createB2bSalesOrder` 서버 액션이 RAW/SUB productId 수신 시 한글 에러 반환 (insert 이전 DB 무변경)

### 건드릴 파일

- `src/app/(dashboard)/trade/B2bSalesTab.tsx` — L43 제품 로드 쿼리에 `product_type` 추가 + 마이그 042 폴백 + setProducts 전 RAW/SUB 필터
- `src/lib/b2b-actions.ts` — `createB2bSalesOrder` L157 부근(`sb` 생성 직후, partner 조회 이전)에 RAW/SUB 검증 블록 신설

### Flag (추측 금지)

- Step 4 POS 패턴 그대로 복사 (pos/page.tsx:274-301, actions.ts:1111-1122)
- 제품 로드: 1차 `select('id, name, code, price, product_type')` → error 시 2차 `select('id, name, code, price')` 폴백
- 필터: `p.product_type !== 'RAW' && p.product_type !== 'SUB'` (null은 레거시 FINISHED 취급)
- 서버 방어: `cart productId 중복 제거 → products.in('id', [...])` 한 번에 조회 → RAW/SUB 있으면 `{ error: '판매 가능한 제품이 아닙니다.' }` 반환
- 마이그 042 미적용 DB: 쿼리 에러 시 검증 스킵(운영 차단 방지)

### 결정 — UX

- 드롭다운에서 RAW/SUB 아예 보이지 않음
- 서버 거부 메시지: `"판매 가능한 제품이 아닙니다."` (Step 4와 동일 톤)

### 건드리지 말 것

- `getPartnerPrices`, `bulkUpsertPartnerPrices` 등 단가표 경로 — 정산/단가 관리는 RAW/SUB도 사용 가능 (BOM 단가 등)
- `settleB2bOrder`, `cancelB2bOrder` — 수금·취소는 이미 존재 주문 기반이라 스코프 외
- 분개 생성 로직(L241-280) — 회계 스코프
- `CreditTab.tsx`, `B2bPartnersTab.tsx` — 납품 등록 경로 아님

### Self-review 체크리스트

- [ ] `B2bSalesTab.tsx` 제품 로드 쿼리에 `product_type` 포함 (042 폴백)
- [ ] 납품 등록 모달의 제품 `<option>` 목록에서 RAW/SUB 제외
- [ ] `createB2bSalesOrder`에 서버 가드 추가 (insert 이전)
- [ ] 가드 위치: partner 조회·총액 계산 전에 조기 return
- [ ] 에러 메시지 한글, 시스템 용어 숨김
- [ ] `npm run build` 통과

### Ready for Bob: YES
