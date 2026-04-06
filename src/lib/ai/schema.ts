export const DB_SCHEMA = `
== 핵심 테이블 스키마 ==

branches: id, name, code, channel(STORE/DEPT_STORE/ONLINE/EVENT), address, phone, is_active
products: id, name, code, barcode, unit, price(판매가), cost(원가), is_active
inventories: id, branch_id, product_id, quantity, safety_stock  [UNIQUE(branch_id, product_id)]
inventory_movements: id, branch_id, product_id, movement_type(IN/OUT/ADJUST/TRANSFER/PRODUCTION), quantity, memo, created_at

customers: id, name, phone, email, grade(NORMAL/VIP/VVIP), primary_branch_id, address, health_note, is_active
customer_grades: code(NORMAL/VIP/VVIP), name, point_rate(1%/2%/3%), is_active
point_history: id, customer_id, sales_order_id, type(earn/use/adjust/expire), points, balance, description
  ※ 고객 현재 포인트 = point_history에서 해당 고객의 최신 balance 값

sales_orders: id, order_number(SA-...), channel, branch_id, customer_id, total_amount, discount_amount, points_used, points_earned, payment_method(cash/card/kakao), status(COMPLETED/CANCELLED/REFUNDED/PARTIALLY_REFUNDED), ordered_at
sales_order_items: id, sales_order_id, product_id, quantity, unit_price, discount_amount, total_price

suppliers: id, name, code, contact_name, phone, email, is_active
purchase_orders: id, order_number(PO-...), supplier_id, branch_id, status(DRAFT/CONFIRMED/PARTIALLY_RECEIVED/RECEIVED/CANCELLED), total_amount, ordered_at, memo
purchase_order_items: id, purchase_order_id, product_id, ordered_quantity, received_quantity, unit_price

bom: id, product_id(완제품), material_id(원재료), quantity_required
production_orders: id, order_number(WO-...), product_id(완제품), branch_id, quantity, status(PENDING/IN_PROGRESS/COMPLETED/CANCELLED), started_at, completed_at, memo

notifications: id, customer_id, type(SMS/ALIMTALK), message, status(sent/failed/pending), sent_at, sent_by
users: id, name, email, phone, role(SUPER_ADMIN/HQ_OPERATOR/PHARMACY_STAFF/BRANCH_STAFF/EXECUTIVE), branch_id
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
cash=현금, card=카드, kakao=카카오페이

[포인트]
1P = 1원 할인. 포인트 적립 = 결제금액 × 등급별 적립률.

[자주 쓰는 패턴]
- "이번달 매출" → get_sales_summary(period: "this_month")
- "지난달 대비" → compare_sales(period1=이번달, period2=지난달)
- "재고 부족" → get_low_stock
- "전체 고객 등급 올려줘" → upgrade_customer_grades (확인 필요)
- "VIP한테 문자" → bulk_send_sms(grade: "VIP", ...)
`;
