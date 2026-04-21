-- 051: 판매 입력 워크플로 필드 추가
-- PDF 스펙(2026-04-21 판매입력 화면) 반영: 수령현황, 수령일자, 승인상태, 결제정보, 품목별 주문옵션
SET search_path TO public;

-- 수령 현황 (방문·퀵·택배 예정 / 수령 완료)
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(20)
    CHECK (receipt_status IN ('RECEIVED', 'PICKUP_PLANNED', 'QUICK_PLANNED', 'PARCEL_PLANNED'))
    DEFAULT 'RECEIVED';
COMMENT ON COLUMN sales_orders.receipt_status IS
  'RECEIVED=수령완료, PICKUP_PLANNED=방문예정, QUICK_PLANNED=퀵예정, PARCEL_PLANNED=택배예정';

-- 수령(예정) 일자
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS receipt_date DATE;
COMMENT ON COLUMN sales_orders.receipt_date IS
  '수령 현황에 해당하는 행위가 일어날/일어난 일자. 기본값 없음(현장 판매는 ordered_at으로 추론 가능).';

-- 승인 상태 (결제 승인 라이프사이클 — status/credit_settled와 직교)
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20)
    CHECK (approval_status IN ('COMPLETED', 'CARD_PENDING', 'UNSETTLED'))
    DEFAULT 'COMPLETED';
COMMENT ON COLUMN sales_orders.approval_status IS
  'COMPLETED=결제완료, CARD_PENDING=미승인(카드 키인 대기), UNSETTLED=미결(계좌이체 대기).';

-- 결제정보 메모 (카드정보/승인일자/안내 계좌 등 자유기입)
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS payment_info TEXT;
COMMENT ON COLUMN sales_orders.payment_info IS
  '결제 관련 자유 기입(카드번호 마지막 4자리, 승인일자, 계좌 안내, CS 메모 등).';

-- 품목별 주문 옵션 (보자기/쇼핑백/색상/서비스/혼합 배송 기록)
ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS order_option VARCHAR(200);
COMMENT ON COLUMN sales_order_items.order_option IS
  '품목별 부가 옵션(보자기 포장, 쇼핑백, 색상, 서비스 지급, 같은 전표 내 배송 방식 차이 등).';

-- 운영 필터용 인덱스 (방문예정/미결 건 빠른 조회)
CREATE INDEX IF NOT EXISTS idx_sales_orders_receipt_status
  ON sales_orders(receipt_status) WHERE receipt_status <> 'RECEIVED';
CREATE INDEX IF NOT EXISTS idx_sales_orders_approval_status
  ON sales_orders(approval_status) WHERE approval_status <> 'COMPLETED';
