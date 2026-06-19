# Review Request — 미수금(UNSETTLED) 수금 처리 (#39)
Date: 2026-06-18
Ready for Review: YES

## Files Changed
- src/lib/accounting-actions.ts:730 — settleCreditOrder 조회 select에 `approval_status` 추가.
- src/lib/accounting-actions.ts:741-749 — settleCreditOrder update에 조건부 spread `approval_status:'COMPLETED'`(현재 UNSETTLED일 때만). CARD_PENDING/이미 COMPLETED 건 불변(갭 C 수정).
- src/lib/accounting-actions.ts:800-841 — 신규 `settleSalesOrderReceivable({orderId, settledMethod})`: UNSETTLED 가드 → credit 미회수면 settleCreditOrder 위임(1115 회수 분개), 비외상/이미회수 credit은 분개 없음 → 공통 approval_status='COMPLETED' → revalidatePath('/pos').
- src/app/(dashboard)/pos/SalesListTab.tsx:13 — settleSalesOrderReceivable import.
- src/app/(dashboard)/pos/SalesListTab.tsx:1647-1650 — 수금 처리 state(showSettleForm/settleMethod/settling).
- src/app/(dashboard)/pos/SalesListTab.tsx:2326-2342 — handleSettleReceivable: 액션 호출 → 성공 시 setOrder 낙관적 갱신(approval_status COMPLETED, credit이면 credit_settled true) + onChanged().
- src/app/(dashboard)/pos/SalesListTab.tsx:3227-3270 — 액션 클러스터에 "💰 수금 완료" 버튼(UNSETTLED 조건) + 인라인 수금수단 select(현금/카드/카카오)+수금확정/취소.
- src/lib/ai/schema.ts:202 — BUSINESS_RULES approval_status 섹션에 수금 흐름(settleSalesOrderReceivable / settleCreditOrder 동기화) 한 줄 보강. 신규 도구 없음.

## 자가검증
- `npm run build` ✓ Compiled successfully in 5.9s, 0 error.
- 분개 차/대변: credit 위임 경로는 기존 settleCreditOrder 사용(차변 1110/1120 ← 대변 1115, 무변경). 비외상 UNSETTLED는 분개 0건(이중계상 방지) — 브리프 A 결론 준수.
- 위임 시 approval_status update 중복: settleCreditOrder가 UNSETTLED→COMPLETED 동기화 후, settleSalesOrderReceivable가 끝에서 다시 COMPLETED 세팅 — idempotent(같은 값), 데이터 무해.
- CARD_PENDING/이미 COMPLETED credit 건: settleCreditOrder 조건부 spread로 불변 보장.

## Open Questions
- 위임 경로에서 settleCreditOrder가 이미 COMPLETED 세팅함에도 settleSalesOrderReceivable 끝에서 한 번 더 동일 값 update 발생(idempotent). 비외상 경로와 코드 흐름 통일·가독성 위해 공통 마무리로 유지. 단일 update로 합치는 게 낫다고 보면 지적 바람.

## Out of Scope (logged in BUILD-LOG)
- 지점 RBAC 서버차단(타지점 미수금 수금 차단) — 미신설, 화면접근 권한에 위임.
- 부분 수금·수금 취소 UI 없음.
- 비외상 UNSETTLED 자동수금 AI 도구 없음(의도적).
