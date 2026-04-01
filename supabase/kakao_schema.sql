-- =====================================================
-- 카카오채널/알림톡 연동 스키마
-- =====================================================

-- 알림 템플릿 관리
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code VARCHAR(50) UNIQUE NOT NULL,
    template_name VARCHAR(100) NOT NULL,
    message_template TEXT NOT NULL,
    buttons JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 고객별 카카오 연동 정보
CREATE TABLE IF NOT EXISTS customer_kakao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    kakao_id VARCHAR(100),
    notification_agree BOOLEAN DEFAULT false,
    agree_date TIMESTAMP WITH TIME ZONE,
    last_sent_at TIMESTAMP WITH TIME ZONE,
    is_valid BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(customer_id)
);

-- 알림 발송 이력 (기존 notifications 확장)
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES notification_templates(id),
ADD COLUMN IF NOT EXISTS kakao_user_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES users(id);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_notification_templates_active ON notification_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_customer_kakao_customer ON customer_kakao(customer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_customer ON notifications(customer_id);

-- 초기 알림 템플릿
INSERT INTO notification_templates (template_code, template_name, message_template, is_active) VALUES
('ORDER_COMPLETE', '주문 완료 알림', '안녕하세요 {{customer_name}}님, 주문이 완료되었습니다.\n\n📦 상품: {{product_name}}\n💰 금액: {{amount}}원\n\n감사합니다.', true),
('REPURCHASE_ALERT', '재구매 안내', '안녕하세요 {{customer_name}}님, {{product_name}} 재구매時期가 되었습니다.\n\n최근 구매: {{last_purchase_date}}\n정기적으로 섭취하시는 건강관리에 도움을 드립니다.', true),
('EVENT_INVITE', '이벤트 초대', '안녕하세요 {{customer_name}}님, 특별한 evento에 초대합니다!\n\n🎉 {{event_name}}\n📅 {{event_date}}\n\n행사 전용 상품을 준비했습니다.', true),
('MEMBERSHIP_UPDATE', '멤버십 등급 안내', '축하합니다! {{customer_name}}님의 등급이 {{new_grade}}로 upgrade되었습니다.\n\n변경일: {{change_date}}\n前来 혜택을 확인해보세요!', true)
ON CONFLICT (template_code) DO NOTHING;
