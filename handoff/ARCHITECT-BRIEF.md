# Architect Brief — Step 2 (병합): 방문(PICKUP) ↔ 택배(PARCEL) 양방향 전환

> 이전 3스텝 계획의 **Step 2 + Step 3 을 하나의 배포 단위로 병합**한다.
> 근거: 품목 delivery_type만 바꾸고 shipment를 안 만들면 "택배예정인데 송장 발행할 배송레코드가 없는" 깨진 반쪽 상태가 된다. 사용자 핵심요구("방문↔택배 전환")는 shipment 생성/삭제가 같이 들어와야 비로소 진짜 기능이 된다. 따라서 thin Step 2 단독배포는 하지 않고 병합한다.
> Step 1(품목 추가/삭제 + 재정산)은 커밋 59658d9 배포 완료. 이 Step은 그 위에 delivery_type 전환을 얹는다.

## Goal
SalesDetailDrawer에서, 수정 가능 전표(status=COMPLETED AND receipt_status≠RECEIVED)에 한해 전표의 배송방식을 **방문→택배 / 택배→방문** 양방향으로 전환할 수 있다. 전환 시 (1) 품목 delivery_type·receipt_status 일괄 변경, (2) 주문 receipt_status 재집계, (3) shipment 레코드 생성(방문→택배, 수령자/주소 입력) 또는 삭제(택배→방문)가 원자적으로 처리된다. 금액 변동 없음(배송비 라인 없음).

## 잠긴 결정 (Locked)

### 수정 게이트 — Step 1과 동일
- 서버: `loadEditableOrder`(sales-revise-actions.ts L36) 그대로 재사용. status≠COMPLETED 또는 receipt_status∈{RECEIVED, null} → 거부.
- UI: 기존 `editable` 계산(Step 1에서 추가됨) 그대로 사용. 전환 버튼은 editable일 때만 노출.

### 금액 정책 — 변동 없음 (확정)
- 방문↔택배 전환은 **배송비 라인을 추가/제거하지 않는다.** 이 시스템엔 배송비 품목 개념이 없고(택배 주문도 배송비 0), 전환은 "배송 모드"만 바꾼다.
- 따라서 total_amount/VAT/포인트/sales_order_payments/매출분개 **전부 미변경.** delta=0. Step 1의 recalc/payment/journal 경로는 이 Step에서 **호출하지 않는다.** (품목 가격이 안 바뀌므로 재정산 불필요.)
- recipient_*/주소만 신규 입력받아 shipment에 저장.

### 방향 1 — 방문(PICKUP) → 택배(PARCEL)
1. 입력 필요: recipient_name, recipient_phone, recipient_address (NOT NULL 3종 필수). recipient_zipcode/recipient_address_detail/delivery_message는 선택. 고객 연결돼 있으면 customers.name/phone/address를 prefill 기본값으로(UI 단). 미입력 필수값 있으면 거부.
2. 품목 update: 대상 품목들(현재 PICKUP) `delivery_type='PARCEL'`, `receipt_status='PARCEL_PLANNED'`, `receipt_date=null`. 이미 RECEIVED인 품목은 **건드리지 않음**(수령 끝난 품목 보존).
3. shipment 생성: **이미 shipment가 있으면 생성하지 않고** delivery_type만 'PARCEL'로 update + 수령자/주소 update(택배→퀵 등 이전 전환 잔존 대비). 없으면 신규 insert.
   - insert payload는 processPosCheckout ②-b(actions.ts L2224~)와 동일 구조·동일 폴백(050/046 미적용 컬럼 제거 후 재시도). source='STORE', sales_order_id=order.id, branch_id=resolveStockBranchId(order), sender_name/phone=출고지점 또는 ''(NOT NULL 방어), status='PENDING', delivery_type='PARCEL', created_by=session.id, items_summary=PARCEL 대상 품목 요약.
4. 주문 receipt_status 재집계(아래 규칙).

### 방향 2 — 택배(PARCEL) → 방문(PICKUP)
1. **shipment 가드(핵심 안전장치)**: 기존 shipment.status가 **'PENDING'이 아니면 거부.**
   - 근거: shipments.status enum = PENDING/PRINTED/SHIPPED/DELIVERED (마이그 012, CANCELLED 없음). PRINTED=송장 발행됨, SHIPPED=택배사 인계, DELIVERED=배송완료. 송장이 발행됐거나(PRINTED+) 발송된 건은 방문전환 불가 — `'이미 송장이 발행/발송된 배송은 방문 수령으로 전환할 수 없습니다. 배송을 먼저 취소/회수하세요.'`
   - PENDING(송장 미발행)만 안전하게 void 가능.
2. shipment void = **DELETE row** (soft-cancel 상태값이 enum에 없으므로 신규 마이그 없이 하드 삭제). `db.from('shipments').delete().eq('id', shipment.id)`. shipment 없으면 skip(이미 방문).
3. 품목 update: 대상 품목들(현재 PARCEL/QUICK) `delivery_type='PICKUP'`, `receipt_status='RECEIVED'`(방문은 즉시수령 의미 — processPosCheckout ③ 규칙 PICKUP→RECEIVED 일치), `receipt_date=kstTodayString()`. 단 이미 RECEIVED 품목은 그대로.
4. 주문 receipt_status 재집계.

### 주문 receipt_status 재집계 규칙 (혼합 delivery_type 대응)
품목 update 후 남은 전체 품목을 다시 읽어 도출:
- 모든 품목이 RECEIVED → 주문 'RECEIVED', receipt_date=오늘.
- 하나라도 PARCEL_PLANNED 존재 → 'PARCEL_PLANNED'.
- (PARCEL 없고) QUICK_PLANNED 존재 → 'QUICK_PLANNED'.
- (위 모두 없고) PICKUP_PLANNED 존재 → 'PICKUP_PLANNED'.
- 우선순위: PARCEL_PLANNED > QUICK_PLANNED > PICKUP_PLANNED > (전부 RECEIVED면 RECEIVED).
- receipt_date: RECEIVED로 갈 때만 오늘, 그 외 null.
- Flag: 이 도출 로직을 **헬퍼 1개로** 추출(`deriveOrderReceiptStatus(items): {status, receiptDate}`). 기존 markItemReceived(L1129)의 allDone 판정과 의미 일치시킬 것.

### 재사용 — 중복 금지
- 서버: `loadEditableOrder`, `isMissingColumnError`, `resolveStockBranchId` (sales-revise-actions.ts) 그대로 재사용. recalc/payment/journal은 **호출 안 함**(금액 불변).
- shipment insert 폴백 로직은 processPosCheckout ②-b 패턴을 신규 액션에 **복제**(현재 그 코드는 actions.ts 내부 인라인이라 export 안 됨 — 복제가 안전, 추출 리팩터는 범위 밖).
- UI: 기존 `changeDeliveryType`(L1304, PARCEL↔QUICK 전용)은 **건드리지 말 것.** 신규 전환은 별도 핸들러. markReceiptCompleted/revertReceiptStatus/markItemReceived/revertItemReceived 전부 미접촉.

## Build Order

### A. 서버액션 `src/lib/sales-revise-actions.ts` (기존 파일에 추가)
신규 export 2개:
- `convertOrderToParcel(params: { orderId, recipient: { name, phone, address, zipcode?, addressDetail?, message? } })`
  1. requireSession → loadEditableOrder 가드.
  2. recipient name/phone/address 필수 검증 → 미충족 시 `{ error }`.
  3. PICKUP/미수령 품목 → PARCEL/PARCEL_PLANNED update(RECEIVED 품목 제외). optional 컬럼(delivery_type/receipt_status/receipt_date) 누락 폴백.
  4. shipment upsert: 기존 있으면 update(delivery_type=PARCEL + 수령자/주소), 없으면 insert(processPosCheckout ②-b 폴백 복제).
  5. 주문 receipt_status 재집계 update(deriveOrderReceiptStatus).
  6. revalidatePath + writeAuditLog('UPDATE','sales_orders') + `{ success }`.
- `convertOrderToPickup(params: { orderId })`
  1. requireSession → loadEditableOrder 가드.
  2. shipment 조회 → 있으면 status≠'PENDING' 시 `{ error }`(송장발행/발송 가드). PENDING이면 DELETE.
  3. PARCEL/QUICK/미수령 품목 → PICKUP/RECEIVED/오늘 update(이미 RECEIVED 보존). optional 폴백.
  4. 주문 receipt_status 재집계 update.
  5. revalidate + audit + `{ success }`.
- 신규 헬퍼 `deriveOrderReceiptStatus(items)` — 위 우선순위 규칙.

### B. 드로어 UI `src/app/(dashboard)/pos/SalesListTab.tsx`
- import: convertOrderToParcel, convertOrderToPickup.
- editable일 때 배송 정보 영역에 전환 버튼 노출:
  - 현재 방문 성격(shipment 없음 또는 전 품목 PICKUP/RECEIVED-without-shipment)이면 **'택배로 전환'** 버튼 → 인라인 폼(수령자명/연락처/주소 필수 + 우편번호/상세/메시지 선택, 고객 정보 prefill) → confirm → convertOrderToParcel → 성공 시 loadDetail(true) 재조회 + onChanged().
  - 현재 택배 성격(shipment 존재)이면 **'방문 수령으로 전환'** 버튼 → confirm('배송 레코드가 삭제되고 방문 수령으로 전환됩니다.') → convertOrderToPickup → 성공/실패 alert. shipment.status≠PENDING이면 서버가 거부 → 그 에러 alert 그대로 노출.
  - 버튼 노출 판정은 shipment 존재 여부 기준(있으면 방문전환 버튼, 없으면 택배전환 버튼). 둘 다 editable 게이트 안.
- Flag: 신규 인라인 폼은 Step 1의 '+ 품목 추가' 폼 스타일을 따를 것(새 모달 신설 금지).

### C. AI Sync (CLAUDE.md 절대규칙)
- DB_SCHEMA 컬럼 변경 없음(기존 테이블만). 신규 마이그 없음.
- BUSINESS_RULES sales_orders/shipments 섹션에 "전표 배송전환(방문↔택배): PICKUP→PARCEL은 shipment 생성·품목 PARCEL_PLANNED, PARCEL→PICKUP은 shipment가 PENDING일 때만 삭제·품목 RECEIVED. 금액 불변. receipt_status는 품목 우선순위(PARCEL>QUICK>PICKUP>전부RECEIVED)로 재집계." 1~2줄 추가.
- tools.ts 에이전트 도구 추가 안 함(화면 전용, BUILD-LOG Known Gap).

## Out of Scope (→ BUILD-LOG Known Gaps)
- 품목 **단건** delivery_type 전환(주문 단위 전체 전환만). 혼합은 재집계로 표현되지만 단건 토글 UI는 범위 밖.
- 배송비 과금(전환 시 금액 변동) — 정책상 0, 변동 없음.
- shipments에 CANCELLED 상태 추가(soft-cancel) — 하드 DELETE로 처리, 신규 마이그 회피.
- PRINTED/SHIPPED 건의 송장 회수·재배송 워크플로 — 가드로 차단만.
- changeDeliveryType(PARCEL↔QUICK) 통합 — 별도 유지.
- 에이전트 tools.ts 도구.

## Acceptance
1. `npm run build` 에러/경고 0.
2. RECEIVED 또는 status≠COMPLETED 전표: 전환 버튼 미노출 + 액션 직접호출 시 서버 거부.
3. 방문 전표 → '택배로 전환'(수령자/주소 입력): shipments 1행 생성(status PENDING, delivery_type PARCEL), 품목 PARCEL_PLANNED, 주문 PARCEL_PLANNED. 금액·포인트·payments·journal 변동 0.
4. 택배 전표(shipment PENDING) → '방문 전환': shipments 행 삭제, 품목 RECEIVED(receipt_date 오늘), 주문 재집계(전부 RECEIVED면 RECEIVED). 금액 변동 0.
5. 택배 전표지만 shipment.status='PRINTED'/'SHIPPED'/'DELIVERED' → 방문 전환 거부('송장 발행/발송' 에러).
6. 혼합(일부 RECEIVED + 일부 PARCEL_PLANNED) 전표 재집계: PARCEL_PLANNED 우선으로 주문상태 도출, RECEIVED 품목은 전환 대상에서 제외·보존.
7. 마이그 050/052/046 미적용 환경에서도 컬럼-누락 폴백으로 크래시 없이 동작.
8. 필수 수령자 정보(name/phone/address) 누락 시 택배전환 거부.

## Builder Plan (Bob, 2026-06-12) — Arch confirmed via session 지시

확인 사실 (코드 조사):
- markItemReceived/changeDeliveryType/markReceiptCompleted/revertReceiptStatus 등은 **서버액션이 아니라 SalesListTab.tsx 내부 로컬 함수**(supabase client 직접 호출). 브리핑의 L1129/L1304는 이 컴포넌트 내부 라인. 이들 미접촉.
- processPosCheckout ②-b shipment insert 폴백은 src/lib/actions.ts L2215~2274(payloadFull→delivery_type 제거 재시도→sender_* 제거 payloadBase 재시도). 신규 액션에 복제.
- customers.address 컬럼 존재 → prefill용 lazy fetch 가능. 드로어 order.customer엔 name/phone만 로드됨.

빌드 항목:
A. src/lib/sales-revise-actions.ts 추가:
   - deriveOrderReceiptStatus(items) 헬퍼 (우선순위 PARCEL>QUICK>PICKUP>RECEIVED, receiptDate).
   - convertOrderToParcel({orderId, recipient}) — 가드→필수검증→품목 PARCEL_PLANNED(RECEIVED 제외, optional 폴백)→shipment upsert(있으면 update, 없으면 insert 폴백 복제)→주문 재집계→revalidate+audit.
   - convertOrderToPickup({orderId}) — 가드→shipment 조회(있으면 status≠PENDING 거부, PENDING이면 DELETE)→품목 PICKUP/RECEIVED/오늘(RECEIVED 제외, optional 폴백)→주문 재집계→revalidate+audit.
   - recalc/payment/journal 호출 안 함(delta=0).
B. SalesListTab.tsx:
   - import convertOrderToParcel/convertOrderToPickup.
   - 상태: showConvertForm + 수령자 입력 6필드 + converting + convert prefill lazy load(customer address).
   - shipment 존재 영역(L1888~) 헤더에 '🏠 방문 수령으로 전환' 버튼(editable 게이트 안) → confirm → convertOrderToPickup → 성공 loadDetail(true)+onChanged, 실패 alert(서버 가드 에러 노출).
   - shipment 없고 editable이면 배송 영역 자리에 '📦 택배로 전환' 버튼+인라인 폼(Step1 add-form 스타일) → confirm → convertOrderToParcel → loadDetail(true)+onChanged.
C. schema.ts BUSINESS_RULES에 배송전환 규칙 1~2줄.

불확실/결정: prefill address는 best-effort(없어도 진행). shipment-존재=택배전환버튼 / shipment-없음=택배전환버튼 판정 그대로.
