# Review Request — 고객 검색 개선 (Enter 검색 + 콤마 AND + 안내문구)
Date: 2026-06-02
Ready for Review: YES

## Files Changed
- src/app/(dashboard)/customers/page.tsx:114 — 신규 state `searchInput`(초기 q). `search`는 커밋된 검색어로 유지.
- src/app/(dashboard)/customers/page.tsx:127 — `debounceRef` 제거.
- src/app/(dashboard)/customers/page.tsx:155-161 — 디바운스 useEffect 교체: setTimeout 완전 제거, `[search,gradeFilter,hasConsult,sortKey]` 변경 시 즉시 fetch. 조건 없으면 빈 상태 복귀.
- src/app/(dashboard)/customers/page.tsx:313-345 — 검색 UI: `flex-1 max-w-lg` wrapper로 input(div.relative)+안내 `<p>` 세로 배치. 돋보기→검색 버튼(onClick setSearch(searchInput), aria-label). input value=searchInput/onChange=setSearchInput/onKeyDown Enter→setSearch. X 클리어 표시조건 searchInput, setSearchInput('')+setSearch(''). placeholder/안내문구 브리프 그대로. 셀렉트/체크박스 행 정렬 유지.
- src/app/api/customers/search/route.ts:135-218 — 신규 `matchOneToken(token)→Set<id>` + `findProductCustomerIds(token)` (기존 단일어 매칭 로직 추출, id만 select).
- src/app/api/customers/search/route.ts:220-265 — 신규 `fallbackSearchMultiToken`: 토큰별 Set 교집합(AND, 작은 집합 우선) → customers select + grade/branch 필터 → attachPoints/attachHistory/postFilterAndSort/페이징 기존 흐름. reason은 `검색: <토큰들>`.
- src/app/api/customers/search/route.ts:267-282 — `fallbackSearch` 진입부에 콤마 토큰 분리 가드: ≥2개 → multiToken 분기. 0/1개 → 기존 단일어 블록 그대로(코드 미변경).

## Verification
- `npm run lint` — exit code 0. (코드베이스 전반 기존 no-explicit-any 다수 존재 → 비차단·신규 파일 무관. 신규 코드는 기존 route.ts의 `any` 스타일을 따름.)
- `npm run build` — ✓ Compiled successfully. /customers static, /api/customers/search 정상, 에러 0.

## Open Questions
- 다중 토큰 결과의 match_reasons를 필드별이 아닌 `검색: <토큰들>` 한 줄로 표기했습니다(교집합이라 필드 귀속이 모호). 단일 토큰은 기존 필드별 reason 그대로. 표기 방식 확인 부탁.
- 교집합 후보 상한 `.in('id', ids.slice(0,1000))` — 기존 폴백 관행과 일치시켰습니다.

## Out of Scope (logged in BUILD-LOG)
- RPC 마이그 073 (Arch 담당), route.ts의 supabase.rpc 호출부, legacy/포장/병합/POS, 검색 랭킹, schema.ts — 전부 미접촉.
