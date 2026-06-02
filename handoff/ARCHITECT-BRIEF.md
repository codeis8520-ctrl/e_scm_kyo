# Architect Brief — 고객 검색 개선 (Enter 검색 + 콤마 AND + 안내문구)

## Goal
고객 목록 검색이 타이핑 중에는 조회하지 않고 Enter/버튼에만 실행되며, 콤마로 구분한 여러 조건을 모두 만족(AND)하는 고객만 표시한다. 단일어 검색은 기존과 동일.

## 범위
- Bob: `src/app/(dashboard)/customers/page.tsx` (프론트), `src/app/api/customers/search/route.ts` 의 `fallbackSearch` (콤마 AND).
- Arch(Bob 손대지 말 것): `supabase/migrations/073_customer_search_comma_and.sql` 신규 + DB 직접 적용. RPC 가 콤마 AND 메인 경로.
- schema.ts 무관.

## 프론트 (page.tsx)
1. state 분리(L113): `search` 유지=커밋된 검색어(초기 q). 신규 `searchInput`(초기 q) = 텍스트박스 값.
2. 디바운스 useEffect(L157-174) 교체 — 타이핑 중 fetch 금지. debounceRef(L128) 제거. `search/gradeFilter/hasConsult/sortKey` 변경 시 즉시 fetch:
   ```tsx
   useEffect(() => {
     const hasCondition = search.trim() !== '' || gradeFilter !== '' || hasConsult;
     if (!hasCondition) { setCustomers([]); setTotal(0); setHasSearched(false); return; }
     setPage(1); setHasSearched(true);
     fetchCustomers(search, gradeFilter, 1, hasConsult, sortKey);
   }, [search, gradeFilter, hasConsult, sortKey, fetchCustomers]);
   ```
3. input(L318-325): `value={searchInput}`, `onChange={(e)=>setSearchInput(e.target.value)}`, `onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); setSearch(searchInput); } }}`.
4. 돋보기 아이콘(L315-317) → `<button type="button" onClick={()=>setSearch(searchInput)} aria-label="검색">`(위치/스타일 유지).
5. X 클리어(L326-335): 표시 조건 `searchInput`, onClick `()=>{ setSearchInput(''); setSearch(''); }`.
6. placeholder(L321) `"검색어 입력 후 Enter — 여러 조건은 콤마(,)로 (예: 이장우, 청담)"`. 검색 input 컨테이너 아래 작은 회색 안내문구:
   `<p className="text-xs text-slate-400 mt-1">Enter 또는 🔍로 검색 · 콤마(,)로 여러 조건을 묶으면 모두 만족하는 고객만 (예: 이장우, 청담)</p>`
   레이아웃: 검색 `div.relative` 를 `flex-1 max-w-lg` wrapper 로 감싸 input div + 안내 p 세로 배치(셀렉트/체크박스 행 정렬 유지).
7. 초기 q 복원: search·searchInput 초기값 둘 다 q → useEffect 자동 1회 fetch.
8. URL 동기화(L182-192)/listQs(L195-203): `search` 그대로(수정 없음, 검증만).

## 백엔드 fallbackSearch (route.ts) — 콤마 AND (RPC 미적용/실패 폴백)
1. `const tokens = q.split(',').map(t=>t.trim()).filter(Boolean);`
2. 토큰 0개 → 기존 `q` 단일 처리(가드). 토큰 1개 → **기존 로직 그대로**(회귀 0, 분기).
3. 토큰 ≥2 → 각 토큰의 매칭 customer id Set 구해 **교집합(AND)**. 기존 단일어 매칭(name/phone/phone2/email/address ilike + 숫자 + 제품명→주문→customer)을 `matchOneToken(token)→Set<id>` 로 추출 재사용. 교집합 id 들에 reasons/points/history/정렬/페이징 기존 흐름 적용.

## Out of Scope
legacy 임포터/포장/병합/POS, 검색 랭킹, RPC 파일(Arch 담당).

## Acceptance
- 타이핑 중 `/api/customers/search` 호출 0건. Enter/🔍/필터변경에만 호출.
- "이장우" 단일 = 기존과 동일(회귀 없음).
- "이장우, 청담" → 이름 이장우 + 주소 청담 둘 다 만족하는 고객만.
- X 버튼: 입력칸·결과 비고 빈 상태.
- 상세 뒤로가기: q 복원 + 입력칸에 검색어 + 편집 가능.
- 안내문구 표시, 셀렉트/체크박스 행 레이아웃 유지.
- `npm run build` + `npm run lint` 통과.

## Flag (추측 금지)
- 디바운스 완전 제거(setTimeout 검색 트리거 금지).
- 단일 토큰 경로 기존 로직 보존(RPC/fallback 둘 다).
- RPC 마이그 073 은 Bob 작성 금지(Arch).
