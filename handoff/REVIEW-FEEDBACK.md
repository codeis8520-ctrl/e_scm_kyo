# Review Feedback — Feature E: 재고이동 from_branch 서버측 소유 검증
Date: 2026-06-12
Status: APPROVED

## Conditions
(없음)

## Escalate to Arch
- branch_id=null(지점고정 직원) 거부 거동 — 코드는 안전측(본인 지점 미상이면 출고 불가)으로 올바르나, 이게 운영상 정당한지는 제품/운영 결정. Bob의 Open Question 그대로 Arch 확인 권고. 코드 레벨에서 더 안전한 선택지는 없음(거부가 정답).
- 리터럴 `{ error: denied.error }` 반환 사유(tsc union-widening 회피) — 타당. 동작·메시지 무변경 확인. 의도 승인 요청은 코드 결함 아님, 참고만.

## Cleared
재고이동 단건(transferInventory)·다건(transferInventoryBatch) 출발지 소유 검증을 리뷰함.
검증 통과 사항:
- 헬퍼 로직: HQ 화이트리스트(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE) 자유통과, 지점고정 본인지점 일치만 통과, branch_id null 거부, to_branch 무검증 — 브리프 일치.
- 미지정/빈 역할: HQ 미포함 → 지점고정 경로로 폴백(deny-by-default). 빈 역할은 getSession이 null 반환 → requireSession throw로 헬퍼 도달 전 차단. 무단 우회 경로 없음.
- 회귀: BRANCH_STAFF 본인지점 출고 PASS, HQ 임의지점 PASS 확인. 비교 필드(session.branch_id !== fromBranchId) 및 역할 문자열 enum 정확.
- session.ts: SessionUser가 role/branch_id를 해당 이름으로 노출, requireSession은 세션 없으면 throw — 필드 접근 정확(가정 아님).
- 양쪽 호출부 모두 requireSession→헬퍼→거부 시 inventory/movement write 이전 return. 부분 저장 없음.
- 헬퍼 단일 공유(드리프트 없음). DB/마이그/schema.ts/tools.ts 무변경(git diff 확인 — 소스는 actions.ts 단일). adjustInventory/recordStockUsage는 Known Gaps로 정확히 분리.
