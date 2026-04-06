SET search_path TO public;

CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(20) NOT NULL CHECK (source IN ('CAFE24', 'STORE')),
  cafe24_order_id VARCHAR(50),
  sales_order_id UUID REFERENCES sales_orders(id),

  sender_name VARCHAR(100) NOT NULL,
  sender_phone VARCHAR(20) NOT NULL,

  recipient_name VARCHAR(100) NOT NULL,
  recipient_phone VARCHAR(20) NOT NULL,
  recipient_zipcode VARCHAR(10),
  recipient_address TEXT NOT NULL,
  recipient_address_detail VARCHAR(200),
  delivery_message TEXT,

  items_summary TEXT,

  tracking_number VARCHAR(50),
  status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PRINTED', 'SHIPPED', 'DELIVERED')),

  branch_id UUID REFERENCES branches(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_shipments_cafe24 ON shipments(cafe24_order_id);
CREATE INDEX idx_shipments_created_at ON shipments(created_at);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipments_all ON shipments FOR ALL TO authenticated USING (true);

-- 네비게이션 권한
INSERT INTO screen_permissions (role, screen_path, can_view, can_edit) VALUES
  ('SUPER_ADMIN',    '/shipping', true, true),
  ('HQ_OPERATOR',    '/shipping', true, true),
  ('BRANCH_STAFF',   '/shipping', true, true),
  ('PHARMACY_STAFF', '/shipping', true, false)
ON CONFLICT DO NOTHING;
