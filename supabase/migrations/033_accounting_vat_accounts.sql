-- ═══════════════════════════════════════════════════════════════
-- 회계 계정과목 보완 — 부가세 처리를 위한 필수 계정 추가
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- 부가세예수금 (매출 시 고객에게 받은 VAT → 납부 의무)
INSERT INTO gl_accounts (code, name, account_type, sort_order)
VALUES ('2151', '부가세예수금', 'LIABILITY', 215)
ON CONFLICT (code) DO NOTHING;

-- 부가세대급금 (매입 시 공급자에게 지급한 VAT → 환급 권리)
INSERT INTO gl_accounts (code, name, account_type, sort_order)
VALUES ('1150', '부가세대급금', 'ASSET', 150)
ON CONFLICT (code) DO NOTHING;

-- 매출할인 (포인트 사용 등)
INSERT INTO gl_accounts (code, name, account_type, sort_order)
VALUES ('4190', '매출할인', 'REVENUE', 419)
ON CONFLICT (code) DO NOTHING;
