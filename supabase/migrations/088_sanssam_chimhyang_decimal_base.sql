-- ═════════════════════════════════════════════════════════════════════════
-- 088: 산삼·침향 소수점 재고 실셋업 (#28 Step 2)
--
-- 모델: 30환(FSS30/FCH30)을 base(재고 추적·소수점 허용). 1환·10환은 팬텀 →
--       base 분수 BOM(1환=1/30, 10환=10/30)으로 분해 차감. POS 팬텀 분해가
--       1단계(비재귀)라, 선물/고급쇼 변형의 BOM도 10환 대신 base를 직접 참조하게
--       교체(중첩 팬텀 회피).
-- 정밀도: product_bom.quantity를 NUMERIC(14,4)로 올려 0.0333/0.3333 저장(소량오차 허용).
-- 재고 통합: 산삼 10환 잔량을 base(30환)로 ×10/30 환산 합산 후 10환 재고 0
--            (침향 10환·1환·산삼 1환은 재고 0이라 무영향).
-- 멱등: BOM insert는 NOT EXISTS 가드.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- 0) BOM 수량 정밀도 4자리 (기존 정수/3자리 값 보존)
ALTER TABLE product_bom ALTER COLUMN quantity TYPE NUMERIC(14,4);

-- 1) base(30환) 소수점 재고 허용
UPDATE products SET allow_decimal_stock = true WHERE code IN ('FSS30','FCH30');

-- 2) 기존 재고 통합: 산삼 10환 → base(FSS30) ×10/30, 그 후 10환 재고 0
--    (팬텀 전환 전에 먼저 옮긴다)
UPDATE inventories base
SET quantity = base.quantity + (ss10.quantity * 10.0/30.0)
FROM inventories ss10, products p10, products p30
WHERE p10.code='FSS10' AND ss10.product_id=p10.id
  AND p30.code='FSS30' AND base.product_id=p30.id
  AND base.branch_id=ss10.branch_id AND ss10.quantity <> 0;
UPDATE inventories SET quantity = 0
WHERE product_id = (SELECT id FROM products WHERE code='FSS10');

-- 3) 1환·10환을 팬텀(본인 재고 미사용). FCH10은 이미 팬텀.
UPDATE products SET is_phantom = true, track_inventory = false
WHERE code IN ('FSS01','FSS10','FCH01','FCH10');

-- 4) 팬텀 → base 분수 BOM (1환=0.0333, 10환=0.3333). 멱등.
INSERT INTO product_bom (product_id, material_id, quantity)
SELECT p.id, b.id, v.qty
FROM (VALUES
  ('FSS01','FSS30', 0.0333),
  ('FSS10','FSS30', 0.3333),
  ('FCH01','FCH30', 0.0333),
  ('FCH10','FCH30', 0.3333)
) AS v(pcode, bcode, qty)
JOIN products p ON p.code = v.pcode
JOIN products b ON b.code = v.bcode
WHERE NOT EXISTS (
  SELECT 1 FROM product_bom x WHERE x.product_id = p.id AND x.material_id = b.id
);

-- 5) 선물/고급쇼 변형 BOM: 10환 구성품 → base(30환) 0.3333로 교체(중첩 회피)
UPDATE product_bom bom
SET material_id = base.id, quantity = 0.3333
FROM products comp, products base
WHERE bom.material_id = comp.id
  AND comp.code IN ('FSS10','FCH10')
  AND base.code = CASE WHEN comp.code = 'FSS10' THEN 'FSS30' ELSE 'FCH30' END;

COMMIT;
