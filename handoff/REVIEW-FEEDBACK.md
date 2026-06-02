# Review Feedback — Step: 고객 상세 UX 2건 (인라인 수정 + 목록 복원)
Date: 2026-06-02
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
없음.

## Escalate to Architect
없음.

## Cleared
2파일(customers/[id]/page.tsx, customers/page.tsx) 순수 프론트 변경 리뷰 — RBAC/저장 경로, 목록 복원 키 규칙, 링크 머지, 회귀/범위 전부 통과.

---
## 검증 근거
1. CustomerModal 연결 — Props 시그니처 `{customer?, onClose, onSuccess}`(CustomerModal.tsx L26-30)와 정확히 일치. CustomerDetail(L22-35)는 모달 Customer의 슈퍼셋(id/name/phone/email/grade/primary_branch_id/address/health_note/is_active 전부 포함). 상세 select `*, primary_branch:branches(*)`(L209)에 primary_branch_id 스칼라 포함. onSuccess → fetchData() 재호출(기존 함수) OK.
2. RBAC/보안 — 상세에 별도 권한 분기·직접 update 경로 없음. 저장은 모달 내부 updateCustomer(목록과 동일 RBAC) 경유. "수정" 버튼은 단순 setShowEditModal(true)만 트리거 — 권한 확대 없음. 보안상 깨끗.
3. 목록 복원 정확성 — listQs(page.tsx L195-203) 키·규칙이 URL 동기화 useEffect(L184-188)와 동일: q/grade/hasConsult 동일, sort는 'recent_consult' 제외 동일, page>1 동일, tab 제외 동일. backHref([id] L508-515)는 동일 5키만 추리고 tab 등 상세전용 키 제외. qs 없으면 /customers 폴백 OK.
4. 링크 머지 — L483 기존 `?tab=consultations`에 `${listQs ? \`&${listQs}\` : ''}` 머지 — 이중 ? 없음. L416 이름 링크는 listQs 있을 때만 `?${listQs}` OK.
5. 회귀/잔재 — 탭-동기화(L638) 무변경: `new URLSearchParams(searchParams.toString())`로 기존 파라미터(목록 키 포함) 보존 후 tab만 덮어씀 → 상세 머무는 동안 목록 키 URL 유지 → backHref 정상 복원. useMemo import 추가(page.tsx L3) 정상.
6. 범위 가드 — 병합/포장옵션/legacy/DB/schema.ts 미접촉. diff 2파일만. 순수 프론트.
