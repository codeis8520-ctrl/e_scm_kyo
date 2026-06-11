# Review Feedback — Step 1 (수령 전 전표 품목 추가/삭제)
Date: 2026-06-11
Ready for Builder: NO

## Must Fix
- src/lib/sales-revise-actions.ts:302 (recordPaymentDelta) — `sales_order_payments.amount`에 음수(`deltaFinal<0`, 부분환불)를 그대로 insert한다. 그러나 045 마이그(045_sales_payments_split.sql:37)의 컬럼 제약이 `CHECK (amount >= 0)`다. 품목 삭제로 환불 차액이 발생하면 insert가 23514 제약위반으로 **실패**하는데, L310은 `console.error`로만 삼키고 사용자에게 아무 오류도 안 띄운다 → 재고·분개는 이미 조정됐는데 결제장부에는 환불 기록이 통째로 누락된다. 이 기능의 핵심인 결제장부 정합성이 깨진다. `isMissingColumnError` 재시도는 42703만 잡으므로 무용. **수정**: 음수 델타를 부호가 아니라 의미로 표현하라 — 예) `amount: Math.abs(deltaFinal)` 로 저장하고 환불 여부는 별도 컬럼/메모로 구분(이미 memo에 '부분환불' 표기 있음). 단, 그러면 "합계<총액=외상" 집계(045 COMMENT) 의미가 환불 행에서 왜곡되므로, 부호 보존이 필요하다면 Arch에게 제약 완화(별도 마이그로 `amount >= 0` 제거 또는 환불 전용 컬럼)를 올려라. 두 방향 모두 제품/스키마 결정이 필요하니 아래 Escalate 참고. 어느 쪽이든 현재처럼 조용히 실패하는 코드는 그대로 배포 불가.

## Should Fix
- src/lib/sales-revise-actions.ts:464 vs SalesListTab.tsx:1426-1427 — 마지막 품목 삭제 가드의 기준이 서버(`items.length<=1`, 전체 품목 수)와 UI(`deletableCount`, 미수령 품목 수)가 다르다. 정상 UI 경로는 UI가 더 엄격해 우회 불가이나, 서버 직접호출 시 의미가 어긋난다(수령된 1행만 남기고 미수령 1행 삭제 허용). 의도(전표를 비우지 말 것)는 서버 기준으로도 충족되므로 비차단. 통일하려면 서버도 미수령 기준으로 맞추거나 주석으로 의도 명시.
- src/lib/sales-revise-actions.ts:288-289, accounting-actions.ts:421-426 — `deltaTaxable`와 `deltaFinal` 부호가 단일 add/remove에선 같은 방향으로만 움직이므로 `exemptAmount` 음수는 현실적으로 발생하지 않음(비례배분 라운딩 ±1원 한정). 차단 아님. 인지만.

## Escalate to Architect
- 결제 차액 행의 환불 표현 방식 — `sales_order_payments.amount`는 045에서 `>=0` 제약이고 "합계<총액=외상" 집계 의미를 가진다. 전표 수정 환불 차액을 (a) `abs(amount)`+메모로만 표기할지, (b) 제약을 완화/환불 전용 컬럼을 추가해 음수를 허용할지는 결제장부·외상집계 해석에 영향을 주는 스키마/제품 결정이다. 코드 레벨에서 임의 선택 불가. (Must Fix는 "조용히 실패"를 막는 것이 필수이고, 표현 방식 선택이 여기에 걸림.)
- Open Question 2(분할결제 전표의 차액 귀속을 'mixed'/null→'cash'로 폴백) — 분개 수금계정(1110 현금)으로 귀속된다. 'mixed' 원주문의 실제 결제구성과 무관하게 현금계정에 차액이 쌓이는 단순화가 회계상 허용 범위인지 확인 필요. 코드 동작은 일관되나 회계정책 판단.

## Cleared
- 신규 src/lib/sales-revise-actions.ts 전체, SalesListTab.tsx 변경 범위(편집 게이트·삭제버튼·추가폼·loadDetail 추출), schema.ts AI Sync를 검토했다. 편집 게이트(서버 L52 + UI L1425, null=잠금 일치), phantom BOM 분해 차감/복원(product_bom·PHANTOM_DECOMPOSE, processPosCheckout 패턴 일치), point_history adjust 차액(balance 최신행 기반·type='adjust'), 과세/면세/VAT 비례배분 스냅샷, 분개 부호(deltaFinal<0→isRefund 역분개), createSaleJournal sourceType free-text 안전, AI Sync(schema.ts:59) 정확·완전 — 모두 통과. 결제 차액 음수 insert만 차단.

Must Fix: 1

---

# Re-Review — Step 1 AMENDMENT (2026-06-11)
Ready for Builder: YES

## Verification of prior Must Fix
- 부호 보존 ✅ — recordPaymentDelta L317 `amount: deltaFinal` 그대로. abs 미사용. memo로 추가결제/부분환불 구분(L313).
- 조용한 실패 제거 ✅ — L321~330: insert err를 `{ error }`로 전파. 42703(`isMissingColumnError`, L31-32 code==='42703')만 created_by 제거 후 1회 폴백 재시도. 23514 등 그 외 에러는 재시도 없이 즉시 반환 → CHECK 위반은 버블업.
- 호출부 전파 ✅ — addSalesOrderItem L440-441, removeSalesOrderItem L516-517 모두 `if (payRes.error) return { error: payRes.error }`. UI alert로 노출.
- payment_method 폴백 ✅ — PAYMENT_METHOD_ALLOWED에 'mixed' 포함(L297), 목록 내 값 보존·null/목록밖만 'cash'(L303). 분개용 representativePaymentMethod(mixed→cash)와 분리 유지.
- 마이그 078 ✅ — Arch 소유, git상 untracked(`??`)로 Bob 추적변경에 미포함. 내용: amount>=0 제약 동적 DROP + payment_method CHECK에 'mixed' 추가 + amount 의미 COMMENT. 코드가 의존하는 스키마 전제와 일치.

## 정합성(순서) 점검 — 비차단
호출 순서: 재고(try/catch, 미전파) → item insert/delete(전파) → recalc(총액+포인트 adjust) → recordPaymentDelta(하드실패 시 early return) → journal. payment insert가 실패하면 재고·품목·총액·포인트는 이미 커밋된 상태에서 journal 전 반환 → 부분상태 잔존. 그러나 (1) 078이 유일한 현실적 실패원인(amount>=0)을 제거했고, (2) 잔존 실패는 예기치 못한 DB 오류이며, (3) 직전 Must Fix였던 "조용한 누락"보다 사용자에게 오류를 띄워 수동 정합을 유도하는 현재 동작이 명백히 우월. Arch가 택한 Option B의 의도된 잔여 트레이드오프로 판단 → Must Fix 아님. 인지만.

## Cleared
recordPaymentDelta 재작성(부호 보존·에러 전파·42703-only 재시도·mixed 폴백), 양 호출부 에러 전파, 마이그 078 소유/내용을 검증했다. 직전 Must Fix 1건 해소 확인.

Must Fix (remaining): 0
