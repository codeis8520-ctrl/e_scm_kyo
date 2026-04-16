export const DB_SCHEMA = `
== 핵심 테이블 스키마 ==

--- 지점·제품·재고 ---
branches: id, name, code, channel(STORE/DEPT_STORE/ONLINE/EVENT), address, phone, is_active
products: id, name, code, barcode, unit, price(판매가), cost(원가), product_type(FINISHED/RAW/SUB), is_active
  ※ product_type: FINISHED=완제품, RAW=원자재, SUB=부자재 — BOM 조립/필터의 기준
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
sales_orders: id, order_number(SA-...), channel, branch_id, customer_id, total_amount, discount_amount, points_used, points_earned, payment_method(cash/card/card_keyin/kakao/credit), credit_settled(bool), credit_settled_at, credit_settled_method, status(COMPLETED/CANCELLED/REFUNDED/PARTIALLY_REFUNDED), ordered_at
sales_order_items: id, sales_order_id, product_id, quantity, unit_price, discount_amount, total_price

--- 반품 ---
return_orders: id, return_number, original_order_id, branch_id, customer_id, processed_by, reason, reason_detail, refund_amount, refund_method, points_restored, status, processed_at
return_order_items: id, return_order_id, sales_order_item_id, product_id, quantity, unit_price, total_price

--- 매입 ---
suppliers: id, name, code, contact_name, phone, email, is_active
purchase_orders: id, order_number(PO-...), supplier_id, branch_id, status(DRAFT/CONFIRMED/PARTIALLY_RECEIVED/RECEIVED/CANCELLED), total_amount, ordered_at, memo
purchase_order_items: id, purchase_order_id, product_id, ordered_quantity, received_quantity, unit_price

--- 생산 ---
product_bom: id, product_id(완제품), material_id(원/부자재), quantity, loss_rate(%), notes, sort_order
  ※ 실제 소요량 = quantity × (1 + loss_rate/100)
production_orders: id, order_number(WO-...), product_id(완제품), branch_id, quantity, status(PENDING/IN_PROGRESS/COMPLETED/CANCELLED), started_at, completed_at, memo

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
shipments: id, source(CAFE24/STORE), cafe24_order_id, sales_order_id, sender_name, sender_phone, recipient_name, recipient_phone, recipient_address, tracking_number, status(PENDING/PRINTED/SHIPPED/DELIVERED), branch_id, created_at

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

[생산 워크플로우]
PENDING → IN_PROGRESS → COMPLETED
각 단계별 도구: create_production_order → start_production_order → complete_production_order
완료 시: BOM 원재료 재고 차감 + 완제품 재고 증가

[채널]
STORE=한약국 매장, DEPT_STORE=백화점, ONLINE=자사몰(카페24), EVENT=이벤트

[결제]
cash=현금, card=카드, card_keyin=카드수기, kakao=카카오페이, credit=외상
외상(credit): 반드시 고객 지정 필요, credit_settled=false → 정산 시 true

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
- status: PENDING→PRINTED→SHIPPED→DELIVERED
- tracking_number 등록 + SHIPPED 전환 시 알림톡 자동 발송

[반품]
- return_orders: 기존 sales_order 참조, 환불금액/포인트복원 포함
- 반품 완료 시 재고 복구(IN) + 환불 분개 자동 생성
`;
