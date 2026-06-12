# Architect Brief — Step: 재고이동 from_branch 서버측 소유 검증

## Goal
지점고정 직원이 UI/요청 우회로 타지점 재고를 출고하지 못하도록, transferInventory(단건)·transferInventoryBatch(다건)에 서버측 출발지(from_branch) 소유 검증을 추가한다.

## Locked Decisions (변경 금지)
- **세션 획득**: `requireSession()` (src/lib/session.ts) 사용. 반환 `SessionUser { role: string; branch_id: string | null }`. 둘 다 현재 세션 검증이 **전혀 없음** — 신규 추가.
- **import 추가 필요**: actions.ts 상단에 `import { requireSession } from '@/lib/session';` (현재 미import). 경로/이름 확인됨.
- **정책(잠금)**:
  - HQ급 = `['SUPER_ADMIN','HQ_OPERATOR','EXECUTIVE']` → 출발지 자유.
  - 지점고정 = `['BRANCH_STAFF','PHARMACY_STAFF']` → `from_branch_id === session.branch_id` 일 때만 허용. 불일치 시 `return { error: '본인 지점의 재고만 출고할 수 있습니다.' }`.
  - 도착지(to_branch)는 **무제한**(타지점 입고 허용 — 기존 UI 정책 유지). 검증 추가 금지.
- **세션/branch 미지정 시 거동**: 기존 RBAC 선례(requireHq: `!ctx.userRole`이면 통과)와 **일관**. `requireSession`이 세션 없으면 throw하므로 그 시점에서 차단됨. role이 지점고정인데 `session.branch_id`가 null이면 → **거부**(본인 지점 미상이면 출고 불가, 안전측). HQ급은 통과. 이 거동을 주석으로 명시.
- **검증 위치**:
  - 단건: 함수 초입(formData 파싱 직후, `fromBranchId === toBranchId` 체크 부근). 빠른 거부.
  - 다건: **pass1 검증 단계**(L1273~ from/to 존재 체크 직후, 재고부족 전수검사 전). 처리 전 거부.
- **공통 헬퍼 권장**: actions.ts 내 모듈 로컬 함수 1개로 추출 — 시그니처 예:
  `function assertFromBranchOwnership(session: SessionUser, fromBranchId: string): { error: string } | null` — null이면 통과, 객체면 그 error를 호출부에서 그대로 return. 두 함수가 동일 로직 공유(중복 금지).
- **마이그/DB 변경 없음**. schema.ts·BUSINESS_RULES 변경 없음(스키마·enum 불변, 순수 액션 가드). 이 점 REVIEW-REQUEST에 명시.

## Build Order
1. actions.ts 상단 import에 `requireSession`(+ 필요시 `SessionUser` 타입) 추가.
2. 모듈 로컬 헬퍼 `assertFromBranchOwnership` 작성(HQ 화이트리스트 + 지점고정 일치검사 + branch_id null 거부).
3. transferInventory(L1176): 초입에서 `const session = await requireSession();` → `const denied = assertFromBranchOwnership(session, fromBranchId); if (denied) return denied;`.
4. transferInventoryBatch(L1258): pass1 초입(from/to 존재 체크 직후)에서 동일 패턴.
5. `npm run build` 통과.

## Out of Scope (확대 금지)
- adjustInventory(L1005)·recordStockUsage(L1086): 동일한 from-branch 무검증 패턴 가능성 → **이번 범위 아님**. 인접 갭이면 BUILD-LOG Known Gaps에 기록만.
- AI tool `execTransferInventory`(tools.ts transfer_inventory): 별도 코드경로(자체 movements, 이 서버액션 미경유). ToolContext RBAC가 이미 관할 → 이번 변경과 무관. 손대지 말 것. (참고 기록만)
- 동시성/트랜잭션(pass1↔pass2 레이스): 기존 한계, 이번 스코프 아님.

## Acceptance
- 지점고정 직원이 `from_branch_id`=타지점으로 단건/다건 호출 시 거부(error 반환, 재고/movements 무변경).
- 지점고정 직원이 본인 지점 출고는 **정상** 통과(회귀 없음).
- HQ급(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE)은 임의 출발지 정상 통과(회귀 없음).
- 도착지 타지점 입고는 계속 허용.
- `npm run build` 통과.

## Review Flags (Richard — 보안 민감, 리뷰 필수)
- 회귀 1순위: 정상 지점직원 자기지점 이동·HQ 이동이 막히면 안 됨.
- branch_id null(지점고정) 거부 거동이 운영에서 정당한지 확인.
- 두 함수가 헬퍼 공유했는지(로직 드리프트 없음) 확인.
