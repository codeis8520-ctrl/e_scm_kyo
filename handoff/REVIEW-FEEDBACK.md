# Review Feedback — Feature D · Step 1 (카테고리 정렬: 공유 util 정리 + 재고현황 정렬 필터)
Date: 2026-06-12
Status: APPROVED

## Conditions
(없음 — 머지 차단 항목 없음)

## Minor (비차단 — Bob 인라인 정리 권장, 5분 미만)
- inventory/page.tsx:15 — `type CategoryInfo` import 추가했으나 파일 내 사용처 없음. ESLint
  `@typescript-eslint/no-unused-vars` warning 1건 신규 발생(빌드 게이트는 통과). import에서
  `type CategoryInfo` 만 제거하면 됨. `buildCategoryInfo` / `CategoryRow` 는 실사용 유지.
  (참고: 같은 파일의 no-explicit-any 9건은 전부 이번 변경과 무관한 기존 코드.)

## Escalate to Arch
(없음)

## Cleared
- Dedupe 무회귀: 로컬 CategoryRow/CategoryInfo/buildCategoryInfo 삭제 후 @/lib/category-tree
  import으로 대체. 공유 시그니처(sortKey/ancestorIds/pathCode/pathName/depth)가 기존 참조처
  (state:81, categoryInfo:291, categoryOptions:296, allowedCategoryIds:304, renderCategoryLabel:464)
  와 정확히 일치. category-tree.ts 무변경 확인.
- price 폴백 사다리: trySelects 최상위 변형(:257)에만 price 컬럼 추가, 하위 4개 변형·matchedProducts
  쿼리 무변경 → graceful degrade 보존. Inventory.product 에 price?:number|null(:26),
  ProductRow.price:number(:47), 실데이터 `?? 0`(:329) / phantom 합성 `0`(:349) 정상.
- 4개 정렬 모드 검증:
  · category — 트리순(sortKey, 미분류→'zzz' 끝) → 가격 desc tie-break(null→0, `(b.price||0)-(a.price||0)`)
    → 이름(localeCompare 'ko'). pivot·flat 양쪽 동일 로직, NaN 불가.
  · name — localeCompare 'ko', tie-break 지점명/제품명.
  · stockDesc/stockAsc — pivot 수량=byBranch reduce 합(:354), flat 수량=item.quantity(:414),
    부호 반전 정상, tie-break 이름.
- 비-카테고리 정렬 시 헤더·소계 숨김: pivot(:659)·flat(:833) 모두 `showCategoryChrome =
  sortMode==='category'` 가드로 [headerRow,...,subtotalRow] 대신 dataRows 만 반환. 그룹 빌더
  (:437-459)는 비-카테고리 시 단일 그룹 1개만 생성. renderCategoryLabel 은 headerRow JSX 내부에서만
  호출되고 null cid 안전 처리(미분류) → 비-카테고리 모드 크래시 없음. 카테고리 모드 헤더·소계 무회귀.
- 뷰 상태 누수 없음: sortMode 독립 state, flatGroups/pivotGroups 매 렌더 재계산. 정렬↔필터 전환 시
  stale 그룹 없음.
- DB/마이그레이션/schema.ts/tools.ts 변경 없음 — 정렬은 read-side 표현이므로 AI Agent Sync 매트릭스
  비해당. git diff 상 소스 변경은 inventory/page.tsx 단일 파일.
