# Architect Brief — 카테고리 정렬 Step 1 (공유 util 정리 + 재고현황 정렬 필터)

## Goal
재고현황 화면에 4옵션 정렬 필터를 추가하고, 비-카테고리 정렬 시 카테고리 헤더를 숨겨 단일 평면 리스트로 렌더한다. 동시에 inventory 페이지가 끌어안고 있던 중복 카테고리 util을 기존 공유 util로 일원화한다.

## ⚠️ Arch 결정 — 신규 파일 만들지 말 것 (locked policy 와의 차이, 의도적)
locked policy 는 `src/lib/category-sort.ts` 신규 생성을 명시하나, **이미 `src/lib/category-tree.ts` 가 동일한 `CategoryRow`/`CategoryInfo`/`buildCategoryInfo` 를 export 하고 있고** products·production·ProductModal 이 이를 import 중이다. inventory/page.tsx L34~95 의 로컬 사본은 그 util 과 **바이트 단위로 동일**하다.
- 따라서 "공유 util 추출" 의 실제 작업 = **신규 파일 생성이 아니라, inventory 의 로컬 중복을 삭제하고 기존 `@/lib/category-tree` 에서 import** 하는 것.
- 새 `category-sort.ts` 를 만들면 `category-tree.ts` 와 드리프트하는 두 번째 카테고리 util 이 생긴다 — 정확히 회피해야 할 미래 부채. policy 의 의도("순수 이동·로직 무변경·정렬 회귀 방지")는 dedupe 로 더 잘 충족된다.
- **로직은 단 한 줄도 바꾸지 말 것.** import 교체만. (정렬 회귀 방지 = 동일 util 재사용)

## Build Order

### 1) 카테고리 util 일원화 (순수 dedupe, 로직 무변경)
- `src/app/(dashboard)/inventory/page.tsx`:
  - L34~39 `interface CategoryRow` 삭제, L57~66 `interface CategoryInfo` 삭제, L68~95 `function buildCategoryInfo` 삭제.
  - 상단 import 블록(L3~14 영역)에 추가: `import { buildCategoryInfo, type CategoryRow, type CategoryInfo } from '@/lib/category-tree';`
  - Flag: 삭제 후 `CategoryRow`/`CategoryInfo`/`buildCategoryInfo` 참조처(L127 state, L336 categoryInfo, L399/442/473 등)가 import 본으로 그대로 해석되는지 빌드로 확인. 시그니처 동일하므로 무변경이어야 정상.

### 2) inventory product 쿼리에 price 추가 (폴백 사다리 맨 위 1개만)
- `src/app/(dashboard)/inventory/page.tsx`:
  - `Inventory.product` 타입(L25)에 `price?: number | null` 추가.
  - `trySelects` 사다리(L301~307): **맨 위 변형(L302)에만** `product:products(... , price)` 로 `price` 컬럼 추가. **나머지 4개 변형은 그대로 둔다**(price 미지원/누락 시 자동 폴백 → 가격 없으면 0 취급).
  - Flag: 맨 위 외 변형에 price 넣지 말 것. 폴백 사다리의 존재 이유는 컬럼 부재 환경 graceful degrade.
  - L246 의 `matchedProducts` select 는 **무변경**(price 불필요 — 정렬은 inv.product 에서 읽음).

### 3) sortMode state + 4옵션 정렬 필터 UI
- `src/app/(dashboard)/inventory/page.tsx`:
  - 새 state: `const [sortMode, setSortMode] = useState<'category'|'name'|'stockDesc'|'stockAsc'>('category');`
  - 정렬 필터 select 를 컨트롤 행(L538~620, 검색/카테고리/유형/뷰토글 줄)에 추가. 4옵션 라벨:
    - `category` → "카테고리순 → 고가순" (기본)
    - `name` → "이름순 (가나다)"
    - `stockDesc` → "재고 많은순"
    - `stockAsc` → "재고 적은순"

### 4) 정렬 로직 — pivot(productRows) + flat(filteredFlat) 양쪽
- pivot 정렬(L397~404)과 flat 정렬(L438~449)의 comparator 를 `sortMode` 분기로 교체:
  - `category`: **현행 로직 유지** + tie-break 를 **가격 내림차순(고가순)** 으로 확장.
    - pivot: 같은 카테고리 내 1차 가격 desc, 동일 가격이면 기존 이름순.
    - flat: 같은 카테고리 내 기존 지점명 → (현행 유지). 가격 tie-break 는 pivot 우선. flat 의 카테고리순 tie-break 는 현행(지점명→제품명) 유지하되, 같은 제품 묶음 비교에 가격 desc 를 카테고리 다음·지점명 앞에 둘지 여부는 **pivot 기준 통일**: flat 도 카테고리 → 가격 desc → 지점명 → 제품명 순으로.
    - 가격 없음(null/undefined)은 0 으로 취급해 맨 뒤.
  - `name`: 카테고리 무시, 제품명 가나다(`localeCompare('ko')`). flat 은 제품명 → 지점명 tie-break.
  - `stockDesc`: 재고 수량 내림차순. pivot 의 수량 = byBranch 합계(전 지점 합), flat 의 수량 = `item.quantity`. tie-break 제품명.
  - `stockAsc`: 위의 오름차순.
  - Flag: pivot 의 "재고 수량"은 `Object.values(r.byBranch).reduce((s,i)=>s+(i.quantity||0),0)` 로 계산. 지점 사용자 자기지점만 보일 때도 byBranch 합으로 일관.

### 5) 비-카테고리 정렬 시 카테고리 헤더 숨김 → 단일 평면 리스트 (pivot·flat 둘 다)
- 그룹 빌더(flat L453~459, pivot L462~468) 를 `sortMode` 로 분기:
  - `sortMode === 'category'`: **현행 그대로** 연속 카테고리 묶어 그룹 생성.
  - 그 외(name/stockDesc/stockAsc): **단일 그룹 1개**로 전체 행을 담되, 헤더 렌더가 그려지지 않도록 한다. 가장 안전한 방법: 그룹 헤더 렌더 지점에서 `sortMode === 'category'` 일 때만 카테고리 헤더 행을 출력하고, 비-카테고리면 헤더 행 자체를 건너뛰고 행만 평면 렌더.
  - Flag: 소계(subtotal) 행도 카테고리 헤더에 종속되면 함께 숨길 것. 평면 리스트는 헤더·소계 없이 정렬된 행만.
  - Flag: `renderCategoryLabel`(L471~476) 은 카테고리순일 때만 호출되도록 가드.

## Out of Scope
- POS 위젯 정렬 (→ Step 2, 별도 배포 단위).
- 관리 UI·DB 변경. **마이그레이션 없음.**
- `src/lib/ai/schema.ts` / `src/lib/ai/tools.ts` 변경 없음 — 정렬은 read 표현일 뿐 스키마·비즈니스 규칙 변경 아님.
- products/production/ProductModal 의 카테고리 정렬 동작 변경 없음(util 은 무변경, import 만 통일).
- price 폴백 사다리 하위 변형 수정 / matchedProducts 쿼리 price 추가.

## Acceptance
- `npm run build` 통과, 에러·경고 0.
- inventory 로컬 `buildCategoryInfo`/`CategoryInfo`/`CategoryRow` 삭제됨, `@/lib/category-tree` import 로 대체. category-tree.ts 무변경.
- 신규 `category-sort.ts` **생성 안 됨**(의도적 — 위 Arch 결정).
- 재고현황에 4옵션 정렬 select 노출. 기본 = 카테고리순→고가순.
- 카테고리순: 트리 순서 유지 + 같은 카테고리 내 가격 내림차순 tie-break, 카테고리 헤더·소계 정상 표시(현행 회귀 없음).
- 이름순/재고많은순/재고적은순: 카테고리 헤더·소계 사라지고 단일 평면 리스트로 정렬, pivot·flat 양 뷰 모두.
- price 미존재 행도 0 으로 취급해 깨지지 않음(폴백 사다리 정상 동작).
