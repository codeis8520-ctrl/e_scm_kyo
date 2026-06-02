# Architect Brief — Step: 고객 상세 UX 2건 (인라인 수정 + 목록 복원)

## Goal
고객 상세에서 기본정보를 바로 수정 가능(기존 CustomerModal 재사용)하고, "← 목록" 클릭 시 직전 검색/필터 결과로 복원된다.

## Build Order

### A) 기본정보 직접 수정 — CustomerModal 재사용 (새 폼 발명 금지)
파일: `src/app/(dashboard)/customers/[id]/page.tsx`
- CustomerModal import 추가: `import CustomerModal from '../CustomerModal';`
- state 추가: `const [showEditModal, setShowEditModal] = useState(false);`
- "기본 정보" 카드(L527 영역) 헤더에 "수정" 버튼 추가 → `onClick={() => setShowEditModal(true)}`.
- info 탭 안내문(L1266 "기본 정보 수정은 고객 목록의 '수정' 버튼을 이용하세요.")은 동일한 "수정" 버튼으로 교체(안내문 제거).
- 컴포넌트 return 말미에 모달 렌더:
  ```
  {showEditModal && (
    <CustomerModal
      customer={customer}
      onClose={() => setShowEditModal(false)}
      onSuccess={() => { setShowEditModal(false); fetchData(); }}
    />
  )}
  ```
- Flag: CustomerModal props는 `{ customer, onClose, onSuccess }` 정확히 이 3개(CustomerModal.tsx L26-29). 다른 prop 발명 금지.
- Flag: 권한·저장 로직은 CustomerModal 내부 액션 그대로 사용. 상세 페이지에서 새 권한 분기/우회 작성 금지. 목록 수정과 동일 RBAC.
- Flag: 모달이 읽는 `customer.primary_branch_id`(스칼라)는 상세 select의 `*` 에 포함됨 — 별도 매핑 불필요. customer 객체 그대로 넘길 것.
- 저장 후 리로드는 반드시 기존 `fetchData()`(L200) 재호출. 새 fetch 함수 작성 금지.

### B) 목록 복원 — 검색 qs를 상세 URL로 전달 (back() 폴백 방식 채택 안 함)
목록 키 정의: `q`, `grade`, `hasConsult`, `sort`, `page` (tab은 상세로 전달하지 않음 — 상세는 자체 tab 키 사용).

B-1. 목록 → 상세 링크에 현재 검색 qs 부착 — 파일: `src/app/(dashboard)/customers/page.tsx`
- 현재 검색 상태로 qs 만드는 useMemo 추가(L182-192 동기화 키와 동일, tab 제외):
  ```
  const listQs = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('q', search);
    if (gradeFilter) p.set('grade', gradeFilter);
    if (hasConsult) p.set('hasConsult', '1');
    if (sortKey && sortKey !== 'recent_consult') p.set('sort', sortKey);
    if (page > 1) p.set('page', String(page));
    return p.toString();
  }, [search, gradeFilter, hasConsult, sortKey, page]);
  ```
- L405 이름 링크: `href={listQs ? \`/customers/${customer.id}?${listQs}\` : \`/customers/${customer.id}\`}`
- L472 "상담 기록 없음" 링크: 기존 `?tab=consultations`에 listQs 머지 → `href={\`/customers/${customer.id}?tab=consultations${listQs ? \`&${listQs}\` : ''}\`}`

B-2. 상세 "← 목록" 버튼이 목록 키로 복원 — 파일: `src/app/(dashboard)/customers/[id]/page.tsx` (L509)
- searchParams에서 목록 키만 추려 href 구성(상세전용 tab 제외):
  ```
  const backHref = (() => {
    const keys = ['q','grade','hasConsult','sort','page'];
    const p = new URLSearchParams();
    for (const k of keys) { const v = searchParams.get(k); if (v) p.set(k, v); }
    const qs = p.toString();
    return qs ? `/customers?${qs}` : '/customers';
  })();
  ```
- L509 Link href를 `"/customers"` → `{backHref}`로 교체.
- Flag: 상세 기존 탭-동기화(L624-626)는 searchParams 전체를 보존하므로 B-1로 실어준 목록 키가 상세 머무는 동안 URL에 유지됨 → backHref 정상 복원. 이 코드 건드리지 말 것.

## Out of Scope
- 고객 병합 / 포장옵션 / legacy 관련 — 손대지 말 것.
- 목록 검색결과 캐싱·prefetch — 범위 밖.
- DB/마이그/src/lib/ai/schema.ts — 변경 없음(순수 프론트).
- back()/router.back() 폴백 — 채택 안 함. 구현 금지.

## Acceptance
- 상세 기본정보 카드 + info탭에서 "수정" 버튼 → CustomerModal 열림 → 저장 시 상세 데이터 즉시 갱신.
- 권한: 목록 수정과 동일(별도 권한 분기 없음).
- 목록 검색/필터/정렬/페이지 적용 → 고객 클릭 → 상세 → "← 목록" → 직전 상태 복원.
- 직접 URL 진입(qs 없음) 시 "← 목록"은 `/customers` 폴백.
- `npm run build` 통과.

## Review
보안 민감(고객정보 수정 경로). Richard 리뷰 필수 — RBAC/권한 우회 점검: 상세가 CustomerModal 외 별도 권한 분기를 만들지 않았는지, 저장 경로가 목록과 동일한지.
