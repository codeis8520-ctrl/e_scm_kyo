// 경옥채 ERP 시스템 데이터베이스 스키마 및 업무 로직
export const DB_SCHEMA = `
== DATABASE SCHEMA ==

=== branches (지점/매장) ===
id: UUID (PK)
name: VARCHAR(100) - 지점명 (예: "본사", "한약국", "백화점 강남점")
code: VARCHAR(20) UNIQUE - 지점코드 (예: "HQ", "PHA", "DS-GN")
channel: VARCHAR(20) - 채널 (STORE, DEPT_STORE, ONLINE, EVENT)
address, phone: 주소/전화
is_active: BOOLEAN

=== products (제품) ===
id: UUID (PK)
name: VARCHAR(200) - 제품명
code: VARCHAR(50) UNIQUE - 제품코드 (KYO-XXXX-XXXXXX 형식)
barcode: VARCHAR(50) - 바코드
category_id: UUID (FK)
unit: VARCHAR(20) - 단위 (기본 "개")
price: DECIMAL(12,0) - 판매가
cost: DECIMAL(12,0) - 원가
is_active: BOOLEAN

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
quantity: INT
reference_id, reference_type: 참조
memo: TEXT
created_at: TIMESTAMP

=== customers (고객) ===
id: UUID (PK)
name: VARCHAR(100)
phone: VARCHAR(20) UNIQUE
email: VARCHAR(255)
grade: VARCHAR(20) - NORMAL, VIP, VVIP
primary_branch_id: UUID (FK) -> branches.id
cafe24_member_id: VARCHAR(50) - 카페24 연동 ID
source: VARCHAR(20) - CAFE24, DIRECT, POS
is_active: BOOLEAN

=== customer_grades (고객 등급) ===
code: VARCHAR(20) PK - NORMAL, VIP, VVIP
name: VARCHAR(50)
point_rate: DECIMAL(5,2) - 적립률 (NORMAL=1%, VIP=2%, VVIP=3%)

=== point_history (포인트 이력) ===
id: UUID (PK)
customer_id: UUID (FK) -> customers.id
sales_order_id: UUID (FK) -> sales_orders.id
type: VARCHAR(20) - earn(적립), use(사용), expire(만료), adjust(조정)
points: INT
balance: INT - 현재 잔액
description: TEXT

=== sales_orders (판매 주문) ===
id: UUID (PK)
order_number: VARCHAR(30) UNIQUE - SA-BRANCH-DATE-SUFFIX 형식
channel: VARCHAR(20) - STORE, DEPT_STORE, ONLINE, EVENT
branch_id: UUID (FK) -> branches.id
customer_id: UUID (FK) -> customers.id
ordered_by: UUID (FK) -> users.id
total_amount: DECIMAL(12,0) - 정상가 (총액법)
discount_amount: DECIMAL(12,0) - 할인액 (포인트 등)
points_used: INT - 사용 포인트
points_earned: INT - 적립 포인트
payment_method: cash, card, kakao
status: PENDING, CONFIRMED, SHIPPED, COMPLETED, CANCELLED
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
email, password_hash, name, phone
role: SUPER_ADMIN, HQ_OPERATOR, PHARMACY_STAFF, BRANCH_STAFF, EXECUTIVE
branch_id: UUID (FK) -> branches.id

=== channels ===
id: VARCHAR(20) PK - STORE, DEPT_STORE, ONLINE, EVENT
name: VARCHAR(100) - 한약국, 백화점, 자사몰, 이벤트
`;

export const BUSINESS_RULES = `
== 업무 규칙 ==

=== 총액법 회계 ===
- sales_orders.total_amount: 정상가 (제품 가격 × 수량의 합)
- sales_orders.discount_amount: 포인트 사용액 등 할인
- 최종 결제액 = total_amount - discount_amount
- points_earned: 최종 결제액 기준 적립

=== 포인트 적립/사용 ===
- 적립률: customer_grades.point_rate (NORMAL=1%, VIP=2%, VVIP=3%)
- points_earned = 최종결제액 × point_rate / 100
- 포인트 사용 시: points_used에 사용액, discount_amount에 동일값
- point_history.balance: 현재 잔액 (가장 최근记录的 balance 값)

=== 재고 이동 ===
1. 원래 지점: inventory_movements에 movement_type='OUT'으로 출고 기록, quantity 차감
2. 대상 지점: inventory_movements에 movement_type='IN'으로 입고 기록, quantity 증가
3. inventories 테이블의 quantity를 직접 UPDATE

=== 재고 조정 ===
- movement_type='ADJUST': inventory_movements에 기록
- quantity 변경: inventories 테이블 UPDATE

=== 채널별销售 ===
- STORE: 한약국 매장
- DEPT_STORE: 백화점
- ONLINE: 자사몰 (cafe24)
- EVENT: 행사
`;

export const SYSTEM_PROMPT = `
당신은 경옥채 ERP 시스템의 AI 어시스턴트입니다.

== 당신의 임무 ==
사용자의 텍스트 명령을 해석하여 시스템의 데이터를 조작하거나 정보를 제공합니다.

== 중요 원칙 ==
1. **신중하게 실행**: 모든 operation은 DB를 직접 변경합니다. 실수가 없어야 합니다.
2. **명확한 확인**: 복잡한 작업은 실행하기 전에 사용자에게 확인을 구합니다.
3. **결과 보고**: 작업 완료 후 자세히 보고합니다.
4. **에러 처리**: 문제가 있으면 즉시 알려줍니다.

== 명령어 해석 규칙 ==
- "재고 이동": inventories, inventory_movements 테이블 조작
- "포인트 적립/차감/조회": point_history 테이블 조작
- "고객 정보 조회/수정": customers 테이블 조작
- "판매 내역 조회": sales_orders, sales_order_items 테이블 조작
- "재고 현황": inventories, products 테이블 조회
- "제품 검색/조회": products 테이블 조회

== 출력 형식 ==
항상 JSON 형식으로 응답:
{
  "type": "info|action|confirm|error",
  "message": "설명",
  "action": { // type이 action 또는 confirm일 때
    "operation": "이동|적립|사용|조회|...",
    "table": "테이블명",
    "data": { 실제 데이터 }
  },
  "requiresConfirmation": true/false, // 확인 필요 여부
  "confirmationMessage": "확인 요청 메시지"
}

== DB 조작 시 필요한 정보 ==
- 지점명 -> branch_id 조회가 필요
- 제품명/코드 -> product_id 조회가 필요
- 고객 전화번호/이름 -> customer_id 조회가 필요
`;
