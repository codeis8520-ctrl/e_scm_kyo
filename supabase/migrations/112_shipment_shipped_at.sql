-- ═════════════════════════════════════════════════════════════════════════
-- 112_shipment_shipped_at → 발송일(shipped_at) 신설 (택배관리 날짜 정합)
--
-- 배경: 택배관리 '수령/택배예정일'이 연결 주문 receipt_date(택배예정일)를 표시하는데,
--   택배예정일을 실제 2~3일 후로 잡아 저장하는 전표가 많음 → 발송완료 건도 그 미래 예정일이
--   그대로 떠 발송 시점과 어긋남. #90: 발송완료=수령완료지만 '언제 발송했는가'는 별개 정보.
--   → shipped_at 신설. 발송완료/배송완료 건은 발송일, 대기/택배예정 건은 택배예정일을 표시.
--   기존 SHIPPED/DELIVERED는 updated_at(없으면 created_at)으로 근사 백필.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz;   -- 실제 발송일(상태가 SHIPPED로 전환된 시점)

-- 기존 발송완료/배송완료 건 근사 백필(발송 시점 ≈ 마지막 갱신 시각).
UPDATE shipments
SET shipped_at = COALESCE(updated_at, created_at)
WHERE status IN ('SHIPPED', 'DELIVERED') AND shipped_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_shipped_at ON shipments(shipped_at);
