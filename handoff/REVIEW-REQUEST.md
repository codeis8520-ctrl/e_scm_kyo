# Review Request — Feature E: 재고이동 from_branch 서버측 소유 검증 (보안)
Date: 2026-06-12
Ready for Review: YES

## Summary
지점고정 직원이 UI/요청 우회로 타지점 재고를 출고하지 못하도록, 단건(transferInventory)·다건(transferInventoryBatch)에 서버측 출발지(from_branch) 소유 검증을 추가. Feature B Known Gap(BUILD-LOG L41) 해소. DB/마이그/schema.ts/tools.ts 변경 없음 — 순수 액션 가드(스키마·enum 불변).

## Files Changed (모두 src/lib/actions.ts 단일 파일)
- src/lib/actions.ts:9 — `import { requireSession, type SessionUser } from '@/lib/session';` 추가.
- src/lib/actions.ts:1177-1196 — 모듈 로컬 헬퍼 `assertFromBranchOwnership(session, fromBranchId): { error: string } | null`. HQ 화이트리스트(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE) 통과 / 지점고정 본인지점 일치만 통과 / branch_id null 거부 / to_branch 무검증. 단건·다건 공유(로직 드리프트 없음).
- src/lib/actions.ts:1207-1209 — transferInventory 초입(formData 파싱 직후, from===to 체크 전): `requireSession()` → 헬퍼 → 거부 시 `{ error }` return.
- src/lib/actions.ts:1300-1302 — transferInventoryBatch pass1(from/to 존재 체크 직후, 재고부족 전수검사 전): 동일 패턴.

## Build
- npm run build ✓ Compiled successfully (6.2s). npx tsc --noEmit → 0 에러.

## Open Questions
- branch_id=null(지점고정) 거부 거동이 운영에서 정당한지 확인 요청(브리프 Review Flag). 본인 지점 미상이면 출고 불가 = 안전측 선택.
- 거부 반환을 리터럴 `{ error: denied.error }`로 작성한 이유: 변수 union(`{error}|null`) 직접 return 시 tsc가 함수 반환타입의 `success: true`를 `boolean`으로 widen → 호출부(TransferBatchPanel:171, TransferModal:57)의 `result?.error` 판별 union이 깨져 빌드 실패. 리터럴 반환은 기존 error 반환 패턴과 동일·동작 무변경. 의도 확인 요청.

## Out of Scope (logged in BUILD-LOG Known Gaps)
- adjustInventory(actions.ts:1005)·recordStockUsage(actions.ts:1086): 동일한 호출자 지점 무검증 패턴 확인됨(adjustInventory는 RAW/SUB 본사 제한만, 일반 제품 타지점 조정 잠재). 이번 범위 아님 — 후속 보안 스텝 후보로 기록만.
- AI tool execTransferInventory(transfer_inventory): 별도 코드경로·ToolContext RBAC 관할 → 무관, 손대지 않음.
- pass1↔pass2 동시성 레이스: 기존 한계, 스코프 아님.
