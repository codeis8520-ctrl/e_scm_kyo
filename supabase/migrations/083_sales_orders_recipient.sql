-- ═════════════════════════════════════════════════════════════════════════
-- 083_sales_orders_recipient: sales_orders 받는분(수령자) 스냅샷 컬럼 추가
--
-- 배경:
--   카페24 주문은 주문자(buyer)와 받는분(수령자)이 다를 수 있다.
--   기존 sales_orders.buyer_name/buyer_phone = 주문자(주문한 사람) 스냅샷이다.
--   판매현황에서 받는분을 표시하려면 수령자 스냅샷이 별도로 필요하다.
--
-- 처리:
--   recipient_* 5개 컬럼을 nullable 로 추가 (shipments(012) 명명 일치).
--   멱등(IF NOT EXISTS). 기존 RLS/GRANT 변경 없음.
-- ═════════════════════════════════════════════════════════════════════════
SET search_path TO public;

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS recipient_zipcode TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS recipient_address TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS recipient_address_detail TEXT;

COMMENT ON COLUMN sales_orders.recipient_name IS '카페24 주문 받는분(수령자) 이름 스냅샷 — 판매현황 표시용. buyer_name=주문자, recipient_name=받는분';
COMMENT ON COLUMN sales_orders.recipient_phone IS '카페24 주문 받는분(수령자) 연락처 스냅샷 — 판매현황 표시용. buyer_phone=주문자, recipient_phone=받는분';
COMMENT ON COLUMN sales_orders.recipient_zipcode IS '카페24 주문 받는분(수령자) 우편번호 스냅샷 — 판매현황 표시용';
COMMENT ON COLUMN sales_orders.recipient_address IS '카페24 주문 받는분(수령자) 주소 스냅샷 — 판매현황 표시용';
COMMENT ON COLUMN sales_orders.recipient_address_detail IS '카페24 주문 받는분(수령자) 상세주소 스냅샷 — 판매현황 표시용';
