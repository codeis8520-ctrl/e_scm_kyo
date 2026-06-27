# Review Feedback — 판매일보 승인 팬텀 분해 차감 POS 동일화
Date: 2026-06-27
Ready for Builder: YES

## Must Fix
(없음)

## Should Fix
- daily-report-actions.ts:363, :388 — 자재/제품 select 폴백이 모든 에러에 대해 cost-only 재시도(`if (mres.error)`)인 반면, POS(actions.ts:2570)는 `/allow_decimal_stock/i` 메시지 일치 시에만 폴백한다. 동작 결과는 동일(컬럼 외 에러 시 양쪽 모두 allow_decimal=false로 수렴)하므로 무해. 굳이 맞추려면 POS와 같은 메시지 가드로 좁혀 일시 장애를 무음 폴백으로 가리지 않게 할 수 있음. 5분 내 수정 가능하면 인라인, 아니면 BUILD-LOG로. 비차단.

## Escalate to Architect
(없음)

## Cleared
computeStockDeltas 의 decompQty(raw<=0?0 : allow_decimal ? round(raw*10000)/10000 : Math.ceil(raw))·자재 allow_decimal_stock 로딩(+폴백)·팬텀 분해 루프(out/in/COGS) 및 approve/unpost 소비 경로를 POS processPosCheckout(actions.ts:2562-2583, 2872-2879)와 대조 검토. 검증 결과:

1. POS 동일성 — decompQty 의 양수 분기 공식이 POS 2874-2876과 문자 그대로 동일. raw<=0 가드는 POS 의 `if (totalQty<=0) continue` 와 등가(일보의 onsite/sample/in_return·c.quantity 는 항상 >=0). 침향 10환(자재=30환 base, allow_decimal=true, BOM quantity≈0.3333) → round(0.3333,4)=0.3333 으로 POS 와 일치. 집계 방식도 양쪽 모두 "행/아이템별 반올림 후 합산"으로 동일. 일치 확인.
2. allow_decimal 로딩 — 1차 products select(라인 product_id)와 자재 보강 select 양쪽 모두 allow_decimal 채움. cur 존재 시 갱신/미존재 시 신규 set 두 경로 다 채움. 컬럼 부재 폴백 시 undefined===true → false 로 안전 수렴. POS 와 등가.
3. 무회귀 — 비팬텀 경로(addTo outMap/inMap + onsite*cost) 완전 무변경. 슬롯선점(posted false→true 조건부 update), createSaleJournal 검증·실패 시 releaseSlot, 재고 적용 중 예외의 safe-limbo, 멱등(DAILY_REPORT_CANCEL 사전 차단 + 슬롯 가드), COGS 부호(5110차/1130대 self-balance) 모두 영향 없음.
4. in_return 팬텀 분해 — IN/OUT 이 동일 decompQty 로 대칭 산출되어 단위당 과복원/부호오류 없음. 비-소수 자재 Math.ceil(IN) 은 OUT 의 ceil 과 대칭이라 net 정합. POS 에 IN 경로가 없을 뿐 반올림 규칙 자체는 동일하게 적용되어 합리적.
5. COGS raw→cogsQty 변경 — 값만 미세 반올림. createSaleJournal 의 5110/1130 쌍은 동일 cogs 값을 양변에 쓰는 self-balance 라 대차 불변. unpost 의 역분개 cogs 는 잠긴 동일 라인으로 재계산되어 승인시점과 동일값 → 역분개 균형 유지.
6. out vs cogs 독립 반올림 — 재고 OUT 은 outQty=decompQty((onsite+sample)*q) 를 단일 반올림으로 직접 사용(cogsQty+sample 합산이 아님)하므로 재고 차감 총량은 정확. cogsQty 는 COGS(onsite-only 설계)에만 사용. 둘은 목적별 독립 산출로 각자 정확하며, sample/damage 원가는 본래 분개 미계상(기존 설계, 본 diff 무변경)이라 최대 0.0001 단위의 귀속 오차도 분개에 영향 없음. 의도된 허용 오차.

다단계 BOM(자재가 또 팬텀)은 POS 와 동일하게 단일 레벨 가정 — 본 diff 범위 밖(REVIEW-REQUEST Out of Scope 와 일치). 재고·회계 수치 정확성 이상 없음.
