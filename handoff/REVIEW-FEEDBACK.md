# Review Feedback — Feature D / Step 2 (POS 판매위젯 정렬 필터)
Date: 2026-06-12
Status: APPROVED

## Conditions
(없음)

## Escalate to Arch
(없음)

## Cleared
src/app/(dashboard)/pos/page.tsx 단일 파일 변경 전부 검증 통과 — category_id 3단 폴백 select 모두 반영(L417/424/432, 기존 컬럼 graceful), Promise.all 에 categories 추가 후 error 시 빈 맵 fallback(L467), widgetSort state + 4옵션 드롭다운, filteredProducts useMemo 승격(검색·위젯 동일 정렬, 원본 mutate 없음, deps 완전).

검증 결과:
- 재고순 인라인 stockOf(L816-817) `inventoryMap.get(\`${selectedBranch}_${id}\`) ?? null` 이 실제 getStock(L857-859)과 keying·branch 해석 완전 일치 → 표시 재고와 정렬 일관성 확인. Open Question 의 한 줄 중복 회피 판단 타당(선언 순서 재배치보다 안전).
- 카테고리 정렬: buildCategoryInfo sortKey(zero-pad 누적 "001/001/") localeCompare 트리순 정확. null 카테고리 '￿'(U+FFFF) 센티넬이 실제 sortKey 뒤로 정렬됨을 node localeCompare 로 실측 확인(=1). categoryInfo 빈 맵(fallback) 시 전 제품 '￿' → 고가순→이름순으로 graceful degrade.
- 동률 처리: 카테고리/재고 동일 시 price-desc → byName('ko') 일관 적용. NaN price 시 `(b.price-a.price)` = NaN(falsy) → byName 으로 폴백되어 throw·역전 없음.
- pos_widget 컬럼 부재 폴백(전부 노출) 유지, 검색 매칭 로직 무변경, getStock/그리드/체크아웃 회귀 없음.
- category-tree.ts 재사용(중복 없음), DB/migration/schema.ts/tools.ts 무변경 — AI Agent Sync 매트릭스 비해당.
