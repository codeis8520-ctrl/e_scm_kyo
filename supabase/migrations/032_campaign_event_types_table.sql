-- 캠페인 이벤트 유형을 DB에서 관리 (시스템 코드 관리 화면)
SET search_path TO public;

CREATE TABLE IF NOT EXISTS campaign_event_types (
  code varchar(30) PRIMARY KEY,
  name varchar(50) NOT NULL,
  emoji varchar(10) DEFAULT '📢',
  is_recurring_default boolean NOT NULL DEFAULT false,
  default_month int,
  default_day int,
  default_duration_days int DEFAULT 7,
  sort_order int DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE campaign_event_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY cet_all ON campaign_event_types FOR ALL USING (true) WITH CHECK (true);

-- 기본 데이터
INSERT INTO campaign_event_types (code, name, emoji, is_recurring_default, default_month, default_day, default_duration_days, sort_order) VALUES
  ('SEOLLAL',        '설날',              '🧧', true,  1,  20, 10, 1),
  ('CHUSEOK',        '추석',              '🎑', true,  9,  10, 10, 2),
  ('PARENTS_DAY',    '어버이날',          '💐', true,  5,   1,  8, 3),
  ('TEACHERS_DAY',   '스승의날',          '🎓', true,  5,  10,  7, 4),
  ('CHRISTMAS',      '크리스마스',        '🎄', true, 12,  20,  7, 5),
  ('NEW_YEAR',       '새해 인사',         '🎆', true,  1,   1,  3, 6),
  ('VALENTINES',     '발렌타인/화이트데이','💝', true,  2,  10, 10, 7),
  ('SUMMER',         '여름 보양식 시즌',  '☀️', true,  7,   1, 30, 8),
  ('VIP_EXCLUSIVE',  'VIP 전용 이벤트',   '👑', false, NULL, NULL, 7, 9),
  ('PRODUCT_LAUNCH', '신제품 출시',       '🆕', false, NULL, NULL, 14, 10),
  ('SEASONAL',       '계절 프로모션',     '🍂', false, NULL, NULL, 14, 11),
  ('CUSTOM',         '기타',             '📢', false, NULL, NULL, 7, 99)
ON CONFLICT (code) DO NOTHING;
