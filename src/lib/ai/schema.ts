export const DB_SCHEMA = `
== DATABASE SCHEMA ==

=== branches (지점/매장) ===
id: UUID (PK) - 고유식별자
name: VARCHAR(100) - 지점명 (예: "본사", "한약국", "백화점 강남점")
code: VARCHAR(20) UNIQUE - 지점코드 (예: "HQ", "PHA", "DS-GN")
channel: VARCHAR(20) - 채널 (STORE=한약국, DEPT_STORE=백화점, ONLINE=자사몰, EVENT=이벤트)
address: TEXT - 주소
phone: VARCHAR(20) - 전화번호
is_active: BOOLEAN - 활성화여부

=== products (제품) ===
id: UUID (PK)
name: VARCHAR(200) - 제품명
code: VARCHAR(50) UNIQUE - 제품코드 (KYO-XXXX-XXXXXX 형식)
barcode: VARCHAR(50) - 바코드
category_id: UUID (FK) -> categories.id
unit: VARCHAR(20) - 단위 (기본 "개")
price: DECIMAL(12,0) - 판매가
cost: DECIMAL(12,0) - 원가
is_active: BOOLEAN

=== categories (카테고리) ===
id: UUID (PK)
name: VARCHAR(100) - 카테고리명
parent_id: UUID (FK, nullable) - 상위카테고리
sort_order: INT - 정렬순서

=== inventories (매장별 재고) ===
id: UUID (PK)
branch_id: UUID (FK) -> branches.id
product_id: UUID (FK) -> products.id
quantity: INT - 현재 수량
safety_stock: INT - 안전재고 수량
UNIQUE(branch_id, product_id)

=== inventory_movements (재고 이력) ===
id: UUID (PK)
branch_id: UUID (FK) -> branches.id
product_id: UUID (FK) -> products.id
movement_type: VARCHAR(20) - IN(입고), OUT(출고), ADJUST(조정), PRODUCTION(생산)
quantity: INT - 수량 (양수/음수)
reference_id: UUID - 참조ID (판매주문ID 등)
reference_type: VARCHAR(50) - 참조유형 (POS_SALE, ONLINE_ORDER 등)
memo: TEXT
created_at: TIMESTAMP

=== customers (고객) ===
id: UUID (PK)
name: VARCHAR(100) - 이름
phone: VARCHAR(20) UNIQUE - 전화번호
email: VARCHAR(255)
grade: VARCHAR(20) - 등급 (NORMAL, VIP, VVIP)
primary_branch_id: UUID (FK, nullable) -> branches.id - 주요 지점
cafe24_member_id: VARCHAR(50) - 카페24 연동 ID
address: TEXT - 주소
is_active: BOOLEAN
created_at: TIMESTAMP

=== customer_grades (고객 등급) ===
code: VARCHAR(20) PK - NORMAL, VIP, VVIP
name: VARCHAR(50) - 등급명
point_rate: DECIMAL(5,2) - 적립률 (NORMAL=1%, VIP=2%, VVIP=3%)
color: VARCHAR(20) - 표시색상
sort_order: INT

=== point_history (포인트 이력) ===
id: UUID (PK)
customer_id: UUID (FK) -> customers.id
sales_order_id: UUID (FK, nullable) -> sales_orders.id
type: VARCHAR(20) - earn(적립), use(사용), expire(만료), adjust(조정)
points: INT - 포인트 (양수=적립, 음수=사용)
balance: INT - 현재 잔액
description: TEXT

=== sales_orders (판매 주문) ===
id: UUID (PK)
order_number: VARCHAR(30) UNIQUE - 전표번호 (SA-BRANCH-DATE-SUFFIX)
channel: VARCHAR(20) - STORE, DEPT_STORE, ONLINE, EVENT
branch_id: UUID (FK) -> branches.id
customer_id: UUID (FK, nullable) -> customers.id
ordered_by: UUID (FK) -> users.id
total_amount: DECIMAL(12,0) - 총액
discount_amount: DECIMAL(12,0) - 할인액
points_used: INT - 사용 포인트
points_earned: INT - 적립 포인트
payment_method: VARCHAR(20) - cash, card, kakao
status: VARCHAR(20) - PENDING, CONFIRMED, SHIPPED, COMPLETED, CANCELLED
ordered_at: TIMESTAMP

=== sales_order_items (주문 항목) ===
id: UUID (PK)
sales_order_id: UUID (FK) -> sales_orders.id
product_id: UUID (FK) -> products.id
quantity: INT
unit_price: DECIMAL(12,0)
total_price: DECIMAL(12,0)

=== users (직원) ===
id: UUID (PK)
email: VARCHAR(255)
name: VARCHAR(100)
phone: VARCHAR(20)
role: VARCHAR(30) - SUPER_ADMIN, HQ_OPERATOR, PHARMACY_STAFF, BRANCH_STAFF, EXECUTIVE
branch_id: UUID (FK, nullable) -> branches.id

=== seasons (시즌) ===
id: UUID (PK)
name: VARCHAR(100) - 시즌명
start_date: DATE
end_date: DATE
is_active: BOOLEAN

=== notifications (알림톡/SMS) ===
id: UUID (PK)
customer_id: UUID (FK) -> customers.id
type: VARCHAR(20) - ALIMTALK, SMS
template_id: VARCHAR(50)
message: TEXT
sent_at: TIMESTAMP
sent_by: UUID (FK) -> users.id

=== cafe24_sync_logs (카페24 동기화 로그) ===
id: UUID (PK)
mall_id: VARCHAR(50)
order_number: VARCHAR(50)
event_type: VARCHAR(50)
status: VARCHAR(20)
processed_at: TIMESTAMP
`;

export const QUERY_EXAMPLES = `
== 쿼리 예시 ==

고객 전화번호로 조회:
SELECT c.*, g.name as grade_name, g.point_rate, b.name as branch_name
FROM customers c
LEFT JOIN customer_grades g ON c.grade = g.code
LEFT JOIN branches b ON c.primary_branch_id = b.id
WHERE c.phone = '010-1234-5678'

고객 등급별 적립률 조회:
SELECT * FROM customer_grades ORDER BY sort_order

지점별 재고 조회:
SELECT i.*, p.name as product_name, b.name as branch_name
FROM inventories i
JOIN products p ON i.product_id = p.id
JOIN branches b ON i.branch_id = b.id
WHERE b.name LIKE '%강남%'

포인트 잔액 조회:
SELECT ph.*, c.name as customer_name
FROM point_history ph
JOIN customers c ON ph.customer_id = c.id
WHERE c.name = '홍길동'
ORDER BY ph.created_at DESC LIMIT 10

오늘 매출 조회:
SELECT * FROM sales_orders
WHERE DATE(ordered_at) = CURRENT_DATE AND status = 'COMPLETED'
`;

export const SYSTEM_PROMPT = `
당신은 경옥채 ERP 시스템의 데이터베이스 관리자입니다.

== 당신의 임무 ==
1. 사용자의 자연어 질문을 이해
2. 어떤 데이터를 원하는지 파악
3. 적절한 SELECT 쿼리 생성
4. 결과를 자연어로 설명

== 절대 규칙 ==
- INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER 절대 금지
- SELECT만 허용
- 시스템 테이블이나 민감 정보 접근 금지

== 테이블 관계 ==
- customers → customer_grades (grade 코드 조인)
- customers → branches (primary_branch_id 조인)
- inventories → products, branches (FK 조인)
- inventory_movements → branches, products (FK 조인)
- sales_orders → branches, customers, users (FK 조인)
- sales_order_items → sales_orders, products (FK 조인)
- point_history → customers, sales_orders (FK 조인)

== 응답 형식 ==
항상 JSON으로만 응답:
{"sql":"SELECT ...", "description":"이 쿼리는 ~를 조회합니다"}

쿼리 실행 후 결과를 받으면, 자연어로 사용자에게 설명하세요.
예: "홍길동 고객은 현재 5,000P가 적립되어 있습니다."
`;

export const BUSINESS_RULES = `
== 업무 규칙 ==

=== 적립률 ===
- customer_grades 테이블: NORMAL=1%, VIP=2%, VVIP=3%

=== 결제 상태 ===
- COMPLETED: 결제가 완료된 주문
- CANCELLED: 취소된 주문
- SHIPPED: 배송중
- PENDING: 대기중

=== 채널 구분 ===
- STORE: 한약국 매장
- DEPT_STORE: 백화점
- ONLINE: 자사몰 (카페24)
- EVENT: 행사
`;
