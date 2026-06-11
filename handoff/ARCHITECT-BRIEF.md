# Architect Brief — Step 1 of 3: 수령 전 전표 품목 추가/삭제 (서버액션 + 드로어 UI)

> 이 스프린트는 신규 작업이다. 이전 핸드오프 파일(레거시 정규화)은 무시.
> 전체 3스텝 계획 — **이번 PR은 Step 1만**:
> - **Step 1 (지금)**: 품목 추가/삭제 서버액션 2개 + 공용 재계산 헬퍼 + 드로어 UI. shipments는 건드리지 않음.
> - Step 2 (다음): 품목 단위 delivery_type 전환 + 주문 receipt_status 재집계.
> - Step 3 (다음): 방문↔택배 양방향 전환 = shipment 생성/void + 수령자·주소 입력.

## Goal
SalesDetailDrawer에서, status=COMPLETED 이고 **수령 전(order.receipt_status !== 'RECEIVED')** 인 전표에 한해 품목을 추가/삭제할 수 있고, 그 즉시 total_amount·적립포인트·재고·매출분개·과세스냅샷이 자동 재계산되어 일관성이 유지된다.

## Build Order

### A. 신규 파일 `src/lib/sales-revise-actions.ts` (`'use server'`)
참조 패턴: `processPosCheckout`(src/lib/actions.ts L1975~) 재고차감·포인트·과세스냅샷·분개, `cancelSalesOrder`(src/lib/sales-cancel-actions.ts) 역분개·재고복원·포인트환원. 두 파일의 컬럼-누락 방어 패턴(optionalKeys 제거 후 재시도)을 신규 액션에도 동일 적용.

공통 가드(두 액션 공유 헬퍼로):
- `requireSession()` → 실패 시 `{ error }`.
- 주문 fetch: `sales_orders` + `order_items:sales_order_items(*)` + `branch:branches(id,name,code)`.
- 차단: `order.status !== 'COMPLETED'` → error. `order.receipt_status === 'RECEIVED'` (수령완료) → error('수령 완료된 전표는 수정할 수 없습니다.'). receipt_status가 null/없음도 RECEIVED로 간주(=수정 불가) — 마이그 051 미적용 레거시 안전.
- 출고/재고 지점: shipments가 있으면 `shipments.branch_id`(출고지점), 없으면 `order.branch_id`. 이번 Step은 단순화 위해 **`order.branch_id` 기준으로 재고 차감/복원**하되, shipment.branch_id가 order.branch_id와 다르면 그 값을 우선. (processPosCheckout의 stockBranchId 의미와 일치시킬 것.)

#### `addSalesOrderItem(params: { orderId, productId, quantity, unitPrice, discount?, orderOption?, deliveryType? })`
1. 가드 통과.
2. product 조회로 `is_taxable`·`product_type`·`track_inventory`·`is_phantom` 확보(processPosCheckout ⓪ 폴백 그대로). RAW/SUB 거부.
3. `sales_order_items` insert: total_price = unitPrice*qty - (discount||0). delivery_type 미지정이면 'PICKUP'. item receipt_status는 deliveryType 매핑(PARCEL→PARCEL_PLANNED, QUICK→QUICK_PLANNED, PICKUP→RECEIVED) — processPosCheckout ③ 규칙 동일. optional 컬럼 방어.
4. 재고 차감: track_inventory=false면 skip. phantom이면 BOM 분해 차감(processPosCheckout ④ decrementStock 로직 재사용 — 같은 파일에 헬퍼 복제 가능). movement reference_type='SALE_REVISE_ADD', reference_id=order.id.
5. 주문 재계산 호출(아래 헬퍼).
6. revalidate + audit log('UPDATE', sales_orders) + `{ success, ... }`.

#### `removeSalesOrderItem(params: { orderId, itemId })`
1. 가드 통과 + item이 이 주문 소속인지 확인.
2. **삭제 안전장치**: 그 item.receipt_status === 'RECEIVED' 이면 거부('이미 수령된 품목은 삭제할 수 없습니다.'). 마지막 1개 품목 삭제도 거부('전표의 마지막 품목은 삭제할 수 없습니다. 판매 취소를 사용하세요.').
3. 재고 복원: track/phantom 동일 분기, movement_type='IN', reference_type='SALE_REVISE_REMOVE'. (cancelSalesOrder 2번 패턴.)
4. `sales_order_items` delete by id.
5. 주문 재계산 호출.
6. revalidate + audit + return.

#### 공용 헬퍼 `recalcSalesOrderTotals(db, order)` — **이 Step의 핵심**
삭제/추가 후 남은 items를 다시 읽어 재계산:
- 새 totalAmount = Σ(unit_price*quantity) (할인 전 총액 — `sales_orders.total_amount` 의미와 일치). discount_amount는 기존 주문값 유지(품목 추가/삭제로 주문할인 재배분은 **이번 범위 밖** → BUILD-LOG Known Gap).
- finalAmount = totalAmount - discount_amount - points_used. (음수 방지)
- 과세/면세/VAT 스냅샷 재계산: processPosCheckout L2078~ 비례배분 로직 그대로 (item별 is_taxable 조회). 컬럼 누락 폴백.
- 적립포인트 재계산: order.customer_id 있으면 `floor(finalAmount * point_rate_applied / 100)`. point_rate_applied 없으면 1.0. **차액만 point_history에 adjust로 기록** (newEarned - order.points_earned). type='adjust', balance=직전balance+diff, description=`전표 수정 적립 조정 (order_number)`.
- `sales_orders` update: total_amount, taxable_amount, exempt_amount, vat_amount, points_earned. optional 컬럼 방어.

#### 결제 차액 기록 (sales_order_payments)
- 재계산 전후 finalAmount 차이 `delta = newFinal - oldFinal`.
- delta ≠ 0 이면 `sales_order_payments` insert 1행: payment_method = order의 대표 결제수단(없으면 'cash'), amount = delta (추가결제 +, 부분환불 −), memo = `전표 수정 자동 ${delta>0?'추가결제':'부분환불'} (단말기 별도처리 필요)`, created_by=session.id. optional 컬럼 방어.
- **PG/카드 연동 없음** — DB 기록만. UI가 "단말기에서 별도 처리" 안내.

#### 매출 분개 재계산 (cancelSalesOrder 5번 패턴 차용)
- 기존 SALE 분개를 역분개 후 새 금액으로 재분개하지 말고, **차액분만 추가 분개**한다(단순·안전): `createSaleJournal({ orderId, orderNumber: 'REVISE-'+order_number, orderDate: kstTodayString(), totalAmount: deltaFinal, taxableAmount: deltaTaxable, paymentMethod, cogs:0, sourceType:'SALE_REVISE', createdBy })`. delta=0이면 skip.
- Flag: `createSaleJournal`의 `sourceType`에 'SALE_REVISE' 신규 값이 들어간다 — accounting-actions.ts에서 해당 sourceType이 분기 처리되는지 grep 확인하고, 미지원이면 'SALE'로 폴백(금액이 delta이므로 부호로 충분). try/catch로 감싸 분개 실패는 경고만(cancelSalesOrder 동일).

### B. 드로어 UI — `src/app/(dashboard)/pos/SalesListTab.tsx` (SalesDetailDrawer, L1045~)
- 새 import: `addSalesOrderItem`, `removeSalesOrderItem` from `@/lib/sales-revise-actions`.
- `const editable = order?.status === 'COMPLETED' && order?.receipt_status && order.receipt_status !== 'RECEIVED';`
- 품목 테이블(L1541~)에서 `editable` 일 때:
  - 각 행에 '🗑 삭제' 버튼 추가(품목 receipt_status==='RECEIVED'인 행은 숨김, 마지막 1행도 비활성). 클릭 → confirm → removeSalesOrderItem → 성공 시 드로어 데이터 재조회(loadDetail 재호출) + onChanged().
  - 품목 테이블 하단에 '+ 품목 추가' 인라인 폼 또는 작은 모달: 제품 선택(기존 POS 제품검색 컴포넌트 재사용 가능하면 사용, 아니면 최소 입력=제품ID/명·수량·단가·옵션·배송방식 PICKUP기본). 추가 → addSalesOrderItem → 재조회 + onChanged().
  - Flag: 제품 검색 UI가 무겁다면 Bob 임의 신설 금지. **이미 POS 체크아웃 탭에 있는 제품검색/선택 컴포넌트를 grep해서 재사용**할 것. 재사용이 어려우면 '수량+단가+제품명 수동입력'이 아니라 productId가 필요하므로, 최소한 제품 셀렉트(활성제품 목록 fetch)로 구현.
- 차액 안내: 추가/삭제 성공 후 응답의 delta가 있으면 `alert`로 "결제 차액 ₩X 가 기록되었습니다. 카드/단말기 정산은 별도로 처리하세요." 노출.
- 기존 markReceiptCompleted/revertReceiptStatus/changeDeliveryType/markItemReceived 로직은 **건드리지 말 것**.

### C. AI Sync 점검 (CLAUDE.md 절대규칙)
- 신규 reference_type 값 'SALE_REVISE_ADD'/'SALE_REVISE_REMOVE'(inventory_movements), 신규 sourceType 'SALE_REVISE'(journal), point_history 'adjust' 사유 추가 → `src/lib/ai/schema.ts`의 BUSINESS_RULES에 "전표 수정(수령 전 품목 추가/삭제)" 한 줄 + 해당 reference_type/sourceType 열거에 추가. DB_SCHEMA 컬럼 변경은 없음(기존 테이블만 사용).
- 신규 서버액션은 화면 전용 — 에이전트 tools.ts 도구 추가는 **하지 않음**(이번 범위 밖, BUILD-LOG Known Gap 기록).

## Out of Scope (건드리면 BUILD-LOG Known Gaps行)
- shipments 생성/void, 방문↔택배 양방향 전환 (Step 3).
- 품목 delivery_type 전환 (Step 2).
- 주문 할인(discount_amount) 재배분 — 추가/삭제 시 기존값 유지.
- 실제 PG/카드 취소·추가승인 — DB 기록 + 수기 안내만.
- 에이전트 tools.ts 신규 도구.
- 동시 편집 락(낙관적 동시성) — 단일 사용자 가정.

## Acceptance
1. `npm run build` 에러/경고 0.
2. 수령완료(RECEIVED) 또는 status≠COMPLETED 전표: 추가/삭제 버튼 미노출 + 액션 직접호출 시 서버가 거부.
3. 수령 전 전표에 품목 추가: items 증가, total_amount/taxable/vat/points_earned 갱신, inventory_movements OUT 1건(또는 phantom 분해), sales_order_payments 추가결제 1행, journal delta 분개 1건.
4. 품목 삭제: 역방향 동일(IN/부분환불/역분개 delta). 수령된 품목·마지막 품목 삭제 거부.
5. 차액 0 케이스(예: 0원 품목)에서 payment/journal 행 미생성.
6. 마이그 051/052/058 미적용 환경에서도 컬럼-누락 방어로 크래시 없이 동작.

---

## Step 1 — AMENDMENT (Arch, 2026-06-11) — 리뷰 Must Fix 대응

**결정: Option B (제약 완화). 부호 보존(음수=환불).**
근거: `SalesListTab.tsx:1513-1514`가 `totalPaid = Σ amount`로 "미결제 잔액(외상)"을 계산하는 유일한 합산 소비자다. 환불을 abs로 저장하면 totalPaid가 부풀어 remaining이 잘못 줄어든다(고객이 더 낸 것처럼 보임). 음수 행이 이 리더 모델에 정확히 맞다. `amount`를 표시만 하는 곳(L1837)은 음수도 그대로 출력되어 환불이 음수로 보이는 게 의미상 옳다. 따라서 부호 보존이 정답이고, 045의 `amount>=0`만 막던 것이므로 제약을 제거한다.

**마이그레이션은 Arch가 작성 완료 — Bob은 건드리지 말 것:**
`supabase/migrations/078_sales_payments_allow_refund.sql` — (1) `amount>=0` 제약 제거, (2) child CHECK에 'mixed' 추가. (Arch가 Supabase 적용까지 책임.)

**Bob 코드 수정 (`src/lib/sales-revise-actions.ts` recordPaymentDelta ~L295):**
1. `amount`는 부호 보존 — **abs 쓰지 말 것.** `amount: deltaFinal`(음수 그대로) 유지.
2. **조용한 실패 제거(차단 핵심)**: insert 실패 시 `console.error`만 하고 넘기지 말 것. recordPaymentDelta가 실패를 호출자에게 전파하도록 변경 — 에러 시 throw하거나 `{ error }` 반환하고, addSalesOrderItem/removeSalesOrderItem이 이를 받아 사용자에게 `{ error: '결제 차액 기록 실패: ...' }` 반환. (재고·분개는 이미 조정됐는데 결제장부만 누락되는 정합성 깨짐을 막는 게 이 Must Fix의 본질.)
   - 단, `isMissingColumnError`(42703) 폴백 재시도는 유지(레거시 컬럼 누락 방어). 그 외 에러(특히 23514 제약위반)는 마이그 078 적용 후엔 발생하지 않아야 하나, 발생 시 **반드시 호출자로 전파.**
3. **대표 결제수단 폴백**: `payment_method`로 order의 대표 결제수단을 넣되, 045 child CHECK는 ('cash','card','card_keyin','kakao','credit','cod','mixed') — 078로 'mixed' 허용됨. order.payment_method가 이 목록 밖(null/undefined)이면 'cash'로 폴백. order.payment_method가 'mixed'면 'mixed' 그대로 넣어도 078 후 통과(Open Question 2: 회계 분개 수금계정은 별개로 현금귀속 단순화 유지 — 이번 범위 밖, BUILD-LOG Known Gap).

**AI Sync 추가**: `src/lib/ai/schema.ts` L72-73 sales_order_payments 주석에 "amount 음수=환불(전표 수정 부분환불), Σ amount=순수금액" 한 줄 추가. payment_method enum에 'mixed' 포함 반영.

**Acceptance 보강:**
- 품목 삭제로 부분환불 발생 시 `sales_order_payments`에 **음수** amount 1행 생성, insert 성공. 마이그 078 미적용 환경에서 23514 발생 시 액션이 `{ error }` 반환(조용한 실패 없음).
- mixed 원주문 수정 시 payment_method='mixed' 행 insert 통과.
