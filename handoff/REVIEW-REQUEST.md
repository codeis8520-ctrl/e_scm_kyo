# Review Request — 고객 상세 UX 2건 (인라인 수정 + 목록 복원)
Date: 2026-06-02
Ready for Review: YES

## Files Changed

### src/app/(dashboard)/customers/[id]/page.tsx
- L10 — `CustomerModal` import 추가 (`../CustomerModal`).
- L179 — state `showEditModal` 추가 (`showAssignModal` 옆).
- L506 영역 — `backHref` 도출: searchParams 에서 목록 키(q/grade/hasConsult/sort/page)만 추려 `/customers?qs`, 없으면 `/customers`.
- L518 — "← 목록" Link href `"/customers"` → `{backHref}`.
- L527 영역 — "기본 정보" 카드 헤더를 flex row 로 바꿔 "수정" 버튼 추가 → `setShowEditModal(true)`.
- L1266 영역 — info 탭 안내문 제거, "기본 정보 수정" 버튼으로 교체 → `setShowEditModal(true)`.
- L1273 영역 — 컴포넌트 말미 `CustomerModal` 렌더. props 3개(`customer`/`onClose`/`onSuccess`). onSuccess → `setShowEditModal(false); fetchData();`.

### src/app/(dashboard)/customers/page.tsx
- L3 — `useMemo` import 추가.
- L194 영역 — `listQs` useMemo(q/grade/hasConsult/sort/page, tab 제외; 동기화 키 L182-192 와 동일 규칙).
- L405 — 이름 링크 href 에 `listQs` 부착.
- L472 — "상담 기록 없음" 링크 href 에 기존 `?tab=consultations` + `&${listQs}` 머지.

## Self-review
- **Richard가 먼저 볼 곳**: 상세가 CustomerModal 외 별도 권한 분기/저장 경로를 만들지 않았는지 → 만들지 않음. 저장은 모달 내부 `updateCustomer`(목록 수정과 동일 RBAC). 상세 페이지엔 새 fetch 함수도 없고 리로드는 기존 `fetchData()` 재호출.
- **브리프 요구사항 전부 구현**: A) import/state/카드버튼/info탭버튼/모달렌더 OK, B-1) listQs useMemo + 두 링크 OK, B-2) backHref + ← 목록 OK. 탭-동기화(L624-626) 미변경 OK.
- **빈 데이터/실패 시**: qs 없는 직접 진입 → backHref = `/customers` 폴백 OK. 모달 저장 실패는 CustomerModal 내부 기존 에러 핸들링 그대로(상세에서 우회 안 함).

## Props 시그니처 확인
CustomerModal.tsx L26-30 실제 시그니처 `{ customer?: Customer | null; onClose; onSuccess }` — 브리프와 정확히 일치. 불일치 없음. 상세 `customer`(CustomerDetail)는 모달 `Customer`의 슈퍼셋이라 구조적 호환, 그대로 전달.

## Build
`npm run build` → Compiled successfully in 6.2s. TS 에러 0.

## Open Questions
없음.

## Out of Scope (logged in BUILD-LOG)
없음 (Known Gaps 없음).
