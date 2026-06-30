-- ═════════════════════════════════════════════════════════════════════════
-- 109_stock_movement_reversal → 창고이동 전표 취소(반대전표)·연결 (#94)
--
-- 배경: 완료된 창고이동을 직접 수정하면 재고 정합이 깨질 위험 → 취소전표/반대전표로 되돌림.
--   예) 본사→청담점 5개 취소 = 청담점→본사 5개 반대전표 자동 생성, 원전표는 '취소됨' 표시.
--   원전표 ↔ 반대전표를 reversal_of로 연결. 수정 사유·처리자·시각 보존.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE stock_movement_docs
  ADD COLUMN IF NOT EXISTS status        varchar(20) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / REVERSED(취소됨) / REVERSAL(반대전표)
  ADD COLUMN IF NOT EXISTS reversal_of   uuid REFERENCES stock_movement_docs(id),-- 반대전표 → 원전표
  ADD COLUMN IF NOT EXISTS cancel_reason text,                                    -- 취소(수정) 사유
  ADD COLUMN IF NOT EXISTS cancelled_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_smdocs_reversal_of ON stock_movement_docs(reversal_of);
CREATE INDEX IF NOT EXISTS idx_smdocs_status ON stock_movement_docs(status);
