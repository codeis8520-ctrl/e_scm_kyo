# Review Request — Step: 직원 삭제 스마트 삭제 + 비활성 토글/재활성
Date: 2026-06-16
Ready for Review: YES

## Files Changed

### src/lib/actions.ts
- L1914-1972 — `deleteUser(id)` 전면 재작성: requireSession + RBAC(SUPER_ADMIN/HQ_OPERATOR), 본인 삭제 금지(session.id===id), 마지막 활성 SUPER_ADMIN 금지(target.role==='SUPER_ADMIN' AND active super_admin count<=1), `auth.admin.deleteUser` 호출 완전 제거. 하드 DELETE 시도 → 성공 시 session_tokens(user_id) 정리 후 `{deleted:true}` → FK 위반(error.code==='23503' 또는 message includes 'violates foreign key') 시 is_active=false + session_tokens 삭제(강제 로그아웃) 후 `{deactivated:true}` → 기타 error `{error: error.message}`.
- L1974-1991 — `reactivateUser(id)` 신규: 동일 RBAC 게이트, users.is_active=true, `{success:true}` | `{error}`.

### src/app/(dashboard)/system-codes/page.tsx
- L12 — import에 `reactivateUser` 추가.
- L202 — `showInactiveUsers` useState 추가.
- L379-397 — `handleDeleteUser` 재작성(confirm 문구 갱신 + deleted/deactivated/error 분기 alert 후 fetchData) + `handleReactivateUser` 신규(confirm → reactivateUser → error alert → fetchData).
- L1031-1057 — staff 탭 헤더에 '비활성 포함 보기' 토글 체크박스 추가('+ 직원 추가' 좌측, flex gap).
- L1072-1121 — 목록 렌더: `users.filter(u => showInactiveUsers || u.is_active).map(...)`, 비활성 행 `className={!user.is_active ? 'opacity-50' : ''}`, 활성=삭제 버튼 / 비활성=재활성(emerald) 버튼 분기, 빈 행 메시지도 동일 필터 기준 length 사용.

## Verification
- `npm run build` → ✓ Compiled successfully in 6.3s, 48/48 static pages, 에러/경고 0.
- requireSession() 반환 필드(id, role) — session.ts:6-11 SessionUser 확인.
- session_tokens.user_id 컬럼명 — login/actions.ts:64-66 확인.
- requireSession import — actions.ts:9 기존 확인.

## Open Questions
- FK 위반 코드가 PostgREST에서 `error.code==='23503'`으로 안 올 가능성 대비 `error.message.includes('violates foreign key')` OR 방어를 함께 둠 — 과방어 여부 검토 부탁.

## Out of Scope (logged in BUILD-LOG Known Gaps)
- createUser의 `supabase.auth.signUp` + SHA256(비-bcrypt) 불일치 — 미수정.
- updateUser auth 동기화 없음 — 그대로.
- 비활성 직원의 과거 주문/상담 표시명 — 변경 없음.
