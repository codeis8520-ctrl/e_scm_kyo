-- =====================================================
-- Migration 060: POS 판매 전표 임시저장
-- =====================================================
-- 사용자가 결제 직전 상태(고객, 카트, 배송, 메모 등)를 통째로 저장했다가
-- 나중에 다시 불러와 이어 작성할 수 있도록 하는 임시 저장 슬롯.
--
-- 멀티 디바이스/직원 교대 인계 가능하도록 Supabase에 영속화.
-- 결제 완료(processPosCheckout)와 무관 — 별도 라이프사이클.

CREATE TABLE IF NOT EXISTS sales_order_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_snapshot JSONB,         -- {name, phone, grade} — 비회원·즉석등록 백업
  cart_items      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- CartItem[]
  delivery_info   JSONB DEFAULT '{}'::jsonb,            -- ShippingForm
  payment_info    JSONB DEFAULT '{}'::jsonb,            -- {paymentMethod, splitMode, extraPayments, ...}
  meta_info       JSONB DEFAULT '{}'::jsonb,            -- {saleDate, receiptStatus, receiptDate, approvalStatus, shipFromBranchId, handlerId}
  memo            TEXT,
  title           TEXT,                                  -- 사용자 라벨 (옵션)
  total_amount    INTEGER NOT NULL DEFAULT 0,            -- 빠른 표시용 캐시 (할인 전)
  item_count      INTEGER NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_drafts_branch ON sales_order_drafts(branch_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_drafts_user   ON sales_order_drafts(created_by, updated_at DESC);

-- updated_at 자동 갱신
DROP TRIGGER IF EXISTS trg_sales_drafts_updated_at ON sales_order_drafts;
CREATE TRIGGER trg_sales_drafts_updated_at
BEFORE UPDATE ON sales_order_drafts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sales_order_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_drafts_all ON sales_order_drafts;
CREATE POLICY sales_drafts_all ON sales_order_drafts FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE sales_order_drafts IS 'POS 판매 전표 임시저장 — 결제 완료된 sales_orders와 무관한 별도 라이프사이클.';
COMMENT ON COLUMN sales_order_drafts.cart_items IS '장바구니 직렬화: [{productId, name, price, quantity, discount, orderOption, deliveryType}]';
COMMENT ON COLUMN sales_order_drafts.delivery_info IS 'ShippingForm 직렬화 (수령자/주소/요청사항/발송인)';
COMMENT ON COLUMN sales_order_drafts.payment_info IS '결제 진행 상태 (paymentMethod, splitMode, extraPayments, deptApprovalNo 등)';
COMMENT ON COLUMN sales_order_drafts.meta_info IS '전표 메타 (saleDate, receiptStatus, receiptDate, approvalStatus, shipFromBranchId, handlerId)';
