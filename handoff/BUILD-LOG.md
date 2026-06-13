# BUILD-LOG — Feature B: 다건 지점 재고 이동

## Feature A (완료·배포)
- Step 1·2 모두 배포 완료 — commit 00e30ed + fd66279, 마이그 079 적용. (재고 소모/사용유형)

## Feature B — 다건 지점 재고 이동 · 1 step (빌드 완료 · 리뷰 대기)
시작: 2026-06-12

### Build Status (2026-06-12)
- BUILT — npm run build ✓ Compiled successfully (5.7s, 에러/경고 없음). [AMENDMENT 적용 후 재빌드 통과]
- 변경 파일:
  - src/lib/actions.ts L1254~1359 — transferInventoryBatch 신규 (2-pass, OUT+IN TRANSFER). [amendment 무변경]
  - src/app/(dashboard)/inventory/TransferBatchPanel.tsx — 신규 인라인 패널. [amendment: 출발지 자체 페치 + qty=0 가드]
  - src/app/(dashboard)/inventory/page.tsx — import, subView state, 토글 바, stock 뷰 fragment 래핑, transfer 분기. [amendment: inventories prop 전달 제거]

### Amendment Build (2026-06-12) — 후보 자체 페치 + qty=0 가드
- TransferBatchPanel: `inventories` prop 제거 → `getInventory(fromBranchId)`(actions.ts:984) 자체 페치(`srcInventories` state, useEffect([fromBranchId]) refetch, cancelled 가드). stockOf/candidates → srcInventories. 로딩/빈 인라인 힌트 추가.
- submitDisabled 에 `rows.some(r=>r.quantity<1)` 추가(Should Fix). page.tsx 의 `inventories={inventories}`(L504) 제거.
- 결과: HQ/SUPER_ADMIN 선검색 없이 지점이동 직행 → 출발지 선택 시 재고>0 후보 노출. 출발지 변경 시 갱신.

### Locked Decisions
- [AMEND 2026-06-12 — 모달 → 서브뷰 탭] Project Owner override: UI 는 재고 페이지 내 **서브뷰 토글**('재고현황'↔'지점이동'), 모달 아님.
  명시 선택 "재고 페이지 내 새 화면/탭" + SalesListTab 지점비교 서브뷰 토글 선례(commit 5b8c319) 일치. 풀폭 2-panel(좌 출발→우 도착)을 모달보다 잘 수용.
  · 신규 TransferBatchPanel.tsx(인라인 패널, onClose 없음) — StockUsageModal 다행 품목검색 패턴 재사용하되 모달 래퍼 제거.
  · page.tsx subView state + SalesListTab L554-569 토글 바 복제. 단 isBranchUser 게이트 없음(지점고정 사용자도 노출, 출발지 자기지점 잠금).
  · (구 결정 폐기: 헤더 "+ 지점 이동" 버튼 → TransferBatchModal 모달.) 기존 행별 단건 TransferModal 은 변함없이 유지.
- 신규 액션 transferInventoryBatch (객체 인자). recordStockUsage 의 2-pass 구조 + 단건 transferInventory 의 OUT/IN 로직 배치 래핑.
- 이동은 음수 미허용 — pass1 에서 출고지 재고부족 라인 전수검사로 거부(소모의 음수허용과 다름). 단건 transferInventory L1201 선례.
- from===to 거부, 수량 정수>=1. 부분실패 없음(pass1 전수검증 후 pass2 일괄).
- movement: OUT(from)+IN(to), reference_type='TRANSFER' (단건과 동일). 입고지 행 없으면 insert.
- RBAC: 지점고정 사용자 출발지=자기지점 고정(disabled), 도착지 자유 선택(지점간 물류 입고 허용).
- RAW/SUB 본사 제한 이동에 미적용(단건 transferInventory 에도 제한 없음 — 선례 일치).
- DB 마이그레이션 없음. AI 배치도구 추가 없음(단건 transfer_inventory 존재). schema.ts/tools.ts 변경 불필요.

### Known Gaps
- pass1↔pass2 비트랜잭션 — 동시성 레이스(기존 단건과 동일 한계). 향후 RPC 트랜잭션화 검토 대상.
- AI 에이전트 다건 이동 미지원(UI 전용). 필요 시 후속 스프린트에서 transfer_inventory_batch 도구 추가.
- [RESOLVED 2026-06-12 AMENDMENT] (구) 패널 품목검색이 page.tsx inventories state 의존 → HQ 직행 시 후보 빈. → AMENDMENT 로 TransferBatchPanel 이 getInventory(fromBranchId) 자체 페치하도록 변경, 해소됨.

## Known Gaps (Feature B)
- [보안 후속 — 단건+배치 공통] transferInventory(actions.ts:1176-1203) 및 transferInventoryBatch 모두 호출자 지점 대조 없이 입력 from_branch_id 를 그대로 사용. UI 는 fromBranchLocked 로 잠그나 서버측 강제 부재. 지점 사용자가 직접 서버 액션 호출 시 타지점 출발 재고 반출 잠재 경로. 신규 회귀 아님(단건 선례). → 단건·배치 동시 서버측 출발지 강제로 별도 스텝 후속. 제품/보안 정책 결정.

## Decisions (Feature B)
- 2026-06-12 AMENDMENT: 리뷰 갭(HQ 사용자 후보 빈) 스코프 포함 확정. TransferBatchPanel 이 getInventory(fromBranchId) 로 출발지 inventories 자체 페치(출발지 변경 시 refetch), page-level inventories 의존 제거. + qty<1 submitDisabled 가드(Should Fix). RBAC 서버강제는 파킹(위 Known Gap).

---

## Feature C — Cafe24 Bugfix (2 bugs · 1 step) · 빌드 완료 · 리뷰 대기
시작: 2026-06-12

### Build Status
- BUILT — npm run build ✓ 컴파일 성공·에러/경고 없음.
- 변경 파일:
  - src/lib/cafe24/types.ts — `firstPositiveAmount(...vals)` 공유 헬퍼 신규(우선순위대로 Number 변환→첫 유한+양수, 없으면 0). Bug ③ 단일 출처.
  - src/app/api/cafe24/orders/route.ts — (a) `isNoSelection(v)` 헬퍼 + parseOptionPairs 양 분기 적용(Bug ②); (b) firstPositiveAmount import + L322 total_price 교체(Bug ③).
  - src/lib/cafe24/webhook.ts — firstPositiveAmount import + total_amount(L273~) ?? 체인 교체(Bug ③). L369/L391 createSaleJournal 무변경(DB 행에서 읽어 transitive 수정).
  - src/lib/ai/schema.ts — BUSINESS_RULES 한 줄 추가(cafe24 total_amount = 결제수단 무관 주문상품금액). DB_SCHEMA 무변경.

### Locked Decisions
- Bug ②: isNoSelection = `v.replace(/\s+/g,'') === '선택안함'` ("선택안함"+"선택 안함" 커버, 추가 퍼징 없음). 배열 분기는 v='' 로 기존 filter 가 드롭, 문자열 분기는 '' 반환(기존 bare k 반환 아님 → .filter(Boolean) 으로 완전 제거). L281-288 extractItemOptions 무변경(`''` → `name xQty` 폴백 기존 동작).
- Bug ③ 필드 우선순위 LOCKED: payment_amount → order_price_amount → total_order_price → actual_payment_amount(webhook) / +detailOrder 변형(orders/route). 0/빈값/NaN 은 이제 통과(포인트 전액결제 payment_amount=0 → order_price_amount 사용). 정상주문 무변경.
- 헬퍼 위치: types.ts(webhook 이 이미 import 중) → 양 spot 공유.
- discount_amount(webhook L281-286) 무변경(0 은 유효 할인).

### Known Gaps
- [Project Owner 결정 대기] 기존 0원 sales_orders.total_amount 행 + 잘못 기표된 journal_entries 백필. 이번 수정은 FORWARD-ONLY. 자동 백필 안 함.
- sync-orders.ts: amount/parseOptionPairs 패턴 없음(status-only) 확인 → 미수정.

---

## Feature D — 카테고리 정렬 · Step 1 (공유 util 정리 + 재고현황 정렬 필터) · 브리프 작성
시작: 2026-06-12 (카페24 버그 스프린트로 덮였던 브리프 재작성)

### Locked Decisions
- [Arch 결정 — policy 차이, 의도적] 신규 `src/lib/category-sort.ts` 생성 안 함. 기존 `src/lib/category-tree.ts` 가 동일 `CategoryRow/CategoryInfo/buildCategoryInfo` 를 이미 export(products·production·ProductModal 사용 중)하고, inventory/page.tsx L34~95 로컬 사본이 바이트 동일. → "공유 util 추출" = inventory 로컬 중복 삭제 + `@/lib/category-tree` import 로 통일. 두 번째 util 신설 시 드리프트 부채 → 회피. policy 의도(순수 이동·로직 무변경·회귀 방지)는 dedupe 가 더 잘 충족.
- [Project Owner 해결] 비-카테고리 정렬(이름순/재고많은·적은순) 시 카테고리 그룹 헤더·소계 숨기고 단일 평면 리스트. pivot·flat 양 뷰 모두. → 기본 LOCKED.
- 4옵션: 카테고리순→고가순(기본, sortKey 계층순 + tie-break 가격 desc) / 이름순(가나다) / 재고많은순 / 재고적은순.
- price: trySelects 폴백 사다리 맨 위 변형 1개에만 추가, 하위 4개 무변경(graceful degrade). matchedProducts 쿼리 무변경. 가격 null=0 취급.
- DB/관리 UI 변경 0, 마이그 없음, schema.ts/tools.ts 무변경(정렬=read 표현).
- Step 분할: Step 1=공유 util 정리+재고현황(이번 배포 단위). Step 2=POS 위젯(별도).

### Build Status (2026-06-12) — BUILT · 리뷰 대기
- npm run build ✓ Compiled successfully in 7.9s, 에러/경고 0.
- 변경 파일: src/app/(dashboard)/inventory/page.tsx (단일 파일). category-tree.ts 무변경, 신규 파일 없음.
  - L15 — `@/lib/category-tree` 에서 buildCategoryInfo/CategoryRow/CategoryInfo import.
  - (삭제) 로컬 interface CategoryRow / interface CategoryInfo / function buildCategoryInfo — 바이트 동일 dedupe.
  - L26 — Inventory.product 타입에 `price?: number | null` 추가.
  - L47 — ProductRow 에 `price: number` 추가(피벗 정렬용).
  - L93 — `sortMode` state('category'|'name'|'stockDesc'|'stockAsc', 기본 'category').
  - L329/L349 — ProductRow 빌더에 price 채움(실데이터 `inv.product.price ?? 0`, phantom-pack 합성 행 `0`).
  - L354~373 — pivot 정렬 comparator sortMode 분기(category=트리순+가격desc tie-break, name, stock asc/desc; pivot 수량=byBranch 합).
  - L407~430 — flat 정렬 comparator sortMode 분기(category=트리순+가격desc→지점명→제품명; name; stock asc/desc=item.quantity).
  - L433~459 — 그룹 빌더 sortMode 분기(category=연속 카테고리 묶음, 그 외=단일 그룹 1개).
  - L553~564 — 정렬 필터 select(4옵션) 컨트롤 행에 추가.
  - L658~800 (pivot) / L832~917 (flat) — showCategoryChrome=`sortMode==='category'` 가드. 비-카테고리는 headerRow·subtotalRow 미반환(평면 행만). renderCategoryLabel 은 headerRow 내부에서만 호출 → 자동 가드.

### Build Decisions (Step 1)
- price 폴백: trySelects 맨 위 변형(L325 영역)에만 `, price` 추가, 하위 4개·matchedProducts 무변경. products.price 컬럼은 schema.sql L78 에 존재(NOT NULL) — 폴백은 안전망.
- pivot 수량 = `Object.values(r.byBranch).reduce((s,i)=>s+(i.quantity||0),0)` (지점 사용자도 byBranch 합 일관). flat 수량 = item.quantity.
- 가격 null/undefined → 0 취급, 고가순 정렬 시 맨 뒤.
- 비-카테고리 단일 그룹의 categoryId=null 이지만 헤더 미렌더이므로 라벨 영향 없음.

### Known Gaps
- (대기) POS 위젯 정렬 = Step 2 별도 스프린트.

---

## Feature D — 카테고리 정렬 · Step 2 (POS 판매위젯 정렬 필터) · 빌드 완료 · 리뷰 대기
시작: 2026-06-12

### Build Status — BUILT
- npm run build ✓ Compiled successfully in 9.2s, 에러/경고 0.
- 변경 파일: src/app/(dashboard)/pos/page.tsx (단일 파일). 신규 util 없음, category-tree.ts 무변경.
  - L12 — `import { buildCategoryInfo, type CategoryInfo } from '@/lib/category-tree';`
  - L208~209 — state `categoryInfo`(Map) + `widgetSort`('category'|'name'|'price'|'stock', 기본 'category').
  - L417/L424/L432 — products 3단 폴백 select 모두에 `, category_id` 추가.
  - L437~443 — Promise.all 에 `categories` select(id,name,parent_id,sort_order order by sort_order) + `categoriesRes` 구조분해.
  - L466~467 — `setCategoryInfo(buildCategoryInfo(categoriesRes.error ? [] : data))` (error 시 빈 맵).
  - L805~840 — filteredProducts useMemo 승격 + 정렬(검색·위젯 모드 공통). deps: products,search,widgetSort,categoryInfo,selectedBranch,inventoryMap.
  - L1962~1984 — 검색 input 블록에 flex 래퍼 + 정렬 select(4옵션) 추가.

### Build Decisions (Step 2)
- category_id 는 기존 컬럼(products) — 폴백 사다리 3변형 모두 추가, DB 부재 시 graceful(정렬만 약화).
- categories 페치: `(supabase as any).from('categories')` 캐스트(타입 미정의 회피). error 시 빈 맵 → 카테고리 없는 제품처럼 맨 뒤 정렬.
- stock 정렬: getStock(L857)이 filteredProducts(L805)보다 뒤 선언 → memo 내부에 동일 로직(`inventoryMap.get(`${selectedBranch}_${id}`) ?? null`) 인라인. use-before-declaration 회피.
- 정렬 규칙: category=sortKey(없으면 '￿' 맨뒤)→가격desc→이름 / price=가격desc→이름 / name=이름 localeCompare('ko') / stock=재고desc, null(미로드) 맨뒤→이름.
- 원본 products mutate 없음(`[...base].sort`). 중분류 단독 그룹핑/헤더 없음(브리프 Out of Scope — sortKey 계층이 대>중>소 자동 반영).
- DB/마이그/schema.ts/tools.ts 무변경.

### Known Gaps
- 없음.

---

## Feature E — 재고이동 from_branch 서버측 소유 검증 (보안) · 1 step · 빌드 완료 · 리뷰 대기
시작: 2026-06-12 / 해소 대상: Feature B Known Gap L41(단건+배치 출발지 서버측 무검증)

### Build Status — BUILT
- npm run build ✓ Compiled successfully (6.2s), 에러/경고 0. (tsc --noEmit 0 에러)
- 변경 파일: src/lib/actions.ts (단일 파일)
  - L9 — `import { requireSession, type SessionUser } from '@/lib/session';` 추가.
  - L1177~1196 — 모듈 로컬 헬퍼 `assertFromBranchOwnership(session, fromBranchId): { error: string } | null` 신규(단건·배치 공유).
  - L1207~1209 — transferInventory 초입(formData 파싱 직후): `requireSession()` + 헬퍼, 거부 시 `{ error }` return.
  - L1300~1302 — transferInventoryBatch pass1(from/to 존재 체크 직후, 재고부족 검사 전): 동일 패턴.

### Locked Decisions
- 정책(브리프 잠금): HQ급(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE)=출발지 자유. 지점고정(BRANCH_STAFF/PHARMACY_STAFF)=`from===session.branch_id`만 허용, 불일치/branch_id=null 시 거부('본인 지점의 재고만 출고할 수 있습니다.'). 도착지(to_branch) 무검증(타지점 입고 허용 유지).
- branch_id=null(지점고정) 거부 = 안전측. requireSession()은 세션 없으면 throw → 미인증 차단.
- 두 함수가 헬퍼 1개 공유(로직 드리프트 없음).
- DB/마이그/schema.ts/tools.ts 변경 없음(순수 액션 가드, 스키마·enum 불변).

### Build Decisions
- 거부 반환을 `return denied;`(변수, `{ error: string } | null` narrow) 대신 `return { error: denied.error };`(리터럴)로 작성. 이유: 변수 union 반환이 함수 추론 반환타입의 `success: true` 리터럴을 `boolean`으로 widen시켜 호출부 TransferBatchPanel/TransferModal 의 `result?.error` 판별 union이 깨지는 tsc 에러 발생. 리터럴 반환은 기존 error 반환 패턴과 동일하며 동작·메시지 무변경.

### Known Gaps
- [인접 보안 갭 — 이번 스코프 아님] adjustInventory(actions.ts:1005)·recordStockUsage(actions.ts:1086): 호출자 지점 대조 없이 입력 branch_id 사용. adjustInventory 는 RAW/SUB 본사 제한만 있고 일반 제품은 타지점 조정 가능 잠재. 지점고정 직원의 임의 branch_id 조정/소모 경로 — 동일한 출발지 가드 미적용. 후속 보안 스텝 후보(제품/보안 정책 결정).
- AI tool execTransferInventory(tools.ts transfer_inventory): 별도 코드경로(자체 movements, 이 서버액션 미경유), ToolContext RBAC 관할 → 이번 변경 무관(손대지 않음).
- pass1↔pass2 비트랜잭션 동시성 레이스(기존 한계) — 이번 스코프 아님.

---

## Feature C — 카페24 주문자 등록 시 구매품목 텍스트 저장 · 1 step (빌드 완료 · 리뷰 대기)
시작: 2026-06-12

### Build Status (2026-06-12)
- BUILT — npm run build ✓ Compiled successfully in 6.6s (에러/경고 없음). 마이그 080 미적용 상태에서 통과(item_text는 select-only, insert는 런타임 best-effort + try/catch 방어).
- 변경 파일:
  - src/lib/ai/schema.ts L70~72 — sales_order_items: product_id nullable 표기 + item_text 추가 + 카페24 텍스트 품목 주석(AI sync, CLAUDE.md 규칙).
  - src/app/api/cafe24/orders/route.ts — interface Cafe24OrderForShipping에 order_items[] 필드 추가, DEMO_ORDERS 3건 더미 order_items 추가, live 매핑에서 detailOrder.items → order_items{name,quantity,price,option} 노출(items_summary 병존 유지).
  - src/lib/cafe24-actions.ts — registerCafe24Customers items 타입에 order_items? 추가. customerId 확정 후 cafe24_order_id로 soId 확보 → 멱등 가드(이미 품목 있으면 skip) → product_id=null/item_text/order_option insert. try/catch best-effort(실패해도 고객 등록 성공).
  - src/app/(dashboard)/shipping/page.tsx — Cafe24OrderForShipping interface에 order_items? 추가, handleRegisterCustomers payload에 order_items 포함.
  - src/app/(dashboard)/customers/[id]/page.tsx — sales_order_items select에 item_text 추가, 렌더 폴백 product?.name||item_text||'-', mainItems 폴백, 품목검색 필터에 item_text 포함.

### Locked Decisions (브리프 준수)
- 저장 위치 = sales_order_items 텍스트 확장(B안), product_id=null, item_text=상품명. 가격 없으면 0.
- 캡처 = registerCafe24Customers (신규생성·기존연결 양쪽). 멱등 가드로 재클릭 중복 insert 방지.
- 마이그 080(.sql)는 Arch 소유 — Bob 미작성.

### AMENDMENT Build (2026-06-12) — 환불 경로 회귀 차단 (Must Fix 대응)
- BUILT — npm run build ✓ Compiled successfully (에러/경고 없음).
- 정책(Arch 락): 카페24 ONLINE 주문은 POS·에이전트 환불에서 통째로 제외(sync-only 정책의 귀결). null-safety는 방어선으로 병행 유지.
- 변경 파일:
  - src/lib/return-actions.ts:294 — searchSalesOrdersForRefund에 `.neq('channel', 'ONLINE')`.
  - src/lib/return-actions.ts:338-340 — getSalesOrderForRefund: `data.channel === 'ONLINE'`이면 거부 메시지 반환.
  - src/app/(dashboard)/pos/RefundModal.tsx:150-156 — activeItems `i.product?.id` filter + `product_id: i.product?.id`.
  - src/lib/ai/tools.ts:2901-2907 — 전액환불 map 전 `.filter((i)=>i.product?.id)`.
  - src/lib/ai/tools.ts:2917 — 수량 에러 메시지 `match.product?.name ?? match.item_text ?? '-'`.
  - src/lib/ai/tools.ts:2919-2921 — 부분환불 `match.product?.id` 없으면 에러 반환(NULL 라인 미투입).
- 마이그레이션: 없음(080 그대로, channel은 기존 컬럼).

### Known Gaps
- 카페24 품목코드 → products 매핑(자동) 미구현 — 향후 별도 스텝(브리프 Out of Scope).
- 과거 이미 등록된 카페24 주문 소급 품목 채우기 미포함(브리프 Out of Scope).
- live order_items price: i.product_price 우선, 없으면 payment_amount, 둘 다 없으면 0(브리프 규정). 정확 라인 단가는 카페24 옵션가/할인 미반영 가능 — LTV는 sales_orders.total_amount 헤더 기준이라 영향 없음.
