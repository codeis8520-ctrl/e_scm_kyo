-- 056_ensure_channels_seed.sql
-- 채널 기본 시드 보장 (idempotent) — schema.sql 시드가 누락된 환경 대응
-- 증상: 지점 추가 시 "branches_channel_fkey violates foreign key constraint" 발생
-- 원인: channels 테이블에 STORE/DEPT_STORE/ONLINE/EVENT 행이 없으면 FK 위반

INSERT INTO channels (id, name, color, sort_order)
VALUES
    ('STORE',      '한약국',  '#10b981', 1),
    ('DEPT_STORE', '백화점',  '#8b5cf6', 2),
    ('ONLINE',     '자사몰',  '#3b82f6', 3),
    ('EVENT',      '이벤트',  '#f59e0b', 4)
ON CONFLICT (id) DO NOTHING;
