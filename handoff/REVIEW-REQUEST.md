# Review Request — Step B (발송 모달 UI 개편)
Date: 2026-06-18
Ready for Review: YES

## Files Changed
`src/app/(dashboard)/notifications/page.tsx` (단일 파일)

### Parent (NotificationsPage)
- L3-6 — `createClient` import 제거, `resolveSendTargets`/`SendAudienceMode` import 추가.
- L31-33 — `customers` state 제거.
- L52-72 — fetchData에서 12k 고객 클라 로드(customerRes) 제거. Promise.all 3개로 축소.
- L344-352 — SendModal에 `customers` prop 전달 제거.

### Helpers (모달 위)
- `PickedCustomer` 타입, `HQ_ROLES` set, `SEND_MODE_LABELS`, `getCookie`(production/page.tsx 패턴 복사).
- renderPreview 시그니처: `(message, manualVars, sampleCustomer: PickedCustomer|null, singlePhone)` — `customers` 배열 인자 제거.

### SendModal
- 상태 블록 — sendMode `'ids'|'grade'|'all'|'single'`, `pickedCustomers`(Map), `searchResults`/`searchTotal`/`searching`, `bulkGrade`. `isHQ`(쿠키). `gradeFilter`/`filteredCustomers` 제거.
- 서버검색 useEffect — `/api/customers/search?q=&page=1&limit=30&sort=name` debounce 300ms + cancel 가드.
- `toggleCustomer`(PickedCustomer 받아 pickedCustomers 적재) / `clearSelection` / `sampleCustomer`.
- handleSend — single은 phone 직접. ids/grade/all은 `resolveSendTargets(mode)` → `{total,skipped}` confirm → 서버 정제 `targets`로 기존 send 액션.
- 모드 토글 — 4버튼, 비HQ는 grade/all filter로 숨김.
- 수신자 UI — ids(검색+칩+체크리스트), grade(등급 라디오), all(경고), single(phone 입력).
- 미리보기 호출 — `sampleCustomer` 전달.
- 발송 버튼 라벨 — 모드별 분기.

## Self-Review
- `npm run build` ✓ (Compiled successfully, error/warn 0).
- grep 확인: `filteredCustomers`/`gradeFilter`/`'bulk'`/모달 `customers` 잔여 참조 0.
- 타입: resolved targets → send 액션 `SendTarget[]` 형상 일치(customerId nullable, name optional).

## 리뷰 포인트 (확인 요청)
1. **RBAC 이중화**: 비HQ는 UI에서 grade/all 숨김 + 서버 resolveSendTargets도 본사게이트(Step A). 쿠키 위변조해도 서버에서 막힘 — 의도대로인지.
2. **selection 보존**: 검색어 변경 시 `selectedCustomerIds`+`pickedCustomers` 유지. 칩의 ✕는 selectedCustomerIds만 제거(pickedCustomers는 남음 — 재선택 시 캐시 재사용, 무해). 의도 확인.
3. **ids 모드도 resolveSendTargets 경유** → 서버가 전화없음/중복 정제한 targets로 발송. 클라 pickedCustomers는 발송에 미사용(칩/샘플 전용). 회귀 우려 없는지.
4. **parent 12k 로드 제거**: 모달이 prop `customers` 의존 0이 되어 제거. customers state가 다른 곳에서 미사용임을 grep 확인했으나 재확인 요청.

## Out of Scope (BUILD-LOG에 기록)
- 검색 결과 페이지네이션('더보기'/무한스크롤) 없음 — 30명/페이지, 안내문구로 좁히기 유도.
- send-many 청킹/대량가드 → Step C.
