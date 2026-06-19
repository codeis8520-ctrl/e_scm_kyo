# Review Request — processPosCheckout 라운드트립 최적화 (A/B/C/D1)
Date: 2026-06-19
Ready for Review: YES

돈·재고·포인트 핵심 경로. **동작/숫자 100% 보존, 라운드트립만 감소**가 합격 기준.
변경 함수는 `processPosCheckout` 단 하나. DB/마이그/AI schema 무변경.

## Files Changed (모두 src/lib/actions.ts, 함수 processPosCheckout)
- src/lib/actions.ts:2468-2502 — **C**: ⓪ products select에 is_taxable 추가, 폴백 체인 4단 확장, isTaxableByProduct 맵 동시 채움.
- src/lib/actions.ts:2569-2576 — **C**: 과세 블록의 별도 products 조회 삭제 → isTaxableByProduct 재사용, 게이트 `if (!taxErr)` → `if (isTaxableByProduct.size > 0)`.
- src/lib/actions.ts:2810-2887 — **B**: decrementStock 헬퍼 제거 + 재고 차감을 단일 SELECT → 병렬 UPDATE/INSERT → movements 배열 1회 INSERT 로 배치화. 합산 로직(normalMap/phantomMap)·산술·stockUpdates·movements 행 전부 보존.
- src/lib/actions.ts:2896-2912 — **D1**: point_history use+earn 2 insert → 배열 1회 insert(`[useRow, earnRow]`). balance JS 계산이라 순서/값 동일.
- src/lib/actions.ts:2916-2940 — **A**: ⑥ 알림 블록(customers+branches SELECT + fireNotificationTrigger)을 `void (async()=>{...})().catch(()=>{})` 로 감싸 await 제거(비차단). 바로 return.

## 라운드트립 표 (customer + 1품목 + 택배 기준)
| 단계 | Before | After |
|---|---|---|
| ⓪ products(type/track/phantom) | 1 | 1 |
| 과세 products(is_taxable) | 1 | **0** (C: ⓪에 흡수) |
| point rate (resolvePointRate) | 2 | 2 (D3 보류) |
| phantom BOM | 0~1 | 동일 |
| decimal material | 0~1 | 동일 |
| sales_orders insert | 1 | 1 |
| payments insert | 1 | 1 |
| shipments insert | 0~1 | 동일 |
| items insert | 1 | 1 |
| 차감 branches(메모) | 0~1 | 동일 |
| **재고 SELECT** | N키 | **1** (B) |
| **재고 UPDATE/INSERT** | N키(병렬) | N키(병렬, 변동無) |
| **movements INSERT** | N키 | **1** (B) |
| point_history select | 0~1 | 동일 |
| **point_history insert** | 1~2 | **1** (D1) |
| ⑥ customers+branches | 2 (응답차단) | 2 (**비차단**, A) |
| **응답 경로 합계** | **~13–15** | **~7–8** |

## 정확성 보존 (리뷰 포인트)
- **B**: before = `toNum(existing?.quantity)`, after = `before − qty` — decrementStock와 동일 산술. 신규행 시 INSERT(safety_stock:0). 단일 결제라 race 무관. movements 키별 1행(normal=POS_SALE/movementMemo, phantom=PHANTOM_DECOMPOSE/해당 memo). upsert/RPC 미사용.
- **C**: is_taxable 부재 시 `!== false` → true(전부 과세) 기존 폴백 동일. ⓪ 조회 실패 시 맵 비어 과세 블록 스킵 → taxable/exempt/vat = 0 (구 `!taxErr` 스킵과 동일).
- **D1**: 배열 [useRow, earnRow] 순서·type·points·balance·description 동일.
- **A**: 알림은 원래 fire-and-forget(.catch). await만 제거 — 신뢰성 등급 동일, 응답만 비차단.

## Open Questions
- 없음. B의 `stockIds.length > 0` 가드는 기존 빈-맵 시 Promise.all([]) 무동작과 동치.

## Out of Scope (logged in BUILD-LOG)
- D2(branches L2805/L2930 중복)·D3(resolvePointRate 순차 2쿼리) — 브리프 hold. 미적용.
