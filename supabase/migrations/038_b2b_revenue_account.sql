-- Migration 038: B2B 매출 전용 계정 추가
-- 채널별 매출 분리를 위해 B2B 납품 매출을 별도 계정으로 관리

INSERT INTO gl_accounts (code, name, account_type, sort_order)
VALUES ('4130', 'B2B매출', 'REVENUE', 413)
ON CONFLICT (code) DO NOTHING;
