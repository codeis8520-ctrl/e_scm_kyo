export const DB_SCHEMA = `
== 핵심 테이블 스키마 ==

--- 지점·제품·재고 ---
branches: id, name, code, channel(STORE/DEPT_STORE/ONLINE/EVENT), address, phone, is_active, is_headquarters, sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail
  ※ sender_*: 택배 보내는분 정보 (대한통운 엑셀 임포트용). 미입력 시 sender_name←"경옥채 "+name, sender_phone←phone, sender_address←address 로 폴백.
products: id, name, code, barcode, unit, price(판매가), cost(원가), cost_source(MANUAL/BOM), product_type(FINISHED/RAW/SUB/SERVICE), track_inventory(bool), is_phantom(bool), is_active
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
inventory_movements: id, branch_id, product_id, movement_type(IN/OUT/ADJUST/TRANSFER/PRODUCTION), quantity, memo, created_at

--- 고객·CRM ---
customers: id, name, phone, email, grade(NORMAL/VIP/VVIP), primary_branch_id, address, health_note, is_active
customer_grades: code(NORMAL/VIP/VVIP), name, point_rate(1%/2%/3%), is_active
customer_consultations: id, customer_id, consultation_type, content(JSONB), consulted_by, created_at
point_history: id, customer_id, sales_order_id, type(earn/use/adjust/expire), points, balance, description
  ※ 고객 현재 포인트 = point_history에서 해당 고객의 최신 balance 값

--- 판매(POS) ---
sales_orders: id, order_number(SA-...), channel, branch_id, customer_id, ordered_by(담당자), total_amount, discount_amount, points_used, points_earned, payment_method(cash/card/card_keyin/kakao/credit/cod/mixed), credit_settled(bool), credit_settled_at, credit_settled_method, memo, status(COMPLETED/CANCELLED/REFUNDED/PARTIALLY_REFUNDED), ordered_at, receipt_status(RECEIVED/PICKUP_PLANNED/QUICK_PLANNED/PARCEL_PLANNED), receipt_date, approval_status(COMPLETED/CARD_PENDING/UNSETTLED), payment_info, taxable_amount, exempt_amount, vat_amount
  ※ status=CANCELLED 처리 경로 2가지: (a) 외상 미수금 → cancelCreditOrder, (b) 그 외 결제수단 → cancelSalesOrder. 둘 다 재고 복원 + 포인트 적립/사용 환원 + 매출 분개 역분개. inventory_movements.reference_type='SALE_CANCEL' 또는 'CREDIT_CANCEL'. journal_entries.source_type='SALE_CANCEL' 또는 'CREDIT_CANCEL'(+reversal_of=원본 분개 ID).
  ※ "취소 vs 환불" 구분: 취소는 거래 자체를 무름(잘못 등록), 환불은 매출 발생 후 반품(return_orders 생성).
  ※ receipt_status=수령현황(수령완료/방문예정/퀵예정/택배예정). 기본 RECEIVED. 배송 활성 시 PARCEL_PLANNED/QUICK_PLANNED 자동 지정.
  ※ approval_status=결제 승인 라이프사이클(status와 직교). card_keyin→CARD_PENDING, credit→UNSETTLED 자동 추론 가능.
  ※ payment_info=레거시 자유기입 컬럼(2026-04 UI 제거). 신규 입력 없음. 과거 데이터 조회만 노출.
  ※ ordered_by=판매·상담 담당자.
  ※ taxable_amount/exempt_amount/vat_amount=거래 시점 스냅샷(마이그 058). 카트 내 products.is_taxable
    기준으로 라인별 분리 → finalAmount(고객 실수령)에 비례 배분. vat=round(taxable×10/110).
    세 값 합 ≒ finalAmount(반올림 1원 이내). 058 미적용 주문은 0/NULL → reports는 사후 집계로 폴백.
sales_order_items: id, sales_order_id, product_id, quantity, unit_price, discount_amount, total_price, order_option, delivery_type(PICKUP/PARCEL/QUICK), receipt_status(RECEIVED/PICKUP_PLANNED/QUICK_PLANNED/PARCEL_PLANNED), receipt_date
  ※ order_option=품목별 부가 옵션(보자기 포장/쇼핑백/색상/서비스 지급 등).
  ※ delivery_type=품목별 배송 방식 — 같은 전표에서 품목별로 다를 수 있음(예: 3품목 중 1품목만 택배, 2품목 현장수령). 단 shipments는 주문당 1건 유지(수령지 1곳만 전제; 2곳 이상은 새 전표 분리).
  ※ receipt_status=품목별 수령 상태. sales_orders.receipt_status는 품목 상태 집계 결과. 품목 전부 RECEIVED이면 주문 RECEIVED + shipments.status=DELIVERED 자동.
  ※ shipments.items_summary는 PICKUP 제외, PARCEL/QUICK 품목만 요약.
sales_order_payments: id, sales_order_id, payment_method, amount, approval_no, card_info, memo, paid_at, created_by
  ※ 한 주문의 다중 결제(분할). 합계<총액이면 잔액=외상. payment_method='mixed'면 세부는 이 테이블에.
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
shipments: id, source(CAFE24/STORE), delivery_type(PARCEL/QUICK), cafe24_order_id, sales_order_id, sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail, recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail, tracking_number, status(PENDING/PRINTED/SHIPPED/DELIVERED), branch_id, created_at
  ※ sender_*: 배송 행 생성 시점 스냅샷. CAFE24 출처는 /admin/shippingorigins(폴백 /admin/store)에서 자동 채움.
  ※ 대한통운 엑셀 다운로드 시 발송지는 별도 모달에서 지점 선택(본사/한남점 등) — branches.sender_* 우선, 없으면 branches.address/phone 폴백. 모든 행에 통일 적용.
  ※ branch_id = 출고 지점 (재고가 차감된 지점). POS에서 배송 활성 시 판매 지점과 다를 수 있음. 판매 지점은 sales_orders.branch_id 참조.
  ※ delivery_type: PARCEL=택배(SweetTracker 송장·알림톡), QUICK=퀵배송(당일 인편·직접 배송).

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
  - UNSETTLED: 미결(계좌이체 대기 등)
  ※ approval_status=UNSETTLED 건은 "미결 건 정리" 대상.

[수령]
sales_orders.receipt_status: 제품 수령 흐름 (현장판매는 대부분 RECEIVED).
  - RECEIVED=수령완료 · PICKUP_PLANNED=방문예정 · QUICK_PLANNED=퀵예정 · PARCEL_PLANNED=택배예정
  ※ 배송(shipments) 생성 시 delivery_type에 맞춰 receipt_status 자동 추론.
  ※ receipt_date: 수령(예정) 날짜. 방문예정·택배예정 조회 시 핵심 축.
sales_order_items.order_option: 품목별 주문 부가 옵션(보자기/쇼핑백/색상/서비스 등). 배송 방식 기록용 아님.
sales_order_items.delivery_type + receipt_status: 같은 전표 내 품목별 배송·수령 추적. 3품목 중 1품목만 택배 같은 혼합 시나리오 정식 지원(수령지는 1곳만 가정).
sales_orders.receipt_status: 품목 receipt_status 집계(우선순위 PARCEL_PLANNED > QUICK_PLANNED > PICKUP_PLANNED > RECEIVED). 품목 모두 RECEIVED이면 자동 전이.

[포인트]
1P = 1원 할인. 포인트 적립 = 결제금액 × 등급별 적립률.

[자주 쓰는 패턴]
- "이번달 매출" → get_sales_summary(period: "this_month")
- "지난달 대비" → compare_sales(period1=이번달, period2=지난달)
- "재고 부족" → get_low_stock
- "전체 고객 등급 올려줘" → upgrade_customer_grades (확인 필요)
- "VIP한테 문자" → bulk_send_sms(grade: "VIP", ...)

[Phantom BOM(세트 상품) 운영 규칙]
- products.is_phantom=true 제품은 "묶음 명칭일 뿐" 본인 재고 관리 대상이 아님.
- BOM 구성품은 각각 단독으로도 판매 가능한 일반 제품(non-phantom)이며, 개별 재고로 관리됨.
- POS 판매 시 phantom 본인 재고는 차감하지 않고, product_bom의 구성품을 분해 차감.
- 재고 화면/백필 대상에서 phantom 본인은 제외. 구성품(non-phantom)이 단독 SKU로 재고 추적됨.
- 사용자가 "세트상품 재고 얼마야?" 같은 질문을 하면, phantom의 BOM 구성품 중 가장 부족한 품목 기준으로 답해야 함.

[B2B 거래]
- b2b_partners: 거래처(법인/도매), b2b_partner_prices: 거래처별 제품 단가표
- b2b_sales_orders: B2B 납품, b2b_settlements: 수금/정산
- B2B 매출 → 회계 계정 4130(B2B매출)

[회계]
- gl_accounts: 계정과목, journal_entries+journal_entry_lines: 분개
- POS/매입/생산/반품/B2B 이벤트마다 분개 자동 생성
- VAT: 공급가=price÷1.1, 부가세=price×10/110
- accounting_period_closes: 월 마감 후 해당 기간 수정 차단

[배송]
- shipments: source=CAFE24(자사몰)/STORE(직접입력)
- delivery_type: PARCEL=택배(tracking_number + 알림톡 플로우), QUICK=퀵배송(당일 인편 — tracking 없이 현장 처리)
- status: PENDING→PRINTED→SHIPPED→DELIVERED (QUICK은 PRINTED 생략, SHIPPED부터 운영 일반적)
- tracking_number 등록 + SHIPPED 전환 시 알림톡 자동 발송 (PARCEL 한정)
- shipments.branch_id = 출고 지점(재고 차감 지점). POS 배송 주문에서 판매 지점(sales_orders.branch_id)과 다를 수 있음. "어느 지점에서 팔렸나"는 sales_orders.branch_id로, "어느 지점에서 나갔나"는 shipments.branch_id로 집계.

[반품]
- return_orders: 기존 sales_order 참조, 환불금액/포인트복원 포함
- 반품 완료 시 재고 복구(IN) + 환불 분개 자동 생성

[AI 에이전트 로그]
- agent_conversations: 매 대화 자동 저장 (user_message, assistant_response, tools_used, tokens, model)
- agent_memories: 대화에서 자동 추출된 별칭/패턴/오류/통찰. 시스템 프롬프트에 주입돼 재사용.
- /agent-memory 화면: 메모리 목록·필터·활성화 관리
- /agent-conversations 화면: 대화 이력 조회 — 본인 최근 30+건, 성공/실패 필터, 검색, 삭제. 관리자는 전체 조회 가능.
`;
