export const DB_SCHEMA = `
== 핵심 테이블 스키마 ==

--- 지점·제품·재고 ---
branches: id, name, code, channel(channels FK·기본 STORE/DEPT_STORE/ONLINE/EVENT, 코드관리에서 커스텀 채널 추가 가능), address, phone, is_active, is_headquarters, sort_order(정렬값, 기본999·작을수록 앞), sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail
  ※ channel 은 channels 테이블 FK(확장 가능). sales_orders.channel 도 마이그093에서 동일 channels FK 로 통일(이전 고정 CHECK 4값 제거) — 커스텀 채널 지점 판매 시 채널CHECK 위반 버그 해소.
  ※ sender_*: 택배 보내는분 정보 (대한통운 엑셀 임포트용). 미입력 시 sender_name←"경옥채 "+name, sender_phone←phone, sender_address←address 로 폴백.
products: id, name, code, barcode, unit, price(판매가), cost(원가), cost_source(MANUAL/BOM), product_type(FINISHED/RAW/SUB/SERVICE), track_inventory(bool), is_phantom(bool), pack_child_id(uuid|null), pack_child_qty(int|null), pos_widget(bool, POS 판매등록 위젯 그리드 노출 여부·검색 등록은 무관), allow_decimal_stock(bool, 마이그 087), is_active
  ※ allow_decimal_stock(마이그 087): true면 이 제품 재고를 소수(NUMERIC 4자리)로 차감·표시·조정 허용(예: 산삼/침향 base 환 단위 묶음 분해 차감). false면 정수만. phantom-BOM 분해 시 허용 material 은 BOM 분수 수량(예: 0.0333)을 반올림 없이 그대로 차감, 비허용은 Math.ceil.
  ※ pack_child_id / pack_child_qty (마이그 066): 박스 ↔ 소포장 수동 분해/재포장. 부모 SKU(박스) 가 자식 SKU(소포장)
    pack_child_qty 개를 담는다는 메타. 예: 침향 30(박스).pack_child_id=침향 10(소포장), pack_child_qty=3.
    재고 화면 "📦 분해/재포장" 버튼으로 사용자가 수동 호출 — reference_type='PACK_UNPACK' 으로 inventory_movements 기록.
    POS 자동 분해 X(자식·부모 각각 자기 재고로 판매). 부모는 일반 완제품 또는 Phantom(세트) 모두 허용:
      · 일반 부모: 부모 OUT/IN + 자식 IN/OUT (movements 2건)
      · Phantom 부모: 본인 재고 없음 → 자식 IN/OUT 1건만 기록, 부모 inventory 변화 없음.
  ※ product_type: FINISHED=완제품(POS 판매), RAW=원자재, SUB=부자재, SERVICE=무형상품(컨설팅·교육 등 POS 판매 가능, 재고 X)
  ※ track_inventory(마이그 059): false면 inventories/inventory_movements 미사용. SERVICE는 기본 false.
    POS·B2B·생산에서 재고 차감 분기에서 skip 대상.
  ※ is_phantom(마이그 061): true면 "세트 상품(Phantom BOM)" — POS 판매 시 본인 재고는 차감하지 않고
    product_bom에 등록된 구성품을 분해 차감(inventory_movements.reference_type='PHANTOM_DECOMPOSE').
    이카운트의 "세트상품/매핑상품" 개념. 옵션 SKU(예: "침향30환 +오)")를 별도 코드로 두면서 본품·옵션품 재고만 관리.
    is_phantom=true이면 track_inventory는 자동 false (UI에서 강제). BOM이 비어있으면 판매 거부.
  ※ barcode는 완제품에만 입력. RAW/SUB/SERVICE는 항상 NULL로 저장됨.
  ※ cost_source=BOM이면 완제품 cost는 BOM 합계에서 자동 산정(서버 액션). RAW/SUB는 판매가 미사용(price=cost로 동기화).
product_files: id, product_id, file_url, file_name, file_type(image/document), sort_order
inventories: id, branch_id, product_id, quantity, safety_stock  [UNIQUE(branch_id, product_id)]
  ※ quantity 음수 허용 (CHECK 제약 없음). 판매·생산 시 부족해도 차단하지 않고 마이너스로 차감, 입고/반품 시 누적 복원.
  ※ quantity·safety_stock 은 NUMERIC(14,4) (마이그 087) — REST 응답에서 JS 문자열로 옴. 산술·비교 전 반드시 숫자 변환(앱은 toNum 사용). 소수는 allow_decimal_stock=true 제품에만 발생.
inventory_movements: id, branch_id, product_id, movement_type(IN/OUT/ADJUST/TRANSFER/PRODUCTION), quantity(NUMERIC(14,4), 마이그 087·문자열 직렬화 주의), memo, created_at, usage_type_id(소모 사용유형 FK, reference_type=USAGE 일 때만 값 존재; 그 외 NULL), created_by(처리자 users FK, 마이그 095·NULL 허용; 재고 소모(USAGE) 등록 시 기록, 과거·자동생성분은 NULL)
  ※ reference_type(VARCHAR free-form): POS_SALE / ONLINE_SALE(자사몰 판매차감, reference_id=sales_order_items.id) / ONLINE_SALE_CANCEL·ONLINE_REFUND(자사몰 취소·전체환불 시 ONLINE_SALE 차감분 복원 IN, reference_id=sales_order_items.id, #48) / PHANTOM_DECOMPOSE / PACK_UNPACK / USAGE(재고 소모=로스·자가사용·시음용 등; 팬텀 품목 소모 시 base 자재로 분해 차감, 메모 "세트분해") / TRANSFER / SALE_CANCEL / CREDIT_CANCEL 등.
  ※ TRANSFER(지점이동, #31): 사용자가 이동일자를 직접 선택 가능 → created_at 이 곧 이동일자(삽입시각 아님). OUT 기록=출발(출고)일, IN 기록=도착예정일. 미입력 시 now(). 즉 이동 기록의 날짜 질의/집계는 created_at 기준이면 정확.
inventory_usage_types(마이그 079): id, code(UNIQUE), name, sort_order, is_system(true=삭제금지·비활성만), is_active
  ※ 재고 소모 사용유형 코드(로스/자가사용/시음용/기타). 판매 아님. 소모 기록은 inventory_movements.movement_type='OUT' + reference_type='USAGE' + usage_type_id.

--- 고객·CRM ---
customers: id, name, phone, phone2(제2 연락처(정규화)), email, grade(NORMAL/VIP/VVIP), primary_branch_id, address, health_note, is_active
  ※ 동명이인으로 쪼개진(1인 다번호) 고객 병합: merge_customers(대표,보조) RPC — 보조의 모든 참조(주문·구매·상담 등)를 대표로 이전 후 보조 삭제, 보조 번호는 대표 phone2 에 보존. UI: 고객 상세 "고객 병합". point_history balance 는 재계산 안 함.
customer_grades: code(NORMAL/VIP/VVIP), name, point_rate(1%/2%/3%), is_active
branch_point_rates(마이그 067): id, branch_id→branches, grade_id→customer_grades, point_rate(0~100), is_active. UNIQUE(branch_id, grade_id).
  ※ 지점×등급 적립율 오버라이드 매트릭스. (branch_id, grade_id) 행이 있고 is_active=true 면 그 point_rate, 없거나 비활성이면 customer_grades.point_rate 사용.
  ※ 적립율 결정 기준 지점은 sales_orders.branch_id(=구매 발생 지점). 고객의 primary_branch_id 와 무관.
  ※ 서버측 단일 진실원: src/lib/actions.ts → resolvePointRate(branchId, gradeCode). processPosCheckout 에서 호출.
customer_consultations: id, customer_id, consultation_type, content(JSONB), consulted_by, created_at
  ※ consultation_type='LEGACY': 외부 엑셀에서 임포트한 과거 상담. content={text, consulted_at, source:'legacy'}.
point_history: id, customer_id, sales_order_id, type(earn/use/adjust/expire), points, balance, description
  ※ 고객 현재 포인트 = point_history에서 해당 고객의 최신 balance 값
legacy_purchases(마이그 064+069): id, legacy_order_no(주문묶음=일자+순번+거래처코드), line_seq, customer_id, phone, ordered_at, channel_text(거래처명), branch_id, branch_code_raw(거래처코드 A0/B0/X7…), item_code(품목코드), item_text(품목명), option_text, quantity, unit_price_vat, supply_amount, vat_amount, discount_amount, total_amount(합계 VAT포함), staff_code, recipient_name/recipient_phone/recipient_address(선물배송 수령자), received_at(수령일자), payment_status, note, source_file, mapped_to_sales_order_id, metadata
  ※ 외부 엑셀(경옥채판매DATA)에서 임포트한 과거 구매 이력 보존. **라인아이템(품목) 단위 1행**. sales_orders와 완전 분리 — 매출/재고/회계 영향 없음.
  ※ 한 주문의 여러 품목은 legacy_order_no 가 동일. 주문 단위 집계 시 legacy_order_no 로 GROUP BY.
  ※ item_text=품목명, item_code=원본 품목코드(향후 products.code 매핑 후보). 자동 매핑 안 함.
  ※ recipient_*: 구매자(customer)≠수령자인 선물배송 정보. 전화 무(無)인 익명거래는 customer_id=NULL.
  ※ mapped_to_sales_order_id: 향후 사람이 매핑 검수해 sales_orders로 승격한 경우 그 ID. NULL이면 legacy 전용.
  ※ 고객 상세 화면의 "과거 구매" 탭에서 표시.
  ※ 고객 분석(/customers/analytics)의 RFM·재구매주기·이탈위험은 sales_orders(COMPLETED) + legacy_purchases 를 통합 집계해 LTV/F/M 계산. **LTV·누적구매액은 실결제(#18: sales는 total−discount, legacy는 total) 기준** — POS 고객패널·고객상세·분석·AI(getCustomerDetail·customer_segment_analysis) 모두 동일.
  ※ 070 에서 legacy_orders/legacy_order_items 로 정규화됨(주문헤더+품목). 앱 read 는 이 테이블 유지, 후속 단계 이전 예정.
legacy_orders(마이그 070): id, legacy_order_no(UNIQUE 주문키=일자+순번+거래처코드), customer_id, phone, ordered_at, channel_text, branch_id, branch_code_raw, staff_code, recipient_name/recipient_phone/recipient_address(선물배송 수령자), received_at, payment_status, note, total_amount(주문합계=라인합 VAT포함), source_file, metadata, created_at/updated_at
  ※ 주문당 1행(47,268). legacy_purchases 를 주문 단위로 정규화한 헤더.
legacy_order_items(마이그 070): id, order_id(→legacy_orders ON DELETE CASCADE), line_seq(주문내 품목순서 1..n), item_code, item_text, option_text, quantity, unit_price_vat, supply_amount, vat_amount, discount_amount, total_amount
  ※ 라인아이템 단위(66,090). UNIQUE(order_id, line_seq).

--- 판매(POS) ---
sales_orders: id, order_number(SA-...), channel, branch_id, customer_id, buyer_name, buyer_phone, recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail, ordered_by(담당자), total_amount, discount_amount, points_used, points_earned, payment_method(cash/card/card_keyin/kakao/credit/cod/mixed), credit_settled(bool), credit_settled_at, credit_settled_method, memo, status(COMPLETED/CANCELLED/REFUNDED/PARTIALLY_REFUNDED), ordered_at, receipt_status(RECEIVED/PICKUP_PLANNED/QUICK_PLANNED/PARCEL_PLANNED), receipt_date, approval_status(COMPLETED/CARD_PENDING/UNSETTLED), payment_info, taxable_amount, exempt_amount, vat_amount, ship_from_branch_id(마이그 096·출고처 override·NULL허용·plain UUID FK없음; NULL이면 매출처로 폴백), smartstore_order_id(마이그 097·네이버 주문번호·스마트스토어 엑셀 임포트 dedup키·NULL허용 unique)
  ※ buyer_name/buyer_phone: 자사몰(카페24) 주문자 스냅샷(마이그 074). customer_id 연결과 무관하게 보존 — customer_id=NULL이어도 주문자명/전화 표시(판매현황 "비회원" 방지). 고객 분석·집계는 여전히 customer_id 기준.
  ※ recipient_*는 카페24 받는분(수령자) 스냅샷(마이그 083) — buyer_*(주문자)와 별개. 출고 후엔 shipments.recipient_* 우선.
  ※ 매출 기준 통일(#18): total_amount = 상품총액(할인 전 gross). **매출(실결제) = total_amount − discount_amount** 로 전 채널 통일(POS/백화점/cafe24 동일). 할인·포인트·쿠폰을 별도 매출항목으로 분리하지 않음. points_used는 결제수단(tender)이라 매출에서 빼지 않음. legacy_orders.total_amount는 이미 net(할인 컬럼 없음). 집계 SQL은 항상 (total_amount − COALESCE(discount_amount,0)) 사용.
  ※ status=CANCELLED 처리 경로 2가지: (a) 외상 미수금 → cancelCreditOrder, (b) 그 외 결제수단 → cancelSalesOrder. 둘 다 재고 복원 + 포인트 적립/사용 환원 + 매출 분개 역분개. inventory_movements.reference_type='SALE_CANCEL' 또는 'CREDIT_CANCEL'. journal_entries.source_type='SALE_CANCEL' 또는 'CREDIT_CANCEL'(+reversal_of=원본 분개 ID).
  ※ "취소 vs 환불" 구분: 취소는 거래 자체를 무름(잘못 등록), 환불은 매출 발생 후 반품(return_orders 생성).
  ※ 취소 ↔ 택배 연동(#48): STORE 전표 취소 시 연결 배송(shipments)에 발송완료(SHIPPED/DELIVERED)가 하나라도 있으면 취소 차단·환불유도, PENDING/PRINTED 연결건은 삭제(재고/분개보다 먼저 가드). 카페24 취소/환불(webhook)도 ONLINE_SALE 차감분 재고복원(reference_type=ONLINE_SALE_CANCEL/ONLINE_REFUND) + 매출 역분개(컷오프 2026-06-17 이후 차감분만, 부분환불은 재고복원 제외).
  ※ 카페24 취소(webhook handleOrderCancelled)는 연결 배송(shipments) 정리도 수행(#48 Phase 2b, voidUnshippedShipmentsForOrder): 미발송(PENDING/PRINTED)분만 삭제, 발송완료(SHIPPED/DELIVERED)분은 보존 + 'order_cancelled_shipment_preserved' 경고로그(운영자 수동확인). 재고복원·역분개와 별개 단계(중복 없음). 환불(REFUNDED)·부분환불 webhook은 배송정리 안 함(취소만).
  ※ 부분환불(PARTIALLY_REFUNDED)은 카페24 webhook이 refund_price 총액만 줘 per-line 재고 자동복원 **영구 불가** → 운영자가 판매현황 상태필터('부분환불')에서 식별 후 InventoryModal 수동 재고조정(정책 영구).
  ※ 전표 수정(수령 전 품목 추가/삭제/수량·단가수정): status=COMPLETED & receipt_status≠RECEIVED 전표에 한해 품목 추가/삭제/수정 가능(addSalesOrderItem/removeSalesOrderItem/updateSalesOrderItem). 즉시 total_amount/taxable/exempt/vat·적립포인트·재고가 재계산됨. 재고 movement reference_type='SALE_REVISE_ADD'(차감,OUT)/'SALE_REVISE_REMOVE'(복원,IN)/'SALE_REVISE_EDIT'(수량변경 차액 OUT or IN), phantom은 'PHANTOM_DECOMPOSE'. 결제 차액은 sales_order_payments 1행(memo='전표 수정 자동 추가결제/부분환불'). 매출 분개는 차액분만 추가(journal_entries.source_type='SALE_REVISE', orderNumber 'REVISE-...'). 적립포인트 차액은 point_history type='adjust'(description='전표 수정 적립 조정'). 주문할인(discount_amount) 재배분은 없음(기존값 유지). 수령완료 품목/마지막 품목 삭제는 거부. 품목수정(#36): 수량 변경=차액만큼 재고 OUT/IN, 단가만 변경=재고 불변·금액만, 판매번호(order_number) 불변·audit_logs에 수정이력.
  ※ receipt_status=수령현황(수령완료/방문예정/퀵예정/택배예정). 기본 RECEIVED. 배송 활성 시 PARCEL_PLANNED/QUICK_PLANNED 자동 지정. 배송 SHIPPED는 수령상태 불변(발송은 shipment.status로만 추적), DELIVERED→RECEIVED만 자동연동(#43, 마이그091).
  ※ 수령상태 일괄변경(#38, bulkUpdateReceiptStatus): 여러 주문을 발송완료(PARCEL_SHIPPED 아님—shipment SHIPPED)/수령완료(RECEIVED)로 일괄. 배송 연결건은 shipment.status 동기화 + syncReceiptStatusFromShipment 재사용. 전진 전이만 허용(비RECEIVED만). 판매현황 수령현황 뷰의 다중선택 일괄처리.
  ※ 주문 옵션 송장 반영(#40→#46): sales_order_items.order_option(보자기/쇼핑백/선물 등)은 getShipments 가 order_options 파생. 저장 데이터 무변경(조회 도출). cafe24는 items_summary에 이미 옵션 포함. #46 분리: 배송메시지=순수 delivery_message(고객 배송요청)만(composeDeliveryMessage 합성 제거). 옵션은 배송목록 '포장/옵션' 셀(화면) + CJ export는 품목명에 ' / 옵션' 병기(실제 CJ 양식 12컬럼엔 옵션 전용 컬럼 없음 → 품목명 구분값 병기, 송장에 품목명으로 인쇄). 배송메세지2 컬럼은 실제 양식에 없어 미사용.
  ※ approval_status=결제 승인 라이프사이클(status와 직교). card_keyin→CARD_PENDING, credit→UNSETTLED 자동 추론 가능.
  ※ payment_info=레거시 자유기입 컬럼(2026-04 UI 제거). 신규 입력 없음. 과거 데이터 조회만 노출.
  ※ ordered_by=판매·상담 담당자.
  ※ taxable_amount/exempt_amount/vat_amount=거래 시점 스냅샷(마이그 058). 카트 내 products.is_taxable
    기준으로 라인별 분리 → finalAmount(고객 실수령)에 비례 배분. vat=round(taxable×10/110).
    세 값 합 ≒ finalAmount(반올림 1원 이내). 058 미적용 주문은 0/NULL → reports는 사후 집계로 폴백.
sales_order_items: id, sales_order_id, product_id(nullable — 080), quantity, unit_price, discount_amount, total_price, order_option, item_text(080), delivery_type(PICKUP/PARCEL/QUICK), receipt_status(RECEIVED/PICKUP_PLANNED/QUICK_PLANNED/PARCEL_PLANNED), receipt_date, smartstore_product_order_no(마이그 097·네이버 상품주문번호·품목 멱등)
  ※ order_option=품목별 부가 옵션(보자기 포장/쇼핑백/색상/서비스 지급 등).
  ※ item_text=카페24 텍스트 품목(우리 products 매핑 안 됨, product_id=null인 행). 렌더 폴백: product?.name || item_text.
  ※ delivery_type=품목별 배송 방식 — 같은 전표에서 품목별로 다를 수 있음(예: 3품목 중 1품목만 택배, 2품목 현장수령). 단 shipments는 주문당 1건 유지(수령지 1곳만 전제; 2곳 이상은 새 전표 분리).
  ※ receipt_status=품목별 수령 상태. sales_orders.receipt_status는 품목 상태 집계 결과. 품목 전부 RECEIVED이면 주문 RECEIVED + shipments.status=DELIVERED 자동.
  ※ shipments.items_summary는 PICKUP 제외, PARCEL/QUICK 품목만 요약.
  ※ shipments.sales_order_id 부분 UNIQUE(마이그094) = 전표당 배송 1건(1전표=1발송지). shipments↔sales_orders 1:1. 과거 카페24 NULL링크는 cafe24_order_id 정확매칭 backfill로 연결.
sales_order_payments: id, sales_order_id, payment_method, amount, approval_no, card_info, memo, paid_at, created_by
  ※ 한 주문의 다중 결제(분할). 합계<총액이면 잔액=외상. payment_method='mixed'면 세부는 이 테이블에.
  ※ amount 음수=환불(전표 수정 부분환불, 마이그078). Σ amount=순수금액. payment_method enum: cash|card|card_keyin|kakao|credit|cod|mixed.
sales_order_drafts(마이그 060): id, branch_id, customer_id, customer_snapshot(jsonb), cart_items(jsonb), delivery_info(jsonb), payment_info(jsonb), meta_info(jsonb), memo, title, total_amount, item_count, created_by, created_at, updated_at
  ※ POS 결제 직전 상태 통째 저장 → 나중에 다시 불러와 이어 작성하는 임시 슬롯.
  ※ 결제 완료(processPosCheckout) 시 currentDraftId가 있으면 자동 삭제.
  ※ HQ 역할은 전 지점, BRANCH/PHARMACY는 본인 지점만 조회/삭제.

--- 반품 ---
return_orders: id, return_number, original_order_id, branch_id, customer_id, processed_by, reason, reason_detail, refund_amount, refund_method, points_restored, status, processed_at
return_order_items: id, return_order_id, sales_order_item_id, product_id, quantity, unit_price, total_price

--- 매입 ---
suppliers: id, name, code, contact_name, phone, email, is_active
purchase_orders: id, order_number(PO-...), supplier_id, branch_id, status(DRAFT/CONFIRMED/PARTIALLY_RECEIVED/RECEIVED/CANCELLED), total_amount, ordered_at, memo
purchase_order_items: id, purchase_order_id, product_id, ordered_quantity, received_quantity, unit_price
supplier_product_prices: id, supplier_id, product_id, unit_price, effective_from, source(MANUAL/PO_CONFIRMED/PO_RECEIVED), source_po_id, memo, created_at
  ※ 공급사별 매입 단가 이력. 발주 확정/입고 시 자동 기록 + 수동 등록. UNIQUE(supplier_id,product_id,effective_from)

--- 생산 ---
product_bom: id, product_id(완제품), material_id(부자재), quantity, loss_rate(%), notes, sort_order
  ※ 본사가 OEM 공장에 지급하는 부자재 목록. 원가 산정 + 생산 완료 시 입고 지점(본사) 재고에서 차감(수량 = BOM qty × 생산 수량 × (1+loss%), 올림). 원재료는 BOM 미등록 원칙(OEM 자체 조달).
oem_factories: id, code, name, business_number, representative, contact_name, phone, email, address, memo, is_active
  ※ OEM 위탁 공장 마스터. production_orders.oem_factory_id 참조.
branches.is_headquarters (bool): 본사 지점 여부. 생산 지시 기본 입고처이자 권한 체크 기준.
production_orders: id, order_number(WO-...), product_id(완제품), oem_factory_id(위탁 공장), branch_id(완제품 입고 지점), quantity, status(PENDING/IN_PROGRESS/COMPLETED/CANCELLED), started_at, completed_at, memo

--- B2B 거래 ---
b2b_partners: id, name, code, business_no, contact_name, phone, settlement_cycle, commission_rate, memo, is_active
b2b_partner_prices: id, partner_id, product_id, unit_price, discount_rate, effective_from
b2b_sales_orders: id, order_number, partner_id, branch_id, total_amount, status, delivered_at, settlement_due_date, settled_amount, settled_at, memo, created_by
b2b_sales_order_items: id, b2b_sales_order_id, product_id, quantity, unit_price, total_price
b2b_settlements: id, partner_id, period_start, period_end, total_sales, commission, net_amount, status, settled_at, settled_method, memo

--- 회계 ---
gl_accounts: id, code, name, account_type(ASSET/LIABILITY/EQUITY/REVENUE/COGS/EXPENSE), parent_code, is_active, sort_order
journal_entries: id, entry_number, entry_date, description, source_type, source_id, total_debit, total_credit, created_by
journal_entry_lines: id, journal_entry_id, account_id, debit, credit, memo
accounting_period_closes: id, period(YYYY-MM), closed_at, closed_by, memo

--- 배송 ---
shipments: id, source(CAFE24/STORE/SMARTSTORE·마이그098), delivery_type(PARCEL/QUICK), cafe24_order_id, sales_order_id, sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail, recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail, tracking_number, status(PENDING/PRINTED/SHIPPED/DELIVERED), branch_id, created_at
  ※ sender_*: 배송 행 생성 시점 스냅샷. CAFE24 출처는 /admin/shippingorigins(폴백 /admin/store)에서 자동 채움.
  ※ 대한통운 엑셀 다운로드 시 발송지는 별도 모달에서 지점 선택(본사/한남점 등) — branches.sender_* 우선, 없으면 branches.address/phone 폴백. 모든 행에 통일 적용.
  ※ branch_id = 출고 지점 (재고가 차감된 지점). POS에서 배송 활성 시 판매 지점과 다를 수 있음. 판매 지점은 sales_orders.branch_id 참조.
  ※ delivery_type: PARCEL=택배(송장·알림톡), QUICK=퀵배송(당일 인편·직접 배송).
  ※ status 자동 전환 머신:
     · 행 생성 시 PENDING.
     · CJ 엑셀 다운로드(선택건) = "출력 명단 확정" → PENDING → PRINTED 일괄.
     · 송장번호 임포트(택배 송장 매칭) → PRINTED/PENDING → SHIPPED 일괄, tracking_number 채움.
     · 시간 기반 자동 배송완료(/api/shipping/track-sync, GitHub Actions 크론 15:00 KST): SHIPPED+송장 건이 updated_at 기준 N일(기본 3, env SHIPPING_AUTODELIVER_DAYS/?days override) 경과하면 DELIVERED 자동(추정 마킹, 외부 추적 API 없음) + #19 수령상태 RECEIVED 연동. 멱등(SHIPPED 필터로 재처리 제외). 배송 편집 시 updated_at 리셋되어 시계 재시작.
  ※ 배송목록 정렬: 등록일이 아니라 연결 sales_order.receipt_date(수령/택배예정일) 오름차순. 출처 컬럼은 매출처(연결 sales_order.branch, #21).
  ※ 송장 임포트 매칭: export 시 "내품명" 컬럼에 RTC(KX-{shipment.id 8자리}) 박아 round-trip. import 시 RTC > 전화 1:1 > 다중후보(사용자 선택) > 미매칭 4단계 신뢰도.

--- 알림·캠페인 ---
notifications: id, customer_id, type(SMS/ALIMTALK), message, status(sent/failed/pending), sent_at, sent_by
notification_template_mappings: solapi_template_id, event_type, is_manual_sendable, description
notification_campaigns: id, name, event_type, scheduled_at(예약발송시각 timestamptz), start_date?, end_date?, is_recurring, recurring_month/day/hour/minute, target_grade, target_branch_id, solapi_template_id, auto_send, status(DRAFT/ACTIVE/SENT/COMPLETED/CANCELLED), sent_count, failed_count
  ※ scheduled_at: 단일 예약 발송 시각. auto_send=true + ACTIVE + sent_at NULL + scheduled_at<=now() → 스케줄러(/api/notifications/batch/campaign-scheduler, 10분 주기)가 자동 발송.
  ※ start_date/end_date: 2026-04 이후 옵션(반복 캠페인 윈도우 표시 용). 단일 예약은 scheduled_at만으로 충분.
notification_batch_logs: id, batch_type(BIRTHDAY/DORMANT/CAMPAIGN_SCHEDULER), detail(JSONB), target_count, sent_count, failed_count, skipped_count, started_at, finished_at
campaign_event_types: code, name, emoji, is_recurring_default, default_month, default_day

--- 시스템 ---
users: id, name, email, phone, role(SUPER_ADMIN/HQ_OPERATOR/PHARMACY_STAFF/BRANCH_STAFF/EXECUTIVE), branch_id
cafe24_tokens: id, mall_id, access_token, refresh_token, access_token_expires_at
cafe24_product_map(마이그 082): id, cafe24_product_code, option_value(정규화된 옵션조합 키, 무선택은 ''), product_id(→products.id), created_at — UNIQUE(cafe24_product_code, option_value). 카페24 품목→내부 product 매핑. 송장/배송 짧은 품목명 표시용.
smartstore_product_map(마이그 097): id, smartstore_product_no(네이버 상품번호), option_value(옵션정보, 단일상품 ''), product_id(→products.id), product_name_snapshot, created_at — UNIQUE(smartstore_product_no, option_value). 스마트스토어 엑셀 임포트 시 상품명+옵션→내부 product 매핑(cafe24_product_map 동일 메커니즘). 채널 'SMARTSTORE'(스마트스토어). 임포트=src/lib/smartstore/, 출고/재고차감=본사, 회원매칭=구매자연락처(전화) dedup·자동생성X.
seasons: id, name, season_type(NEW_YEAR/LUNAR_NEW_YEAR/CHUSEOK/EVENT/ETC), start_date, end_date, target_amount, is_active
`;

export const BUSINESS_RULES = `
== 업무 규칙 ==

[고객 등급]
- NORMAL(일반) = 포인트 1% 적립
- VIP = 포인트 2% 적립 (누적 구매 100만원 이상)
- VVIP = 포인트 3% 적립 (누적 구매 300만원 이상)
- 등급은 자동 다운그레이드 없음. upgrade_customer_grades 도구로 일괄 업그레이드.

[재고 처리 판단]
- "재고 채워줘 / X개 넣어줘 / 입고처리" → adjust_inventory (movement_type: IN)
- "발주 / 구매 주문 / 공급업체 통해서" → create_purchase_order 흐름
- 모호하면 먼저 물어보기
- 원자재(RAW)·부자재(SUB) 재고는 **본사(branches.is_headquarters=true)에서만** 입출고·조정 가능 (OEM 위탁 생산 모델). 비본사 지점에 대한 adjust_inventory 호출은 서버가 거부. 본사 지정이 없으면 제한 미적용(폴백).
- 재고 소모(자가 사용 등) 차감은 재고화면 숫자 클릭 또는 '자가 사용' 버튼(recordStockUsage)으로 다건 일괄 OUT 처리 — 지점+사용유형+품목리스트, 음수 허용. 지점직원은 **자기 지점**만 가능(원자재·부자재 제외), 본사는 전 지점.
- 재고 강제 조정(ADJUST)은 본사 역할(SUPER_ADMIN/HQ_OPERATOR)만 — 실사·오류 보정 전용 별도 버튼. UI에서 수동 입고/출고 버튼 제거 — 입고=매입(purchase), 출고=판매/창고이동으로만 발생.

[발주 워크플로우]
DRAFT → CONFIRMED → RECEIVED
각 단계별 도구: create_purchase_order → confirm_purchase_order → receive_purchase_order
입고(RECEIVED) 시 재고 자동 증가

[생산 워크플로우 — OEM 위탁 모델]
PENDING → IN_PROGRESS → COMPLETED
본사에서만 지시 가능. 각 지시는 OEM 공장에 위탁하고, 완성품은 지정한 입고 지점(기본 본사)으로 직접 입고.
완료 시:
  ① 부자재는 **본사(branches.is_headquarters=true) 재고에서만** 차감 — BOM qty × 생산 수량 × (1+loss%), 올림.
     ※ 입고 지점이 본사가 아닌 경우에도 부자재 차감 지점은 항상 본사.
     ※ 음수 재고 허용 — 본사 재고 부족해도 차단하지 않고 마이너스로 차감, 추후 입고 시 누적 복원.
       레코드 자체가 없으면 음수로 신규 생성.
     ※ POS 판매도 동일 정책 — 재고 0/품절 상태여도 판매 허용. UI는 "품절" 배지만 표시하고 차단하지 않음.
     ※ 본사가 미지정이면 생산 완료 자체가 불가 — 지점 관리에서 본사 지정이 전제.
  ② 완제품 재고를 "입고 지점(production_orders.branch_id)"에 증가.
  ③ inventory_movements 기록: 부자재 차감은 본사 branch_id로, 완제품 입고는 입고 지점 branch_id로.
원재료는 BOM에 등록하지 않음(OEM 자체 조달 원칙). BOM은 부자재 조달 관리 + 원가 산정(cost_source='BOM')에 사용.

[채널]
STORE=한약국 매장, DEPT_STORE=백화점, ONLINE=자사몰(카페24), EVENT=이벤트

[결제]
cash=현금, card=카드, credit=외상, cod=수령시수금
  ※ POS UI에서는 2026-04 기준 위 4종만 선택 가능. DB에는 legacy 값(card_keyin/kakao/mixed)이 남아있을 수 있음 — 조회/필터에서는 그대로 노출.
외상(credit): 반드시 고객 지정 필요, credit_settled=false → 정산 시 true
sales_orders.approval_status: 결제 승인 라이프사이클 (status와 직교):
  - COMPLETED: 승인/수금 완료 (기본)
  - CARD_PENDING: 카드 키인 승인 대기
  - UNSETTLED: 미수금(외상/계좌이체 대기 등) — UI 표기 '미수금'. 거래관리 미수금 내역과 동일 개념.
  ※ approval_status=UNSETTLED 건은 "미수금 건 정리/수금" 대상.
  ※ 수금 처리(settleSalesOrderReceivable): credit이면 1115(외상매출금) 회수 분개 생성, 비외상은 판매시점에 이미 1110/1120 차변 기록되어 분개 없이 approval_status만 COMPLETED로 변경(이중계상 방지). 거래관리 settleCreditOrder 수금도 이제 UNSETTLED→COMPLETED 동기화(판매현황 미수금 배지 닫힘).

[수령]
sales_orders.receipt_status: 제품 수령 흐름 (현장판매는 대부분 RECEIVED).
  - RECEIVED=수령완료 · PICKUP_PLANNED=방문예정 · QUICK_PLANNED=퀵예정 · PARCEL_PLANNED=택배예정
  ※ 배송(shipments) 생성 시 delivery_type에 맞춰 receipt_status 자동 추론.
  ※ 배송→수령 자동연동(#43): 배송목록/AI/카페24웹훅에서 shipment SHIPPED는 수령상태 불변(발송은 shipment.status로만 추적), DELIVERED 시 택배품목→RECEIVED. receipt_date는 기존 수령(예정)일 보존, 비어있을 때만 오늘로 fill(#47). 방문/퀵/이미수령 품목 무손상. 공용 헬퍼 syncReceiptStatusFromShipment(receipt-sync.ts).
  ※ receipt_date: 수령(예정) 날짜. 방문예정·택배예정 조회 시 핵심 축.
sales_order_items.order_option: 품목별 주문 부가 옵션(보자기/쇼핑백/색상/서비스 등). 배송 방식 기록용 아님.
sales_order_items.delivery_type + receipt_status: 같은 전표 내 품목별 배송·수령 추적. 3품목 중 1품목만 택배 같은 혼합 시나리오 정식 지원(수령지는 1곳만 가정).
sales_orders.receipt_status: 품목 receipt_status 집계. 품목 모두 RECEIVED이면 자동 전이. 발송(shipment SHIPPED)은 수령상태 불변, 배송완료(DELIVERED) 시에만 택배품목→RECEIVED(#43).
전표 배송전환(방문↔택배, 수정가능 전표=COMPLETED·receipt_status∉{RECEIVED,null}만): 방문→택배는 미수령 품목을 PARCEL_PLANNED로 바꾸고 shipment(status=PENDING) 생성, 택배→방문은 shipment.status='PENDING'(송장 미발행)일 때만 shipment 삭제 후 품목 RECEIVED 전환. 금액 불변(배송비 없음). RECEIVED 품목은 보존.
전표 상세 직접수정(updateSalesOrderDetails, 취소·환불 전표 제외): 수정 가능 필드=customer_id(재연결/해제)·buyer_name·buyer_phone(표시명)·**ordered_at(판매일시)·branch_id(매출처)·ordered_by(담당자)·receipt_status(수령상태)**·receipt_date(수령일)·recipient_*(받는분 5필드)(#23). order_number는 절대 불변. **status(취소/환불)는 직접수정 불가 — cancelSalesOrder/환불 전용 플로우라야 재고·분개 정합.** branch_id 변경은 매출 귀속만 바꿈(재고 미이동). 받는분 변경 시 sales_orders.recipient_* 항상 + shipment 존재 시 shipments.recipient_* 동기화. 변경 필드만 audit_logs에 1건(action=UPDATE, 전/후값) 기록. 금액·품목·단가·결제수단은 별도 흐름(수령 전 품목 추가/삭제·배송전환).

[포인트]
1P = 1원 할인. 포인트 적립 = 결제금액 × 적립률.
적립률 결정(마이그 067 매트릭스):
  1) branch_point_rates 에 (sales_orders.branch_id=구매 발생 지점, 고객 등급의 grade_id) 활성 행 있으면 그 point_rate
  2) 없으면 customer_grades.point_rate (등급 기본)
  3) 둘 다 없으면 1.0%
※ 기준 지점은 "고객 담당 지점(primary_branch_id)"이 아니라 "구매가 일어난 지점(sales_orders.branch_id)".
※ 서버 단일 진실원 = resolvePointRate(branchId, gradeCode) (src/lib/actions.ts). 클라이언트가 보낸 gradePointRate 는 표시용이며 서버가 재해결.
※ 점포 운영 화면: /system-codes → "지점별 적립율" 탭(매트릭스 인라인 편집). 빈 셀 = 등급 기본 사용.

[자주 쓰는 패턴]
- "OO 재고 / 재고조회" → get_inventory(product_name, branch_name?) 사용(즉석 analyze_data SQL 지양 — 도구가 공백무시·정확일치 우선 매칭 내장).
- 제품명 매칭은 띄어쓰기·대소문자 무시: 사용자 "침향30환" = 제품명 "침향 30환"(공백 있음). 또 같은 제품에 변형(골드·사은품·직원할인 등 접미사)이 있으니, 사용자가 기본형을 물으면 정확명/코드(예: FCH30)를 우선하라 — 변형의 0재고를 전체 재고 0으로 오판 금지. analyze_data 직접 SQL이면 replace(p.name,' ','') ILIKE replace('%침향30환%',' ','') 또는 코드로 조회.
- "이번달 매출" → get_sales_summary(period: "this_month")
- "지난달 대비" → compare_sales(period1=이번달, period2=지난달)
- "재고 부족" → get_low_stock
- "전체 고객 등급 올려줘" → upgrade_customer_grades (확인 필요)
- "VIP한테 문자" → bulk_send_sms(grade: "VIP", ...)
- "외상 수금 처리해줘" → settle_credit_order(order_number, method) (확인 필요)
- "외상 주문 취소해줘" → cancel_credit_order(order_number, reason) (확인 필요, 되돌릴 수 없음)
- "발주 취소해줘" → cancel_purchase_order(order_number) (DRAFT/CONFIRMED만)
- "생산 지시 취소해줘" → cancel_production_order(order_number) (PENDING/IN_PROGRESS만, 본사 전용)
- "안전재고 N개로 설정" → set_safety_stock(product_name, safety_stock, branch_name?)
- "판매 등록해줘 / OO 팔았어" → create_sales_order (단순 판매. 택배=recipient_name/phone/address 지정 시 shipments 1:1 PENDING 자동 생성. 할인·외상·분할은 미지원 → POS 화면 안내, 확인 필요)
- 다건/대량 요청(배송지N·고객N·납품N)은 batch_execute로 팬아웃: {tool, common_args, items[]}. 대상=create_sales_order(택배=recipient_* 지정)/create_customer/create_b2b_sales_order. 건별 독립 실행(부분실패 허용), 최대 50건.
- 엑셀/스프레드시트 첨부(.xlsx/.csv) = 텍스트표로 들어옴(고정양식 아님). 컬럼 자유해석 → 배송지/고객/납품 리스트면 batch_execute 팬아웃. 실행 전 매핑·해석 요약 확인 1회.
- "캠페인 만들어줘" → create_campaign (DRAFT 생성, 본사 전용)
- "캠페인 활성화해줘" → activate_campaign (DRAFT→ACTIVE, 본사 전용)
- "캠페인 발송해줘" → send_campaign (ACTIVE 캠페인 다수 고객 실발송, 본사 전용·확인 필요·되돌릴 수 없음)
- "배송 등록해줘 / 이 주소로 배송건 만들어줘" → create_shipment (STORE 직접입력, 발송인·출처 자동, 확인 필요)
- "거래처에 납품 등록해줘" → create_b2b_sales_order (재고차감+매출 분개, RAW/SUB 불가, 확인 필요)
- "거래처 수금 처리해줘" → settle_b2b_order(order_number, amount, method?) (가산 수금, 확인 필요)
- "납품 전표 취소해줘" → cancel_b2b_order(order_number, reason?) (재고 역복원, 수금 0건만, 확인 필요)
- "수령 전 전표 품목 추가/수정/삭제" → add/update/remove_sales_order_item (RECEIVED 후엔 거부, 차액 재고·결제·분개 자동재정산, 확인 필요. update/remove는 analyze_data로 sales_order_items.id 선조회 필요)
- "여러 주문 일괄 수령완료" → bulk_update_receipt_status (order_numbers[] 입력, target=RECEIVED 고정, 배송건은 DELIVERED 후 자동반영, 본사 전용·확인 필요)
- "카페24 품목코드+옵션을 내부 제품에 매핑/삭제" → create/delete_cafe24_product_map (송장 짧은 제품명·미매핑 과거전표 백필, 본사 전용)
- "카페24 자사몰 주문자를 ERP 고객으로 등록·연결" → register_cafe24_customers (전화 일치 시 기존고객 연결·이름 미변경, 본사 전용·확인 필요)

[에이전트 판매 등록 (create_sales_order)]
- 단순 현장판매(POS) 전용: 단일 결제(현금/카드/카카오페이만), 할인 0, 현장 수령(PICKUP).
- 미지원: 택배 배송, 분할 결제, 외상(미수금), 할인 — 이런 요청은 POS 화면을 안내한다(영구 미지원).
- 회원/비회원 모두 가능. 등급·적립율은 서버가 자동 계산(branch_point_rates 067 매트릭스, resolvePointRate).
- 포인트 사용은 회원 + use_points 일 때만, 보유 잔액과 결제금액 중 작은 값까지.
- 내부적으로 processPosCheckout 에 위임 — 음수재고 차단·RAW/SUB 거부·phantom BOM 분해·과세 배분·ORDER_COMPLETE 알림톡 동일 적용.
- 되돌리려면 환불(refund_sales_order). DANGEROUS: confirm 필수.

[에이전트 알림톡 캠페인 (create/activate/send_campaign)]
- 모두 본사 권한 전용(requireHq). 상태 흐름: DRAFT(create) → ACTIVE(activate) → 발송(send).
- send_campaign 대상: customers.is_active=true, phone NOT LIKE 'cafe24_%', target_grade≠ALL이면 등급 일치, target_branch_id 있으면 지점 일치.
- send_campaign 은 발송 전 대상수를 사전 집계해 응답에 targetCount/successCount/failCount 제공. DANGEROUS: 다수 고객 실발송, confirm 필수.

[Phantom BOM(세트 상품) 운영 규칙]
- products.is_phantom=true 제품은 "묶음 명칭일 뿐" 본인 재고 관리 대상이 아님.
- BOM 구성품은 각각 단독으로도 판매 가능한 일반 제품(non-phantom)이며, 개별 재고로 관리됨.
- POS 판매 시 phantom 본인 재고는 차감하지 않고, product_bom의 구성품을 분해 차감. 재고 소모(USAGE: 시음·로스·자가사용)도 동일하게 base 자재로 분해 차감(예: 침향 10환 시음 1개 → 침향 30환 -0.333).
- 재고 화면/백필 대상에서 phantom 본인은 제외. 구성품(non-phantom)이 단독 SKU로 재고 추적됨.
- 사용자가 "세트상품 재고 얼마야?" 같은 질문을 하면, phantom의 BOM 구성품 중 가장 부족한 품목 기준으로 답해야 함.

[B2B 거래]
- b2b_partners: 거래처(법인/도매), b2b_partner_prices: 거래처별 제품 단가표
- b2b_sales_orders: B2B 납품, b2b_settlements: 수금/정산
- B2B 매출 → 회계 계정 4130(B2B매출)
- 상태 흐름: DELIVERED(납품) → PARTIALLY_SETTLED(일부 수금) → SETTLED(완납). 취소 시 CANCELLED.
- 에이전트 납품(create_b2b_sales_order): RAW/SUB(원자재·부자재)는 납품 불가. 출고 지점 지정 시에만 재고 차감(음수 허용). 단가 미지정 시 제품 정가(products.price) 적용 — 거래처 단가표(getPartnerPrices)는 미연동(스코프 밖). 납품 즉시 외상매출금(1115)/B2B매출(4130)+부가세예수금(2151) 분개 자동.
- 에이전트 수금(settle_b2b_order): 수금액 가산 → total 도달 시 SETTLED. method='card'→현금성자산 1120, else 현금 1110. SETTLED/CANCELLED 전표는 거부. order_number→UUID 선조회 후 처리.
- 에이전트 취소(cancel_b2b_order): settled_amount>0(수금 진행 건)은 취소 불가. 취소 시 차감 재고를 IN으로 역복원. order_number→UUID 선조회 후 처리.

[회계]
- gl_accounts: 계정과목, journal_entries+journal_entry_lines: 분개
- POS/매입/생산/반품/B2B 이벤트마다 분개 자동 생성
- VAT: 공급가=price÷1.1, 부가세=price×10/110
- accounting_period_closes: 월 마감 후 해당 기간 수정 차단

[지점별 매출(통합 조회)]
- 지점별 매출 = legacy_orders(ordered_at<2026-05-19) + sales_orders(ordered_at>=2026-05-19, status NOT IN CANCELLED/REFUNDED/PARTIALLY_REFUNDED) 통합. 컷오프 경계로 이중집계 없음.
- RPC branch_sales_summary(p_from date, p_to date, p_grain text 'day'|'month'|'year') → (period_date, branch_id, total). 판매현황 '지점비교'에서 호출. total=최종 결제금액 기준: sales는 (total_amount − COALESCE(discount_amount,0)), legacy는 total_amount(이미 net). 마이그 084(#18).
- legacy branch_id NULL = '미매칭' 그룹(제외 안 함). 날짜는 KST 일자 기준 grain 집계.

[자사몰(카페24) 매출 동기화 — 주문자 고객 표시/등록]
- **수집/매출인식 분리(#25, 이카운트식)**: ONLINE(카페24/자사몰) 주문은 배송화면 '배송 추가' 확정(confirmCafe24OrderAsSale) 시에만 sales_order·sales_order_items·매출분개(SALE) 생성. 확정 시 receipt_status='PARCEL_PLANNED', receipt_date=확정일(KST 오늘). shipment.sales_order_id 로 직접 연결. 재확정(중복)해도 COMPLETED면 분개 재생성 안 함(멱등). 크론(syncCafe24PaidOrdersCore)은 수집·재고차감(확정주문만)·배송상태 동기화만, 매출은 미생성(created 항상 0).
- 동기화 시 주문자(orderer)를 sales_orders.buyer_name/buyer_phone 에 항상 스냅샷 저장 → 판매현황에서 customer_id 없어도 주문자명/전화 표시(과거 "비회원" 노출 해소).
- sync(webhook.ts linkOrCreateCustomer)는 **기존 고객 자동 "연결"만** 함: ①cafe24_member_id 일치 ②이름 AND 전화(대시포맷) 일치 → 연결(+member_id 백필). **자동 "생성"은 안 함**(allowCreate=false).
- 모르는 주문자 고객 등록은 **수동**: 배송 카페24 주문탭에서 "✓고객/미등록" 표시 → 미등록 체크 후 registerCafe24Customers(cafe24-actions)로 고객 생성(이름+전화+주소+이메일, source='CAFE24') + 해당 sales_order.customer_id 연결. **배송추가/전표생성이 끝난 주문도 등록 가능**(미연결 전표를 연결).
- **수동등록 매칭(#34)**: customers.phone UNIQUE → 전화가 강한 식별키. **전화 일치 시 이름이 달라도 기존 고객으로 "연결"**(신규 생성 안 함). 단 기존 고객의 name 은 절대 덮어쓰지 않고 빈 주소/이메일만 보강(오귀속·이름오염 방지). 미연결(customer_id=null) 전표만 연결, 이미 다른 고객에 연결된 전표는 비건드림.
- 배송 카페24 주문탭 "✓고객/미등록" 판정: 확정(배송추가)주문은 **실제 sales_orders.customer_id 연결 상태** 기준(미연결이면 미등록=등록대상, 등록 후 즉시 ✓), 미확정주문은 이름 AND 전화 휴리스틱. customers.phone 대시포맷(010-XXXX-XXXX).
- sync(webhook.ts linkOrCreateCustomer) 자동연결 기준은 여전히 이름 AND 전화(보수적): ①member_id ②이름AND전화. 수동등록만 전화 단독 연결 허용.
- cafe24 실결제(cafe24OrderTotal) = 모든 결제수단 합(payment_amount + naver_point + points_spent_amount + credits_spent_amount). naver_point·예치금(credits_spent_amount)·POS points_used 는 tender(매출 포함). 쿠폰은 할인(제외). 합이 0이면 firstPositiveAmount 폴백.
- **단, 자사몰 적립금(actual_order_amount.points_spent_amount)은 #42 이후 tender 가 아니라 할인으로 매출 제외** (cafe24SelfPoints). 따라서 신규 cafe24 주문 매출 = 카드 실결제(naver_point 사용분은 여전히 매출 포함). 예: 카드 104,490 + 자사몰적립금 4,510 = gross 109,000 → 매출 104,490.
- sales_orders 저장 시 gross 규약(#18): total_amount = cafe24OrderTotal + 쿠폰할인(cafe24OrderDiscount), discount_amount = 쿠폰 + 자사몰 적립금(cafe24SelfPoints). → 매출 = total_amount − discount_amount, POS와 동일 규약. 배송탭 표시 total_price는 cafe24OrderTotal(실결제, 적립금 포함) 그대로. (#42 forward-only: 기존 주문 백필 전이라 과거 cafe24 주문은 아직 적립금 미제외.)
- 카페24 품목(product_code + 옵션조합 정규화) → 내부 product 매핑(cafe24_product_map), 송장/배송 짧은 품목명(이카운트식). 미매핑은 원본 옵션정리 표시.
- 카페24 주문 동기화(webhook.ts) 시 sales_order_items 도 생성: 매핑되면 product_id 연결, 미매핑은 item_text(원본 품목명) 텍스트.
- **자사몰 재고 차감(#14, deductOnlineOrderInventory)**: 매핑된(product_id 있는) 품목을 **주문 branch_id=자사몰 지점**에서 차감 + inventory_movements(movement_type='OUT', reference_type='ONLINE_SALE', reference_id=sales_order_items.id) 기록. 멱등(품목당 movement 존재 시 skip) → 매 동기화·나중 매핑 모두 안전. 미매핑 품목은 매핑 시점(createCafe24ProductMap 백필)에 차감. track_inventory=false 제외. point_history(적립)는 여전히 없음. ⚠️ 주문 취소 시 재고 복원은 미구현(동기화는 취소건 미처리).

[배송]
- shipments: source=CAFE24(자사몰)/STORE(직접입력)/SMARTSTORE(스마트스토어 엑셀 임포트)
- delivery_type: PARCEL=택배(tracking_number + 알림톡 플로우), QUICK=퀵배송(당일 인편 — tracking 없이 현장 처리)
- status: PENDING→PRINTED→SHIPPED→DELIVERED (QUICK은 PRINTED 생략, SHIPPED부터 운영 일반적)
- tracking_number 등록 + SHIPPED 전환 시 알림톡 자동 발송 (PARCEL 한정)
- shipments.branch_id = 출고 지점(재고 차감 지점). POS 배송 주문에서 판매 지점(sales_orders.branch_id)과 다를 수 있음. "어느 지점에서 팔렸나"는 sales_orders.branch_id로, "어느 지점에서 나갔나"는 shipments.branch_id로 집계.
- 출고처(판매 전표의 재고 차감 지점) 일관 도출(#35, 마이그096 보강) = shipments.branch_id(배송 있으면) ?? sales_orders.ship_from_branch_id(override) ?? sales_orders.branch_id. 방문수령·자사몰은 배송 레코드 없어 ship_from_branch_id 또는 매출처로 폴백. 즉 출고처는 항상 존재. 자사몰(ONLINE) 주문은 자사몰 지점 재고에서 차감(현행 유지) → 출고처=자사몰.
- 출고처 사후 변경: changeSalesOrderShipFromBranch(sales-revise-actions) — ship_from_branch_id 기록 + 이 전표의 OUT/IN movement(reference_id=주문/품목)를 새 지점으로 이전(옛 지점 +복원, 새 지점 −차감, movement.branch_id 재지정). shipments 있으면 shipments.branch_id도 동기화. 매출처(branch_id)는 귀속만이라 재고 미이동.
- 에이전트 배송 등록(create_shipment): source는 STORE(직접입력) 고정, CAFE24는 자사몰 동기화 전용. 발송인(sender_name/phone)은 출고 지점 정보로 자동 채움(지점 phone 없으면 ''). 단순 insert만 — 외부 발송 없음. 송장번호 등록·SHIPPED 전환(알림톡 발송)은 update_shipment_tracking 별도 처리.

[반품]
- return_orders: 기존 sales_order 참조, 환불금액/포인트복원 포함
- 반품 완료 시 재고 복구(IN) + 환불 분개 자동 생성
- 환불(processRefund)도 매출·부가세·재고원가 역분개 생성: journal_entries.source_type='RETURN', source_id=원본 sales_order. 라인=매출(차변)+부가세예수금(차변,과세시)+수금계정(대변) + COGS 쌍(재고자산 1130 차변 / 매출원가 5110 대변, 정상매출의 반대방향). RETURN 엔트리는 COGS 쌍을 헤더에 포함해 total_debit=total_credit=환불총액+COGS로 균형(라인 합=헤더 합). COGS는 products.cost(실원가)×수량 기준. 현재 전액 과세 가정(면세 정밀안분 미적용). 분개를 재고·포인트·상태 변경 *이전*에 생성하므로, 생성 실패 시 환불 전체 롤백(return_orders·재고·포인트·상태 모두 미반영).

[AI 에이전트 로그]
- agent_conversations: 매 대화 자동 저장 (user_message, assistant_response, tools_used, tokens, model)
- agent_memories: 대화에서 자동 추출된 별칭/패턴/오류/통찰. 시스템 프롬프트에 주입돼 재사용.
- /agent-memory 화면: 메모리 목록·필터·활성화 관리
- /agent-conversations 화면: 대화 이력 조회 — 본인 최근 30+건, 성공/실패 필터, 검색, 삭제. 관리자는 전체 조회 가능.
`;
