-- ═══════════════════════════════════════════════════════════════════════════
-- 074_sales_orders_buyer_snapshot
--
-- 자사몰(카페24 ONLINE) 주문의 주문자(orderer) 이름·전화를 sales_orders 에
-- 스냅샷으로 보존. customer_id 연결 여부와 무관하게 판매현황에서 "비회원" 대신
-- 주문자명/전화가 보이도록 하는 표시용 비정규화 컬럼.
--
-- 정책:
--   · 순수 추가형(컬럼 2개). 기존 데이터 영향 없음(NULL).
--   · 고객 등록/연결은 webhook.ts 가 결제완료(paid) 시점에 phone/member_id 로
--     dedup 매칭 후 처리. 이 컬럼은 매칭 실패·게스트 주문도 표시 보장용.
--   · 개인정보: 자사몰에서 실제 결제한 주문자 정보(거래기록)에 한정 저장.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS buyer_name  TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS buyer_phone TEXT;

COMMENT ON COLUMN sales_orders.buyer_name  IS '주문자(orderer) 이름 스냅샷. 주로 자사몰(카페24) 동기화 시 billing_name/buyer.name 보존. customer_id 와 별개 표시용.';
COMMENT ON COLUMN sales_orders.buyer_phone IS '주문자(orderer) 전화 스냅샷(정규화 전 원본). 자사몰 동기화 시 buyer.cellphone 등 보존. 고객 dedup 매칭에도 사용.';
