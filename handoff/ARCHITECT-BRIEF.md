# Architect Brief — Step: 직원 삭제 스마트 삭제 + 비활성 토글/재활성

## Goal
코드 > 직원 관리에서 삭제 버튼이 실제로 동작한다. 참조 없는 계정은 완전 삭제, 참조 있는 직원은 비활성 폴백. 비활성 직원은 목록에서 숨기되 토글로 보고 재활성 가능.

## Root Cause (확정, 재조사 금지)
`deleteUser` (src/lib/actions.ts L1914) 가 `supabase.auth.admin.deleteUser(id)` 를 먼저 호출 → 이 앱은 Supabase Auth가 아니라 커스텀 bcrypt 세션(CLAUDE.md). 그 호출이 실패하면 early return → `users` DELETE 자체가 실행 안 됨. 그래서 "삭제 버튼 눌러도 안 됨".

## Build Order

### 1. deleteUser 재작성 — src/lib/actions.ts (L1914~1929 전체 교체)
- `const session = await requireSession();` (이미 L9 import 됨)
- **RBAC 게이트** (adjustInventory L1007-1008 패턴 그대로):
  `if (session.role !== 'SUPER_ADMIN' && session.role !== 'HQ_OPERATOR') return { error: '직원 관리는 본사 권한만 가능합니다.' };`
- **가드 1 — 본인 금지**: `if (session.id === id) return { error: '본인 계정은 삭제할 수 없습니다.' };`
- **가드 2 — 마지막 활성 SUPER_ADMIN 금지**: 대상 user를 먼저 select(`id, role, is_active`). 대상이 role==='SUPER_ADMIN' 이면, `users`에서 `role='SUPER_ADMIN' AND is_active=true` count 조회 → count<=1 이면 `return { error: '마지막 활성 최고관리자는 삭제/비활성할 수 없습니다.' };`
- **auth.admin.deleteUser 호출 완전 제거.**
- **하드 DELETE 시도**: `const { error } = await supabase.from('users').delete().eq('id', id);`
  - 성공(error 없음) → session_tokens 그 직원 것 정리: `await supabase.from('session_tokens').delete().eq('user_id', id);` (이미 참조 없으니 안전) → `revalidatePath('/system-codes'); return { deleted: true };`
  - **error.code === '23503'** (FK 위반) → soft-delete 폴백:
    `await supabase.from('users').update({ is_active: false }).eq('id', id);`
    그 직원 세션 무효화: `await supabase.from('session_tokens').delete().eq('user_id', id);`
    → `revalidatePath('/system-codes'); return { deactivated: true };`
  - 그 외 error → `return { error: error.message };`
- 반환 타입: `{ deleted: true } | { deactivated: true } | { error: string }`.
- Flag: session_tokens 컬럼명이 `user_id` 인지 grep 확인 후 사용. FK 위반 코드가 PostgREST에서 `error.code === '23503'` 로 오는지 확인(아니면 `error.code === '23503' || error.message.includes('violates foreign key')` 으로 방어).

### 2. reactivateUser 신규 액션 — src/lib/actions.ts (deleteUser 바로 아래 추가)
- `export async function reactivateUser(id: string)`
- 동일 RBAC 게이트(SUPER_ADMIN/HQ_OPERATOR).
- `await supabase.from('users').update({ is_active: true }).eq('id', id);`
- 에러 시 `{ error }`, 성공 시 `revalidatePath('/system-codes'); return { success: true };`
- Flag: updateUser(L1884)로도 가능하나 FormData 기반이라 단순 토글엔 부적합 → 전용 액션 신설이 맞음.

### 3. UI — src/app/(dashboard)/system-codes/page.tsx (staff 탭)
- import 라인(L12)에 `reactivateUser` 추가.
- **비활성 포함 토글 state**: `const [showInactiveUsers, setShowInactiveUsers] = useState(false);` (다른 useState 근처).
- staff 탭 헤더(L1031 영역)에 '+ 직원 추가' 옆/위에 토글 체크박스: "비활성 포함 보기".
- 목록 렌더(L1054) 필터: `users.filter(u => showInactiveUsers || u.is_active).map(...)`.
  - getUsers 안 쓰고 L242에서 client supabase로 직접 fetch 중 → fetch는 전체 유지(`.order created_at`), **필터는 render 단에서**. (includeInactive 파라미터 불필요.)
- **비활성 행**: `<tr className={!user.is_active ? 'opacity-50' : ''}>`.
- **관리 컬럼**: 비활성 직원이면 '삭제' 대신 **'재활성'** 버튼 노출(green/blue), 활성이면 기존 '삭제' 유지. '수정'은 양쪽 유지.
- **handleDeleteUser (L377) 재작성**: 
  - confirm 문구 갱신: '이 직원을 삭제합니다.\n주문·상담 등 참조 기록이 있으면 자동으로 비활성 처리됩니다.'
  - `const res = await deleteUser(id);`
  - `if (res?.error) alert(res.error);`
  - `else if (res?.deactivated) alert('참조 기록이 있어 비활성 처리되었습니다.');`
  - `else if (res?.deleted) alert('직원이 완전히 삭제되었습니다.');`
  - 그 후 `fetchData();`
- **handleReactivateUser 신규**: `if(!confirm('이 직원을 재활성하시겠습니까?'))return; const res=await reactivateUser(id); if(res?.error)alert(res.error); fetchData();`

## Out of Scope (→ BUILD-LOG Known Gaps if surfaces)
- createUser 가 `supabase.auth.signUp` + SHA256 사용(bcrypt 아님) — 기존 불일치. 이번 step에서 건드리지 않음.
- updateUser 의 auth 동기화 없음 — 그대로 둠.
- 비활성 직원의 과거 주문/상담 표시명 처리 — 변경 없음.

## Locked Decisions
- RBAC: 직원 삭제/비활성/재활성 = **SUPER_ADMIN 또는 HQ_OPERATOR** (adjustInventory 패턴 동일). 서버에서 게이트.
- 가드: 본인 계정 불가 + 마지막 활성 SUPER_ADMIN 불가.
- 폴백: 하드 DELETE → 23503 → is_active=false. soft 시 session_tokens 삭제로 강제 로그아웃.
- 목록: 기본 활성만, render-side 필터 + 토글. getUsers 시그니처 변경 없음.
- DB 마이그레이션 없음 (is_active 이미 존재). schema.ts/tools.ts 영향 없음(에이전트 user 도구 없음 — 확인됨).

## Acceptance
- `npm run build` 통과.
- 참조 없는 테스트 계정 삭제 → 목록에서 사라짐("완전히 삭제됨").
- 주문/상담 만든 직원 삭제 → "비활성 처리됨" 메시지, 토글 켜야 보임, opacity-50, 재활성 버튼.
- 재활성 → 활성 복귀.
- 본인/마지막 SUPER_ADMIN 삭제 시도 → 에러 메시지, 변화 없음.
- 비본사 역할이 액션 직접 호출 시 서버에서 거부.
