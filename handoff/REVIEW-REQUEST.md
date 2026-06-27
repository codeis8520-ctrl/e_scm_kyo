# Review Request — 판매일보 승인 팬텀 분해 차감을 POS와 동일화
Date: 2026-06-27
Ready for Review: YES
🔴 실재고 차감 로직(Phase 2a 승인 경로). 마이그/schema 변경 없음.

build ✓.

## 배경 / 요구
사용자: "침향 10환을 일보에 기록·승인하면 (POS 일반 판매등록과) 동일하게 30환(base)에서 분수 차감돼야 한다." 침향 10환은 팬텀(is_phantom), 실재고는 30환 base에 있고 product_bom 으로 분수 차감(10/30≈0.333).

## 진단
- approveDailyReport → computeStockDeltas 가 이미 팬텀을 product_bom 으로 분해해 material(30환)에 OUT/IN 적립 → 30환 차감 자체는 동작 중이었음.
- **불일치 발견**: POS(processPosCheckout actions.ts:2872-2876)는 분해 자재 수량을 `decimalByMaterial ? round(raw,4) : Math.ceil(raw)` 로 처리하는데, computeStockDeltas 는 `out * c.quantity` raw(반올림/올림 없음) + 자재 allow_decimal_stock 미조회. → 비-소수 자재에 분수 기록 가능, 소수 자재는 정밀도 차이. "동일하게" 요구 미충족.

## 변경 (daily-report-actions.ts, computeStockDeltas 단일)
1. 자재 메타 로딩에 allow_decimal_stock 추가(+컬럼부재 폴백): `select('id, cost, allow_decimal_stock')` 실패 시 `select('id, cost')`.
2. decompQty 헬퍼 신설 = POS와 동일: `raw<=0?0 : allow_decimal ? Math.round(raw*10000)/10000 : Math.ceil(raw)`.
3. 팬텀 분해 루프: outMap/inMap/COGS 모두 decompQty 적용(out=onsite+sample, in=in_return, cogs=onsite분). 일반(비팬텀) 경로 무변경.

## 검증 포인트
1. POS 동일성: decompQty 가 POS 2872-2876과 동일 공식인가? 침향 10환(자재=30환 base, allow_decimal=true) → round(0.333…,4) 로 POS와 일치?
2. 비-소수 자재: Math.ceil 로 POS와 동일?
3. 무회귀: 일반 제품(비팬텀) 차감, approve/unpost 슬롯선점·분개·멱등, COGS 부호(5110/1130) 영향 없음?
4. in_return 팬텀 분해(POS엔 IN 경로 없음)에도 동일 반올림 적용이 합리적인가(과차감/과복원 없는가)?
5. COGS 를 raw→rounded(cogsQty)로 바꾼 게 분개 대차에 악영향 없는가(createSaleJournal 은 COGS 쌍 self-balance)?

## Out of Scope
- 팬텀 행의 일보 표시(오픈재고/시스템재고가 phantom은 0/무의미) — 이번은 차감 로직만(표시 개선 별도).
- 다단계 BOM(자재가 또 팬텀) — POS도 단일 레벨, 동일 가정.
