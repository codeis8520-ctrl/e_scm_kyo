# Review Request — Feature D / Step 2 (POS 판매위젯 정렬 필터)
Date: 2026-06-12
Ready for Review: YES

빌드: `npm run build` ✓ Compiled successfully in 9.2s, 에러/경고 0.

## Files Changed
모두 단일 파일 `src/app/(dashboard)/pos/page.tsx`:
- L12 — `@/lib/category-tree` 에서 `buildCategoryInfo`, `type CategoryInfo` import (Step 1 재사용 경로 동일).
- L208-209 — state 추가: `categoryInfo`(Map<string,CategoryInfo>), `widgetSort`('category'|'name'|'price'|'stock', 기본 'category').
- L417 / L424 / L432 — products 3단 폴백 select 모두에 `, category_id` 추가(기존 컬럼, graceful).
- L437-443 — Promise.all 에 `categories`(id,name,parent_id,sort_order; order by sort_order) 추가 + `categoriesRes` 구조분해.
- L466-467 — `setCategoryInfo(buildCategoryInfo(categoriesRes.error ? [] : data))` — error 시 빈 맵 유지.
- L805-840 — `filteredProducts` 를 useMemo 로 승격하고 정렬 적용. 검색/위젯 모드 동일 정렬. 원본 mutate 없음(`[...base].sort`). stock 정렬은 getStock(아래 선언) 회피 위해 inventoryMap 인라인 조회. deps: products,search,widgetSort,categoryInfo,selectedBranch,inventoryMap.
- L1962-1984 — 검색 input 블록(mb-2)을 flex 래퍼로 감싸고 정렬 `<select>`(4옵션: 카테고리순/고가순/이름순/재고순) 추가. input 폭 flex-1 유지.

## Open Questions
- stock 정렬에서 getStock useCallback(L857)이 filteredProducts(L805) 뒤에 선언되어 있어, memo 내부에 동일 로직(`inventoryMap.get(`${selectedBranch}_${id}`) ?? null`)을 인라인했습니다. 한 줄 중복이지만 선언 순서 재배치보다 안전하다고 판단 — 의견 주세요.

## Out of Scope (logged in BUILD-LOG)
- Known Gaps 비어 있음.
- 중분류 단독 그룹핑/헤더, 정렬값 영속화, 카드 디자인 변경 — 브리프 Out of Scope 로 미수행.
