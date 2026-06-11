# Review Request — Step 1 (수령 전 전표 품목 추가/삭제)
Date: 2026-06-11
Ready for Review: YES

빌드: `npm run build` ✅ Compiled successfully, error/warning 0.

## AMENDMENT 적용 (2026-06-11) — 리뷰 Must Fix 1건 대응
Arch 결정 Option B(부호 보존, 마이그 078로 amount≥0 제약 제거 + 'mixed' 허용). 마이그 파일은 Arch 소유 — 미접촉.
- `src/lib/sales-revise-actions.ts:294-330` `recordPaymentDelta` 재작성:
  - amount **부호 보존**(음수=부분환불). abs 미사용.
  - **조용한 실패 제거**: insert 실패 시 `{ error }` 반환(전파). 42703(레거시 컬럼 누락)만 폴백 재시도, 그 외(23514 제약위반 포함) 삼키지 않음.
  - `paymentRecordMethod` 신규: child CHECK 허용목록(078 후 'mixed' 포함) 검증 → 'mixed'는 보존, null/목록밖만 'cash'. (분개용 `representativePaymentMethod`는 mixed→cash 단순화로 분리 유지.)
- `src/lib/sales-revise-actions.ts:419-420, 494-495` 두 호출부: `recordPaymentDelta` 에러 시 즉시 `{ error }` 반환(재고·분개 후 결제장부 누락 정합성 깨짐 차단).
- `src/lib/ai/schema.ts:74` sales_order_payments 주석: amount 음수=환불·Σ=순수금액·payment_method enum('mixed' 포함) 추가.

## Files Changed

### 1. `src/lib/sales-revise-actions.ts` (신규, 전체)
- L31-36 `isMissingColumnError` — 42703 / "column does not exist" 판별 헬퍼.
- L39-58 `loadEditableOrder` — 공통 가드: 주문 fetch + status===COMPLETED + receipt_status≠RECEIVED(null/없음도 차단) 검증.
- L62-70 `resolveStockBranchId` — shipment.branch_id가 order.branch_id와 다르면 우선, 없으면 order.branch_id.
- L73-107 `loadProductMeta` — 제품 name/is_taxable/product_type/track_inventory/is_phantom 조회(4단 폴백) + RAW/SUB 거부.
- L110-117 `loadPhantomBom` — phantom BOM 구성품 조회.
- L120-156 `adjustStock`/`applyStockForItem` — 재고 OUT/IN 증감 + inventory_movements 기록, phantom이면 BOM 분해(PHANTOM_DECOMPOSE), track=false면 skip.
- L186-292 `recalcSalesOrderTotals` — **핵심**: 남은 items 재조회 → total_amount(할인전)·과세/면세/VAT 비례배분 스냅샷·적립포인트 차액 adjust·sales_orders update(optional 컬럼 방어). deltaFinal/deltaTaxable 반환.
- L295-311 `recordPaymentDelta` — delta≠0이면 sales_order_payments 1행(+추가결제/−부분환불, 대표결제수단).
- L314-345 `recordJournalDelta` — delta≠0이면 createSaleJournal(sourceType='SALE_REVISE', orderNumber 'REVISE-...', try/catch 경고만).
- L350-426 `addSalesOrderItem` — 가드→제품메타(RAW/SUB·phantom BOM 없음 거부)→item insert(optional 방어)→재고 OUT→재계산→결제/분개 차액→audit→revalidate.
- L431-498 `removeSalesOrderItem` — 가드+소속확인+수령됨/마지막1개 삭제 거부→재고 IN→item delete→재계산→결제/분개 차액→audit→revalidate.

### 2. `src/app/(dashboard)/pos/SalesListTab.tsx`
- L11 — `addSalesOrderItem`, `removeSalesOrderItem` import.
- L1060-1070 — 품목 추가/삭제용 state(revising, showAddForm, productOptions, addProductId/Qty/Price/Option/DeliveryType).
- L1328-1410 — 기존 useEffect 데이터 로드를 `loadDetail = useCallback(showSpinner)`로 추출(추가/삭제 후 `loadDetail(false)` 재조회). useEffect는 `loadDetail(true)` 호출만.
- L1424-1487 — `editable`/`deletableCount` 계산 + `openAddForm`(활성제품 지연로드)/`handleAddItem`/`handleRemoveItem` 핸들러(차액 alert 포함).
- L1693-1701 — 품목 행 수령 셀에 '🗑 삭제' 버튼(editable & 미수령 행만, deletableCount≤1이면 비활성).
- L1717-1795 — 품목 테이블 하단 '+ 품목 추가' 인라인 폼(제품 셀렉트 + 수량/단가/배송/옵션 + 안내문 + 추가 버튼).

### 3. `src/lib/ai/schema.ts`
- sales_orders BUSINESS_RULES 섹션에 "전표 수정(수령 전 품목 추가/삭제)" 1줄 추가 — 신규 reference_type(SALE_REVISE_ADD/REMOVE)·sourceType(SALE_REVISE)·point_history adjust 사유 명시. DB_SCHEMA 컬럼 변경 없음.

## Self-review 답변
- **Richard가 먼저 지적할 것**: (a) recalc에 넘기는 `order`가 mutation 전 스냅샷인지 — 맞다(guard에서 insert/delete 이전에 fetch). (b) sourceType 'SALE_REVISE' 미지원 폴백 — createSaleJournal이 source_type를 free-text로 그대로 쓰고 분기 의존 없음을 grep 확인, 폴백 불필요(부호로 충분). (c) loadDetail 추출 후 stale-state guard 제거 — React가 언마운트 setState를 no-op 처리하므로 안전, 데드 active 플래그 제거.
- **Brief 요구사항**: A(액션2+헬퍼+결제/분개/포인트/재고) ✅, B(드로어 삭제버튼+추가폼+차액alert, 기존 수령로직 미접촉) ✅, C(schema.ts 동기화, tools.ts 미추가) ✅.
- **빈/실패 시 사용자 노출**: 모든 액션 에러는 한글 메시지로 `{ error }` 반환 → UI alert. raw DB 에러 비노출(품목 추가/삭제 실패는 일반화 문구).

## Open Questions
- 추가 폼의 단가 자동채움은 `addPrice === ''`일 때만(제품 변경 시 기존 입력 보존). 매번 덮어쓰길 원하면 변경 가능 — 현 동작 의도적.
- 결제 차액 기록 시 대표결제수단이 'mixed'/null이면 'cash'로 폴백(분개 수금계정 결정용). 분할결제 전표의 차액 귀속 방식은 단순화 — 의도 확인 바람.

## Out of Scope (BUILD-LOG Known Gaps)
- 주문 할인(discount_amount) 재배분 없음 — 기존값 유지(Project Owner 확정).
- shipments 생성/void·delivery_type 전환(Step 2/3), 동시편집 락, 실제 PG/카드 취소 자동화, 에이전트 tools.ts 도구 — 전부 미접촉.
