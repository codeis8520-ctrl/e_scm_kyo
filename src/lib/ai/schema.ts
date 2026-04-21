export const DB_SCHEMA = `
== 핵심 테이블 스키마 ==

--- 지점·제품·재고 ---
branches: id, name, code, channel(STORE/DEPT_STORE/ONLINE/EVENT), address, phone, is_active
products: id, name, code, barcode, unit, price(판매가), cost(원가), cost_source(MANUAL/BOM), product_type(FINISHED/RAW/SUB), is_active
  ※ product_type: FINISHED=완제품, RAW=원자재, SUB=부자재 — BOM 조립/필터의 기준
  ※ cost_source=BOM이면 완제품 cost는 BOM 합계에서 자동 산정(서버 액션). RAW/SUB는 판매가 미사용(price=cost로 동기화).
product_files: id, product_id, file_url, file_name, file_type(image/document), sort_order
inventories: id, branch_id, product_id, quantity, safety_stock  [UNIQUE(branch_id, product_id)]
inventory_movements: id, branch_id, product_id, movement_type(IN/OUT/ADJUST/TRANSFER/PRODUCTION), quantity, memo, created_at

--- 고객·CRM ---
customers: id, name, phone, email, grade(NORMAL/VIP/VVIP), primary_branch_id, address, health_note, is_active
customer_grades: code(NORMAL/VIP/VVIP), name, point_rate(1%/2%/3%), is_active
customer_consultations: id, customer_id, consultation_type, content(JSONB), consulted_by, created_at
point_history: id, customer_id, sales_order_id, type(earn/use/adjust/expire), points, balance, description
  ※ 고객 현재 포인트 = point_history에서 해당 고객의 최신 balance 값

--- 판매(POS) ---
sales_orders: id, order_number(SA-...), channel, branch_id, customer_id, ordered_by(담당자), total_amount, discount_amount, points_used, points_earned, payment_method(cash/card/card_keyin/kakao/credit/cod/mixed), credit_settled(bool), credit_settled_at, credit_settled_method, memo, status(COMPLETED/CANCELLED/REFUNDED/PARTIALLY_REFUNDED), ordered_at, receipt_status(RECEIVED/PICKUP_PLANNED/QUICK_PLANNED/PARCEL_PLANNED), receipt_date, approval_status(COMPLETED/CARD_PENDING/UNSETTLED), payment_info
  ※ receipt_status=수령현황(수령완료/방문예정/퀵예정/택배예정). 기본 RECEIVED. 배송 활성 시 PARCEL_PLANNED/QUICK_PLANNED 자동 지정.
  ※ approval_status=결제 승인 라이프사이클(status와 직교). card_keyin→CARD_PENDING, credit→UNSETTLED 자동 추론 가능.
  ※ payment_info=레거시 자유기입 컬럼(2026-04 UI 제거). 신규 입력 없음. 과거 데이터 조회만 노출.
  ※ ordered_by=판매·상담 담당자.
sales_order_items: id, sales_order_id, product_id, quantity, unit_price, discount_amount, total_price, order_option, delivery_type(PICKUP/PARCEL/QUICK), receipt_status(RECEIVED/PICKUP_PLANNED/QUICK_PLANNED/PARCEL_PLANNED), receipt_date
  ※ order_option=품목별 부가 옵션(보자기 포장/쇼핑백/색상/서비스 지급 등).
  ※ delivery_type=품목별 배송 방식 — 같은 전표에서 품목별로 다를 수 있음(예: 3품목 중 1품목만 택배, 2품목 현장수령). 단 shipments는 주문당 1건 유지(수령지 1곳만 전제; 2곳 이상은 새 전표 분리).
  ※ receipt_status=품목별 수령 상태. sales_orders.receipt_status는 품목 상태 집계 결과. 품목 전부 RECEIVED이면 주문 RECEIVED + shipments.status=DELIVERED 자동.
  ※ shipments.items_summary는 PICKUP 제외, PARCEL/QUICK 품목만 요약.
sales_order_payments: id, sales_order_id, payment_method, amount, approval_no, card_info, memo, paid_at, created_by
  ※ 한 주문의 다중 결제(분할). 합계<총액이면 잔액=외상. payment_method='mixed'면 세부는 이 테이블에.

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
shipments: id, source(CAFE24/STORE), delivery_type(PARCEL/QUICK), cafe24_order_id, sales_order_id, sender_name, sender_phone, recipient_name, recipient_phone, recipient_address, tracking_number, status(PENDING/PRINTED/SHIPPED/DELIVERED), branch_id, created_at
  ※ branch_id = 출고 지점 (재고가 차감된 지점). POS에서 배송 활성 시 판매 지점과 다를 수 있음. 판매 지점은 sales_orders.branch_id 참조.
  ※ delivery_type: PARCEL=택배(SweetTracker 송장·알림톡), QUICK=퀵배송(당일 인편·직접 배송).

--- 알림·캠페인 ---
notifications: id, customer_id, type(SMS/ALIMTALK), message, status(sent/failed/pending), sent_at, sent_by
notification_template_mappings: solapi_template_id, event_type, is_manual_sendable, description
notification_campaigns: id, name, event_type, start_date, end_date, is_recurring, target_grade, target_branch_id, solapi_template_id, auto_send, status(DRAFT/ACTIVE/SENT/COMPLETED/CANCELLED), sent_count, failed_count
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

[발주 워크플로우]
DRAFT → CONFIRMED → RECEIVED
각 단계별 도구: create_purchase_order → confirm_purchase_order → receive_purchase_order
입고(RECEIVED) 시 재고 자동 증가

[생산 워크플로우 — OEM 위탁 모델]
PENDING → IN_PROGRESS → COMPLETED
본사에서만 지시 가능. 각 지시는 OEM 공장에 위탁하고, 완성품은 지정한 입고 지점(기본 본사)으로 직접 입고.
완료 시:
  ① BOM에 등록된 부자재(본사 조달품)를 입고 지점 재고에서 차감 — BOM qty × 생산 수량 × (1+loss%), 올림. 재고 부족 시 완료 불가(에러).
  ② 완제품 재고를 입고 지점에 증가.
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
