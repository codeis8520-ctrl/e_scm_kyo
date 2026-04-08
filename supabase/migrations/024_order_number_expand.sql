-- 카페24 주문번호 형식 (C24-{mallId}-YYYYMMDD-NNNNNNN)이 30자를 초과하는 경우가 있어
-- order_number 길이 확장
ALTER TABLE sales_orders  ALTER COLUMN order_number TYPE varchar(60);
ALTER TABLE return_orders ALTER COLUMN return_number TYPE varchar(60);
