-- =====================================================
-- 경옥채 사내 통합시스템 DB 스키마
-- Technical Design Document v1.0 기반
-- =====================================================

-- =====================================================
-- 조직 관리 (매장/지점)
-- =====================================================
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('STORE', 'DEPT_STORE', 'ONLINE', 'EVENT')),
    address TEXT,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 사용자 관리 (회원/직원)
-- =====================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'HQ_OPERATOR', 'PHARMACY_STAFF', 'BRANCH_STAFF', 'EXECUTIVE')),
    branch_id UUID REFERENCES branches(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 카테고리 (제품 분류 - 계층형)
-- =====================================================
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    parent_id UUID REFERENCES categories(id),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 제품 (품목)
-- =====================================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    category_id UUID REFERENCES categories(id),
    unit VARCHAR(20) DEFAULT '개',
    price DECIMAL(12, 0) NOT NULL,
    cost DECIMAL(12, 0),
    barcode VARCHAR(50),
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- BOM (Bill of Materials - 제품 구성 정보)
-- =====================================================
CREATE TABLE product_bom (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id),
    material_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(10, 3) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(product_id, material_id)
);

-- =====================================================
-- 매장별 재고
-- =====================================================
CREATE TABLE inventories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INT NOT NULL DEFAULT 0,
    safety_stock INT DEFAULT 0,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(branch_id, product_id)
);

-- =====================================================
-- 재고 입출고 이력
-- =====================================================
CREATE TABLE inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    product_id UUID NOT NULL REFERENCES products(id),
    movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('IN', 'OUT', 'ADJUST', 'PRODUCTION')),
    quantity INT NOT NULL,
    reference_id UUID,
    reference_type VARCHAR(50),
    memo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 고객 (CRM)
-- =====================================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255),
    grade VARCHAR(20) DEFAULT 'NORMAL' CHECK (grade IN ('NORMAL', 'VIP', 'VVIP')),
    primary_branch_id UUID REFERENCES branches(id),
    cafe24_member_id VARCHAR(50),
    health_note TEXT,
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 고객 상담 기록 (반정형 JSONB)
-- =====================================================
CREATE TABLE customer_consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    consultation_type VARCHAR(50),
    content JSONB NOT NULL,
    consulted_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 고객 태그 분류
-- =====================================================
CREATE TABLE customer_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    color VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE customer_tag_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    tag_id UUID NOT NULL REFERENCES customer_tags(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(customer_id, tag_id)
);

-- =====================================================
-- 판매 전표 (거래)
-- =====================================================
CREATE TABLE sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(30) UNIQUE NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('STORE', 'DEPT_STORE', 'ONLINE', 'EVENT')),
    branch_id UUID NOT NULL REFERENCES branches(id),
    customer_id UUID REFERENCES customers(id),
    ordered_by UUID NOT NULL REFERENCES users(id),
    total_amount DECIMAL(12, 0) NOT NULL,
    discount_amount DECIMAL(12, 0) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'SHIPPED', 'COMPLETED', 'CANCELLED')),
    payment_method VARCHAR(20) CHECK (payment_method IN ('cash', 'card', 'kakao')),
    points_used INT DEFAULT 0,
    points_earned INT DEFAULT 0,
    cash_received DECIMAL(12, 0),
    change_amount DECIMAL(12, 0),
    cafe24_order_id VARCHAR(50),
    memo TEXT,
    ordered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 판매 전표 상세 항목
-- =====================================================
CREATE TABLE sales_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    unit_price DECIMAL(12, 0) NOT NULL,
    discount_amount DECIMAL(12, 0) DEFAULT 0,
    total_price DECIMAL(12, 0) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 적립금 내역
-- =====================================================
CREATE TABLE point_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    sales_order_id UUID REFERENCES sales_orders(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('earn', 'use', 'expire', 'adjust')),
    points INT NOT NULL,
    balance INT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 생산 지시서
-- =====================================================
CREATE TABLE production_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(30) UNIQUE NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    produced_by UUID REFERENCES users(id),
    produced_at TIMESTAMP WITH TIME ZONE,
    memo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 시즌 관리
-- =====================================================
CREATE TABLE seasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    season_type VARCHAR(20) CHECK (season_type IN ('NEW_YEAR', 'LUNAR_NEW_YEAR', 'CHUSEOK', 'EVENT', 'ETC')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    target_amount DECIMAL(12, 0),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 카카오톡 알림 내역
-- =====================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id),
    notification_type VARCHAR(50) NOT NULL,
    template_code VARCHAR(50),
    phone VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- Cafe24 연동 로그
-- =====================================================
CREATE TABLE cafe24_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type VARCHAR(50) NOT NULL,
    cafe24_order_id VARCHAR(50),
    data JSONB,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
    error_message TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- Indexes
-- =====================================================
CREATE INDEX idx_users_branch ON users(branch_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_inventories_branch ON inventories(branch_id);
CREATE INDEX idx_inventories_product ON inventories(product_id);
CREATE INDEX idx_inventory_movements_branch ON inventory_movements(branch_id);
CREATE INDEX idx_inventory_movements_product ON inventory_movements(product_id);
CREATE INDEX idx_customers_primary_branch ON customers(primary_branch_id);
CREATE INDEX idx_customers_grade ON customers(grade);
CREATE INDEX idx_customer_consultations_customer ON customer_consultations(customer_id);
CREATE INDEX idx_sales_orders_branch ON sales_orders(branch_id);
CREATE INDEX idx_sales_orders_customer ON sales_orders(customer_id);
CREATE INDEX idx_sales_orders_ordered_at ON sales_orders(ordered_at);
CREATE INDEX idx_sales_order_items_sales_order ON sales_order_items(sales_order_id);
CREATE INDEX idx_point_history_customer ON point_history(customer_id);
CREATE INDEX idx_notifications_customer ON notifications(customer_id);
CREATE INDEX idx_cafe24_sync_logs_status ON cafe24_sync_logs(status);
CREATE INDEX idx_seasons_active ON seasons(is_active) WHERE is_active = true;

-- =====================================================
-- RLS (Row Level Security)
-- =====================================================
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_tag_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE cafe24_sync_logs ENABLE ROW LEVEL SECURITY;

-- branches: 인증된 사용자만 접근
CREATE POLICY branches_select ON branches FOR SELECT TO authenticated USING (true);
CREATE POLICY branches_all ON branches FOR ALL TO authenticated USING (true);

-- users: admin과 manager만 전체 조회, staff는 본인만
CREATE POLICY users_select ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY users_all ON users FOR ALL TO authenticated USING (true);

-- products: 인증된 사용자만 조회
CREATE POLICY products_select ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY products_all ON products FOR ALL TO authenticated USING (true);

-- product_bom: 인증된 사용자만 접근
CREATE POLICY product_bom_all ON product_bom FOR ALL TO authenticated USING (true);

-- inventories: 매장별 접근 제한
CREATE POLICY inventories_select ON inventories FOR SELECT TO authenticated USING (true);
CREATE POLICY inventories_all ON inventories FOR ALL TO authenticated USING (true);

-- inventory_movements: 매장별 접근 제한
CREATE POLICY inventory_movements_select ON inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_movements_all ON inventory_movements FOR ALL TO authenticated USING (true);

-- customers: staff 이상 접근
CREATE POLICY customers_select ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY customers_all ON customers FOR ALL TO authenticated USING (true);

-- customer_consultations: staff 이상 접근
CREATE POLICY customer_consultations_all ON customer_consultations FOR ALL TO authenticated USING (true);

-- customer_tags: staff 이상 접근
CREATE POLICY customer_tags_all ON customer_tags FOR ALL TO authenticated USING (true);

-- customer_tag_map: staff 이상 접근
CREATE POLICY customer_tag_map_all ON customer_tag_map FOR ALL TO authenticated USING (true);

-- sales_orders: 매장별 접근 제한
CREATE POLICY sales_orders_select ON sales_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY sales_orders_all ON sales_orders FOR ALL TO authenticated USING (true);

-- sales_order_items: 거래 접근 시 같이 조회
CREATE POLICY sales_order_items_all ON sales_order_items FOR ALL TO authenticated USING (true);

-- point_history: 고객별 접근
CREATE POLICY point_history_all ON point_history FOR ALL TO authenticated USING (true);

-- production_orders: staff 이상 접근
CREATE POLICY production_orders_all ON production_orders FOR ALL TO authenticated USING (true);

-- seasons: staff 이상 접근
CREATE POLICY seasons_all ON seasons FOR ALL TO authenticated USING (true);

-- notifications: staff 이상 접근
CREATE POLICY notifications_all ON notifications FOR ALL TO authenticated USING (true);

-- cafe24_sync_logs: admin만 접근
CREATE POLICY cafe24_sync_logs_all ON cafe24_sync_logs FOR ALL TO authenticated USING (true);

-- =====================================================
-- Functions & Triggers
-- =====================================================

-- 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_inventories_updated_at BEFORE UPDATE ON inventories FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auth 사용자 자동 등록 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, password_hash, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.encrypted_password, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'PHARMACY_STAFF'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 전표번호 자동 생성
CREATE OR REPLACE FUNCTION generate_order_number(prefix VARCHAR, branch_code VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    seq_num INT;
    order_date VARCHAR(8);
BEGIN
    order_date := TO_CHAR(NOW(), 'YYYYMMDD');
    SELECT COALESCE(MAX(SUBSTRING(order_number FROM prefix || branch_code || '-####' FOR 15)), 0) + 1
    INTO seq_num
    FROM sales_orders
    WHERE order_number LIKE prefix || branch_code || '-%';
    
    RETURN prefix || branch_code || '-' || order_date || '-' || LPAD(seq_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ========== 초기 데이터 ==========

-- 기본 지점/매장
INSERT INTO branches (name, code, channel, address, phone) VALUES
('본사', 'HQ', 'STORE', '경옥채 본사', '02-0000-0000'),
('한약국', 'PHA', 'STORE', '한약국 주소', '02-1111-1111'),
('백화점 강남점', 'DS-GN', 'DEPT_STORE', '백화점 강남점', '02-2222-2222'),
('백화점 홍대점', 'DS-HD', 'DEPT_STORE', '백화점 홍대점', '02-3333-3333'),
('자사몬', 'ONLINE', 'ONLINE', '자사몬', '02-4444-4444');

-- 기본 카테고리
INSERT INTO categories (name, sort_order) VALUES
('한방식품', 1),
('건강기능식품', 2),
('전통차', 3),
('원재료', 4);

-- 기본 고객 태그
INSERT INTO customer_tags (name, description, color) VALUES
('VIP', '프리미엄 고객', '#FFD700'),
('재구매 대상', '재구매 알림 필요', '#4CAF50'),
('시즌고객', '시즌성 행사 고객', '#2196F3'),
('신규고객', '최근 등록 고객', '#9C27B0');
