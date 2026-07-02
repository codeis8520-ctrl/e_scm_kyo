-- 115_stock_movement_107: #107 재고변동전표 고도화
--   (1) 자가소모(USAGE) 품목별 사유 — stock_movement_doc_items 라인별 usage_type_id + reason
--   (2) 업무 기준일자 — stock_movement_docs.movement_date (USAGE/ADJUST 백데이트/정정)
--   (3) 사용유형 확장 시드 (파손/폐기/재고오류/직원사용/행사소모/거래처전달)

-- (1) 라인별 사유 ------------------------------------------------------------
--   한 자가소모 전표 안에서도 품목마다 사유가 다를 수 있음(시음/파손/폐기 등).
--   헤더 usage_type_id 는 기본값, 라인 usage_type_id 가 우선.
ALTER TABLE stock_movement_doc_items
  ADD COLUMN IF NOT EXISTS usage_type_id UUID REFERENCES inventory_usage_types(id),
  ADD COLUMN IF NOT EXISTS reason        TEXT;

COMMENT ON COLUMN stock_movement_doc_items.usage_type_id IS
  '#107 자가소모(USAGE) 품목별 사유. 헤더 usage_type_id 는 기본값이고 라인 값이 우선.';
COMMENT ON COLUMN stock_movement_doc_items.reason IS
  '#107 품목별 사유 자유 메모(선택).';

-- (2) 업무 기준일자(전표 헤더) ------------------------------------------------
--   현황·이력·재고에 반영되는 "사용자 입력 업무일자". 전표생성일시(created_at)는 내부 로그.
--   TRANSFER 는 ship_date/arrival_date 로 이미 처리 → USAGE/ADJUST 가 이 컬럼을 사용.
ALTER TABLE stock_movement_docs
  ADD COLUMN IF NOT EXISTS movement_date DATE;

COMMENT ON COLUMN stock_movement_docs.movement_date IS
  '#107 업무 기준일자(사용자 입력). USAGE/ADJUST 의 현황·이력·재고 기준일. created_at 은 내부 로그.';

-- (3) 사용유형 확장 — #107 요구 사유(멱등). 시음(SAMPLE)·자가사용·로스·기타는 079 시드에 존재.
INSERT INTO inventory_usage_types (code, name, sort_order, is_system) VALUES
  ('DAMAGE',    '파손',       40, FALSE),
  ('DISPOSAL',  '폐기',       50, FALSE),
  ('STOCK_ERR', '재고오류',   60, FALSE),
  ('STAFF_USE', '직원사용',   70, FALSE),
  ('EVENT_USE', '행사소모',   80, FALSE),
  ('PARTNER',   '거래처전달', 85, FALSE)
ON CONFLICT (code) DO NOTHING;
