-- ═══════════════════════════════════════════════════════════════
-- OEM 위탁 생산 모델
--   - oem_factories: 위탁 공장 마스터
--   - production_orders.oem_factory_id: 어느 공장에 위탁했는지
--   - branches.is_headquarters: 본사 지점 표시 (생산 지시 기본 입고처 + 권한 체크)
--   ※ 생산 완료 시 원/부자재 차감은 코드에서 제거(옵션 A: OEM 자체 조달)
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- 1) OEM 공장 마스터
CREATE TABLE IF NOT EXISTS oem_factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE,
  name VARCHAR(200) NOT NULL,
  business_number VARCHAR(50),
  representative VARCHAR(100),
  contact_name VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(200),
  address TEXT,
  memo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE oem_factories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oem_factories_all ON oem_factories;
CREATE POLICY oem_factories_all ON oem_factories FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE oem_factories IS 'OEM 위탁 생산 공장 마스터. production_orders.oem_factory_id 참조.';

-- 2) production_orders 에 oem_factory_id 추가 (기존 branch_id 는 "입고 지점"으로 의미 재정의)
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS oem_factory_id UUID REFERENCES oem_factories(id);

CREATE INDEX IF NOT EXISTS idx_production_orders_oem ON production_orders(oem_factory_id);

COMMENT ON COLUMN production_orders.oem_factory_id IS '생산 위탁한 OEM 공장';
COMMENT ON COLUMN production_orders.branch_id IS '완제품 입고 지점 (기본: 본사)';

-- 3) branches.is_headquarters 표시 (한 개만 true 되도록 부분 유니크)
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS ux_branches_single_hq
  ON branches ((1))
  WHERE is_headquarters = true;

COMMENT ON COLUMN branches.is_headquarters IS '본사 지점 여부. 생산 지시 기본 입고처. 한 개만 true.';

-- 4) 네비게이션 권한 (기존 /production 이 있으면 OEM 공장 관리는 같은 경로 서브탭이라 별도 권한 불필요)
