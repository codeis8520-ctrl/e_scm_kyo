# Architect Brief — Step 2 (POS 판매위젯 정렬 필터)

## Goal
POS 판매상품 위젯 그리드에 정렬 드롭다운을 추가한다. 기본 = 카테고리순(계층 sortKey) → 동일 카테고리 내 고가순. Step 1과 동일하게 @/lib/category-tree 의 buildCategoryInfo/CategoryInfo 를 재사용한다.

## File
`src/app/(dashboard)/pos/page.tsx` (단일 파일. 신규 util 금지.)

## Build Order

1. **products 쿼리에 `category_id` 추가** — L413~432 의 3단 폴백 select 문자열 **모두**에 `, category_id` 추가.
   - L415, L422, L430 세 곳. 폴백 사다리 구조는 그대로 유지(컬럼은 DB에 존재하므로 graceful — 단지 select에 빠져 있었음).

2. **categories 로드 + CategoryInfo 맵 구성**
   - L435 `Promise.all([...])` 배열에 `supabase.from('categories').select('id, name, parent_id, sort_order').order('sort_order')` 한 줄 추가, 구조분해 변수 `categoriesRes` 추가.
   - import: 파일 상단에 `import { buildCategoryInfo, type CategoryInfo } from '@/lib/category-tree';` (Step1이 inventory에서 쓴 동일 경로).
   - state: L206 근처에 `const [categoryInfo, setCategoryInfo] = useState<Map<string, CategoryInfo>>(new Map());`
   - L462 `setProducts(productsData)` 부근에서 `setCategoryInfo(buildCategoryInfo((categoriesRes.data || []) as any[]))` 호출.
   - categories 테이블/컬럼 부재 가능성 낮지만 `categoriesRes.error` 시 빈 맵 유지(폴백 = 정렬 시 카테고리 없는 제품처럼 처리). 별도 재시도 select 불필요.

3. **정렬 state + 드롭다운**
   - state: `const [widgetSort, setWidgetSort] = useState<'category' | 'name' | 'price' | 'stock'>('category');`
   - 드롭다운 UI: L1957 검색 input 블록(`mb-2`) 안, input 우측 또는 아래에 `<select>` 추가. 라벨 텍스트:
     - `category` → "카테고리순" (기본)
     - `price` → "고가순"
     - `name` → "이름순"
     - `stock` → "재고순"
   - className 은 기존 `input` 클래스 재사용(`text-sm`), 폭은 적당히(`w-auto` 또는 작은 고정폭). 검색 input 폭을 깨지 말 것.

4. **정렬 적용 — filteredProducts (L803~805)**
   - 현재 inline 표현식을 정렬까지 포함하도록 변경. 가독성 위해 `useMemo`로 승격 권장(deps: products, search, widgetSort, categoryInfo, selectedBranch, inventoryMap). selectedBranch/inventoryMap 은 stock 정렬에서만 필요 — getStock 로직을 memo 내부에서 인라인 참조하거나 deps에 포함.
   - 필터 단계(검색/위젯)는 기존 로직 유지. 그 결과 배열에 **정렬을 동일하게 적용**(검색 중이든 위젯 모드든 동일 정렬 — 명시).
   - 정렬 비교 함수:
     - `category`: 1차 = `categoryInfo.get(p.category_id)?.sortKey ?? '￿'`(카테고리 없는 제품은 맨 뒤) localeCompare, 2차(동일 sortKey) = `price` 내림차순(고가순), 3차 = name localeCompare(안정).
     - `price`: price 내림차순(고가순), 동가 시 name.
     - `name`: name localeCompare.
     - `stock`: `getStock(p.id)` 내림차순. stock===null(미로드)은 맨 뒤. 동수 시 name.
   - 원본 products 배열 mutate 금지 — `[...arr].sort(...)`.

## Out of Scope
- DB 마이그레이션 / schema.ts / tools.ts — 변경 **없음**. 본 작업은 read-side 정렬 표현뿐(category_id 는 기존 컬럼). AI 스키마 동기화 불필요.
- 중분류 단독 그룹핑(depth=1 조상으로 묶는 헤더/구분선) — **불필요**. sortKey 계층 정렬이 대>중>소 순서를 자동 반영하므로 제외.
- 위젯 그리드 카드 디자인/재고 배지 변경 — 손대지 말 것(L1988~2012 그대로).
- 정렬 선택값 영속화(localStorage 등) — 제외.

## Acceptance
- `npm run build` 통과.
- 기본 진입 시 그리드가 카테고리 계층순 → 동일 카테고리 내 고가순으로 정렬됨.
- 드롭다운에서 이름순/고가순/재고순 전환 시 그리드 즉시 재정렬.
- pos_widget / category_id / categories 중 어느 것이 DB에 없어도(폴백) 에러 없이 동작(정렬만 약화).
- 검색 모드에서도 동일 정렬 적용.
- 원본 products 순서 mutate 없음.
