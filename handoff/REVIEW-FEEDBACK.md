# Review Feedback — Feature D: 재고 조정 권한 정리 (입고/출고 제거 · 본사만 조정)
Date: 2026-06-16
Status: APPROVED

## Conditions
없음.

## Escalate to Arch
없음.

## Cleared
adjustInventory 서버 RBAC 가드, InventoryModal IN/OUT 제거, page.tsx 3개 진입점
클라이언트 게이팅, schema.ts BUSINESS_RULES 1줄을 리뷰했고 모두 통과.

### 검증 상세
- 서버 가드: actions.ts:1007 `requireSession()`이 함수 최상단(모든 DB mutation 이전)에
  위치. session.ts:45 requireSession은 세션 없으면 throw → 미인증 차단. session.role
  필드명 일치(SessionUser.role, line 9). 비본사는 line 1008-1010에서 `{ error }` 반환
  후 즉시 종료. import 확인(actions.ts:9). transfer 패턴 미러 정상.
- RAW/SUB→본사 기존 제한(1022-1037) 무변경·정상 유지.
- 클라 게이팅: isHQUser(page.tsx:116) = userRole SUPER_ADMIN/HQ_OPERATOR, 기존
  isBranchUser 쿠키 패턴과 동일. 3개 진입점 전부 차단 —
  헤더 '+ 재고 조정'(513-525) `{isHQUser && ...}`,
  그리드 셀(771) adjustBlocked = materialBlocked || !isHQUser (onClick/disabled/스타일/↓배지),
  플랫테이블 '조정'(891-902) `{isHQUser && ...}` + 내부 materialBlocked 유지.
  조회(재고현황) 무게이트 — 비본사도 데이터 전부 조회 가능(과게이팅 없음).
- 방어 심층: 클라 게이트(UX) + 서버 가드(실집행) 양쪽 존재. 비본사가 액션 직접
  호출해도 서버에서 차단.
- InventoryModal: movement_type 기본값 'ADJUST'(45), IN/OUT 토글 3버튼 삭제,
  남은 setFormData는 branch_id/quantity/safety_stock/memo만 → IN/OUT 제출 경로 없음.
  라벨 '변경 후 수량 *' 고정, placeholder '조정 사유...', RAW/SUB '지점은 본사로
  고정됩니다.'(236) 유지.
- AI 에이전트 경로: tools.ts execAdjustInventory diff 0(미변경). 액션의 새
  requireSession 가드는 에이전트 executor에 영향 없음(별 경로).
- DB/마이그 변경 없음. schema.ts:159 BUSINESS_RULES 1줄만 추가 — AI Sync 충족.
- 엣지: user_role 쿠키 부재/미지 → isHQUser false(안전·게이트). 서버 requireSession
  throw → 안전.

### 비차단 관찰(참고만, 조정 불필요)
- actions.ts:1056-1059 movementType==='IN'/'OUT' 분기는 모달이 'ADJUST' 고정이라
  현 UI에서 도달 불가(dead branch). 무해. 향후 정리는 스코프 밖 — BUILD-LOG 권장.
