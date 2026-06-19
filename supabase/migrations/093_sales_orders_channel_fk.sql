-- 093_sales_orders_channel_fk.sql
-- sales_orders.channel 고정 CHECK → channels 테이블 FK 로 통일.
--
-- 증상: 판매입력 시 "가끔" new row for relation "sales_orders" violates check
--       constraint "sales_orders_channel_check".
-- 원인: branches.channel 은 channels(코드관리에서 추가 가능) FK 인데,
--       sales_orders.channel 은 ('STORE','DEPT_STORE','ONLINE','EVENT') 고정 CHECK 였다.
--       코드관리에서 추가한 커스텀 채널을 지점(매출처)에 지정 후 그 지점에서 판매하면
--       channel 값이 CHECK 4값에 없어 INSERT 가 거부됨(해당 매출처에서만 발생 → "가끔").
-- 해결: 고정 CHECK 제거 + channels(id) FK 로 교체 → 채널 추가가 자동 허용되고,
--       channels 에 없는 잘못된 값은 FK 가 계속 차단(확장성 + 정합성 동시 확보).

-- 1) 안전장치: 혹시 channels 에 없는 channel 값이 sales_orders 에 있으면 표준 채널로 보정.
--    (정상 흐름상 없어야 하지만 FK 추가 실패 방지)
UPDATE sales_orders so
SET channel = 'STORE'
WHERE channel IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM channels c WHERE c.id = so.channel);

-- 2) 고정 CHECK 제거
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_channel_check;

-- 3) channels FK 추가 (branches.channel 과 동일 정책). 채널 id 변경 시 함께 갱신.
ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_channel_fkey
  FOREIGN KEY (channel) REFERENCES channels(id) ON UPDATE CASCADE;
