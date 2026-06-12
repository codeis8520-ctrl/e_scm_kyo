# Review Request — Feature D · Step 1 (카테고리 정렬: 공유 util 정리 + 재고현황 정렬 필터)
Date: 2026-06-12
Ready for Review: YES

빌드: `npm run build` ✓ Compiled successfully in 7.9s, 에러/경고 0.
변경 파일: `src/app/(dashboard)/inventory/page.tsx` 단일 파일. `src/lib/category-tree.ts` 무변경, 신규 파일 없음(Arch 결정대로 category-sort.ts 미생성).

## Files Changed — src/app/(dashboard)/inventory/page.tsx
- :15 — `@/lib/category-tree` 에서 buildCategoryInfo / CategoryRow / CategoryInfo import 추가.
- (삭제) 기존 로컬 `interface CategoryRow` / `interface CategoryInfo` / `function buildCategoryInfo` 제거 — category-tree.ts 와 바이트 동일하던 중복 dedupe. 참조처(categoryInfo, state, renderCategoryLabel 등) 전부 import 본으로 해석됨(빌드 통과로 확인).
- :26 — `Inventory.product` 타입에 `price?: number | null` 추가.
- :47 — `ProductRow` 에 `price: number` 추가(피벗 정렬용).
- :93 — `sortMode` state 추가('category'|'name'|'stockDesc'|'stockAsc', 기본 'category').
- :325 영역(trySelects 맨 위 변형) — `product:products(..., price)` 로 price 컬럼만 추가. 하위 4개 변형·matchedProducts 쿼리(:246 영역) 무변경.
- :329 / :349 — ProductRow 빌더에 price 채움(실데이터 `inv.product.price ?? 0`, phantom-pack 합성 행 `0`).
- :354-373 — pivot 정렬 comparator. sortMode 분기: category(트리순 → 가격desc tie-break → 이름), name(가나다), stockDesc/stockAsc(pivot 수량=byBranch 합, tie-break 이름).
- :407-430 — flat 정렬 comparator. sortMode 분기: category(트리순 → 가격desc → 지점명 → 제품명), name(제품명 → 지점명), stockDesc/stockAsc(item.quantity, tie-break 제품명).
- :433-459 — 그룹 빌더. category 모드만 연속 카테고리 묶음, 그 외 단일 그룹 1개(flat·pivot 양쪽).
- :553-564 — 정렬 필터 select(4옵션) 컨트롤 행에 추가(카테고리 필터 다음, 유형 필터 앞).
- :658-800 (pivot) / :832-917 (flat) — `showCategoryChrome = sortMode === 'category'` 가드. 비-카테고리는 headerRow·subtotalRow 미반환 → 평면 행만 렌더. renderCategoryLabel 은 headerRow 내부에서만 호출되어 자동 가드.

## Review Focus
- dedupe 후 시그니처 동일성으로 모든 카테고리 참조가 import 본으로 무회귀 해석되는지(특히 sortKey/ancestorIds/pathCode 사용처).
- 카테고리순 회귀: 트리 순서 + 같은 카테고리 내 가격 desc tie-break, 헤더·소계 정상.
- 비-카테고리 3옵션: pivot·flat 모두 헤더·소계 사라지고 정렬된 평면 리스트.
- pivot 수량 합산(byBranch reduce) 정확성, 가격 null→0 폴백.

## Out of Scope (logged in BUILD-LOG)
- POS 위젯 정렬 → Step 2 별도 스프린트.
- price 폴백 하위 변형/matchedProducts 쿼리 price 추가 안 함(의도적 graceful degrade).
- DB/마이그/schema.ts/tools.ts 변경 없음(정렬=read 표현).
