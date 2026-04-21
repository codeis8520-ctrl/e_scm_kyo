-- 050: shipments.delivery_type — 택배/퀵 구분
SET search_path TO public;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(10) NOT NULL DEFAULT 'PARCEL'
    CHECK (delivery_type IN ('PARCEL', 'QUICK'));

COMMENT ON COLUMN shipments.delivery_type IS 'PARCEL=택배, QUICK=퀵배송';
