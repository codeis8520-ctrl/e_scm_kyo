# Review Feedback — 직원 삭제 스마트 삭제 + 비활성 토글/재활성
Date: 2026-06-16
Status: APPROVED

## Conditions
(없음)

## Escalate to Arch
(없음)

## Cleared
deleteUser/reactivateUser(src/lib/actions.ts:1914-1991)와 system-codes/page.tsx 직원 탭
변경을 리뷰했고 보안·로직 모두 통과했다.

검증 완료:
- 깨진 auth.admin.deleteUser 호출은 deleteUser에서 완전히 제거됨(L1875 잔존 호출은
  out-of-scope createUser 롤백 경로로 이번 변경 대상 아님, Known Gap).
- RBAC: deleteUser/reactivateUser 둘 다 requireSession() 후 화이트리스트
  ['SUPER_ADMIN','HQ_OPERATOR']를 어떤 mutation보다 먼저 강제. session.id/role은
  session.ts SessionUser 필드와 일치. BRANCH_STAFF/PHARMACY_STAFF/EXECUTIVE는 직접
  액션 호출로 삭제/비활성/재활성 불가 — 서버가 실제 게이트(심층 방어 성립).
- 자기 삭제 거부(session.id===id) 정상.
- 마지막 활성 SUPER_ADMIN 가드: target이 SUPER_ADMIN일 때만 진입(비-super-admin 삭제는
  이 가드에 안 걸림), count 쿼리는 role=SUPER_ADMIN AND is_active=true만 카운트(비활성
  제외), count<=1이면 차단 — 모두 정확.
- 스마트 삭제: 하드 DELETE 성공→session_tokens 정리 후 {deleted}. FK 위반(23503 또는
  메시지 매칭)→is_active=false + 토큰 삭제(강제 로그아웃) 후 {deactivated}. 그 외 에러는
  {error}로 표면화(조용한 soft-delete 아님) — 정확.
- reactivateUser: 동일 RBAC 게이트, is_active=true만. 가드 우회 악용 경로 없음.
- UI: showInactiveUsers 토글 기본 active-only, 렌더 필터로 활성 직원 항상 노출(과도한
  숨김 없음), 비활성 행 opacity-50 + 재활성(emerald) 버튼, handleDeleteUser 분기 alert
  (deleted/deactivated/error), handleReactivateUser confirm. 빈 행도 동일 필터 기준.
- DB/마이그레이션 없음, createUser 미수정, schema.ts/tools.ts 변경 없음 — AI 동기화
  매트릭스 해당 없음.

## 참고(비차단)
- 마지막 활성 SUPER_ADMIN 가드는 target.role==='SUPER_ADMIN'이면 target이 이미 비활성인
  경우에도 활성 super_admin count<=1이면 차단한다. 즉 "비활성 super_admin 레코드 하드
  삭제"가 막힐 수 있다. 이는 보안상 안전 방향(과보호)이며 데이터 보존 측면에서 오히려
  바람직 — Condition 아님. 의도와 다르면 Arch가 판단.
- Open Question(FK 코드 23503 OR 메시지 매칭 과방어 여부): PostgREST가 에러 코드를
  누락/변형할 가능성에 대한 합리적 이중 방어. 과방어 아님, 그대로 두는 것을 권장.
