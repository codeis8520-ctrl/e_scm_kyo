# Architect Brief — processPosCheckout 라운드트립 최적화

## Goal
결제 버튼(`processPosCheckout`, src/lib/actions.ts L2437~L2948)의 순차 DB 라운드트립 ~13–15회를 ~7–8회로 감소. **숫자·재고·포인트·movements·shipment·분개·에러폴백 100% 보존. 동작 변경 0.** 읽기 통합 + 쓰기 배치 + 알림 비차단만.

## 절대 보존 (한 결제라도 틀리면 실패)
총액·VAT·할인·taxableAmount/exemptAmount/vatAmount 계산·pointsEarned/pointsToUse·재고 차감량·inventory_movements 행(개수·reference_type·memo·quantity·branch_id)·point_history 행(개수·balance·type·points)·shipment·반환값 `{ orderNumber, pointsEarned, stockUpdates }`·모든 컬럼부재 폴백 체인. **같은 결제 = 단일 흐름이라 race 무관, 멱등/순서 무관.**

## Build Order

### C. products 단일 조회 (먼저 — B의 입력이 됨)
- L2472 select에 `is_taxable` 추가: `'id, product_type, track_inventory, is_phantom, is_taxable'`.
- **폴백 체인 확장(순서 중요, 더 신생 컬럼부터 떨굼)**: is_phantom 부재 → is_taxable 유지하고 is_phantom만 제거 재시도 / track_inventory 부재 → 그 다음. is_taxable는 가장 오래된 마이그(006)이므로 마지막까지 유지. 단순화 위해: 1차 full → is_phantom 빠지면 `'id, product_type, track_inventory, is_taxable'` → track_inventory 빠지면 `'id, product_type, is_taxable'` → (만약 is_taxable까지 없는 환경이면) `'id, product_type'`. **is_taxable 부재 시 기존 동작(전부 과세=true)으로 폴백 보장.**
- ⓪ 루프에서 `isTaxableByProduct: Map<string, boolean>` 동시 채움: `isTaxableByProduct.set(p.id, p.is_taxable !== false)` (컬럼 부재 시 undefined → !== false → true = 기존 폴백과 동일).
- **L2570–2572 제거**: 별도 products 조회 삭제. L2569~2599 과세 블록은 `isTaxableByProduct` 맵을 그대로 사용 (`isTaxable.get(item.productId) === false` 로직 동일). 단 ⓪에서 products 조회가 에러였을 때를 위해: 기존 `if (!taxErr)` 게이트는 "맵이 채워졌는가"로 대체 — products 조회 자체가 실패(에러)면 맵이 비어 전부 과세=기본값. **결과 동일.**
- Flag: cart의 productId가 ⓪ productIds에 전부 포함됨(둘 다 cart.map). 누락 위험 없음. 단 ⓪는 `if (productIds.length > 0)` 가드 안에서만 맵을 채우므로, cart 비었으면 과세 블록도 `if (cart.length > 0)`로 스킵 — 정합.

### B. 재고 SELECT 배치 (가장 큰 절감)
- 현 구조: decrementStock가 품목(material)당 SELECT(L2817)→UPDATE/INSERT→movements INSERT = 3 라운드트립, Promise.all 병렬이나 키 수만큼.
- **변경**: L2849~L2894 배치 블록 내에서 normalMap/phantomMap **합산 완료 후**(이 dedup 로직 L2855~2878 전부 무변경 — phantom 분해·decimalByMaterial·Math.ceil/round·trackByProduct 스킵 그대로):
  1. 차감 대상 product_id 집합 = `[...normalMap.keys(), ...phantomMap.keys()]` (중복 가능 → `new Set`). **빈 배열이면 전체 스킵.**
  2. **단일 SELECT**: `supabase.from('inventories').select('id, quantity').eq('branch_id', stockBranchId).in('product_id', ids)`. → `Map<product_id, {id, quantity}>` 구성.
  3. 각 키별로 `before = toNum(existing?.quantity)`, `after = before - qty` 계산(decrementStock와 **동일 산술**). `stockUpdates[productId] = after` 기록(반환형 보존).
  4. **UPDATE는 병렬**(Promise.all): 기존 행 있으면 `update({quantity: after}).eq('id', existing.id)`, 없으면 신규 INSERT `{branch_id: stockBranchId, product_id, quantity: after, safety_stock: 0}`. (단일 upsert/RPC는 **금지** — onConflict 제약·safety_stock 덮어쓰기 위험. 병렬 UPDATE/INSERT가 안전.)
  5. **movements는 배열 1회 INSERT**: normalMap 키 → `reference_type:'POS_SALE', memo: movementMemo, quantity: qty`; phantomMap 키 → `reference_type:'PHANTOM_DECOMPOSE', memo: phantomMemo(해당 키의 memo), quantity: qty`. 각 행 `branch_id: stockBranchId, movement_type:'OUT', reference_id: saleOrderId`. **행 개수·필드 = 기존 N건과 동일.**
- **정확성 근거**: decrementStock는 stockBranchId+product_id로 maybeSingle SELECT 후 그 행만 갱신. 배치 SELECT는 같은 stockBranchId, 같은 키 집합. before 값은 결제 시작 시점 스냅샷이며 이 함수 외 동시 차감 없음(단일 결제). after 산술 동일. movements 행은 키별 1행으로 1:1.
- **decrementStock 헬퍼(L2811~2844) 처리**: 인라인 배치로 대체되면 헬퍼 미사용 → 제거 가능. 단 다른 호출처 없는지 Bob이 grep 확인(이 파일 내 `decrementStock(` 사용처가 L2883/2889 둘뿐이면 제거, 아니면 보존).
- Flag: UPDATE 실패는 기존도 무처리(에러 throw 안 함, after만 반환)였음 — **에러 핸들링도 동일하게**(조용히 진행, 반환값만). movements INSERT 에러도 기존과 동일(무체크). 동작 보존 위해 **새 에러 게이트 추가 금지.**

### A. 알림 비차단 (⑥ L2923~L2945)
- 현재: customers SELECT(L2925)+branches SELECT(L2930)을 **await**한 뒤 fireNotificationTrigger(이미 .catch fire-and-forget). 앞 두 SELECT가 함수 반환(return)을 막음.
- **변경**: ⑥ 전체 블록을 함수 `return` **이전에 두되 await하지 않는** 비동기로 분리. 구체 방법:
  - ⑥ 블록을 즉시실행 async fn으로 감싸 `.catch(()=>{})` — `void (async () => { ...customers/branches 조회 + fireNotificationTrigger... })();` 형태. **await 제거**가 핵심. 그 다음 줄에서 바로 `return { orderNumber, pointsEarned, stockUpdates }`.
  - **주의(Next.js 서버액션 백그라운드 보장)**: 서버액션은 응답 후 미완 promise가 중단될 수 있음. 현재도 fireNotificationTrigger는 fire-and-forget이라 **이미 best-effort 알림**(보장 안 됨)이 설계 전제. 따라서 customers/branches 조회를 같은 fire-and-forget 안으로 넣어도 **신뢰성 등급 동일**(알림은 원래 보장 대상 아님). → 동작 보존 OK. 만약 Bob이 "조회는 await 유지, 알림만 분리"가 더 안전하다 판단하면 그 대안도 허용(이 경우 절감은 0이나 회귀 위험 0). **PO 결정: 알림 신뢰성을 낮추지 않는 선에서만. customers/phone 등이 payload에 없으므로 조회는 필요 — fire-and-forget 내부로 이동이 1순위.**
- Flag: br는 `branchId`로 조회(판매지점). B/D의 branches 조회와 **목적이 다름**(아래 D 참고) — 합칠 때 id 집합 주의.

### D. point_history 배치 + branches 중복 + resolvePointRate
- **D1 point_history 2→1**: L2902~2920. use+earn 두 insert(L2904/2909) → **배열 1회 insert**. balance는 JS에서 이미 계산(afterUse, afterUse+pointsEarned) — DB 의존 없음. 행 순서·type·points·balance·description 전부 동일하게 배열 `[useRow, earnRow]`. else 분기(earn만)는 1행 그대로. **maybeSingle 잔액 조회(L2898)는 유지**(앞단계 의존 없음).
- **D2 branches 중복 제거**: 현재 branches 조회 2곳 — L2805(차감메모, `[branchId, stockBranchId]`, `stockBranchId !== branchId`일 때만) + L2930(알림, `branchId`만). **합치기**: L2805 블록에서 이미 조회한 결과에 branchId 행이 포함되므로, 알림용 branchName을 그 결과에서 재사용. 단 L2805는 조건부(출고처 다를 때만) 실행 → 합치려면: 알림 블록(A)이 fire-and-forget로 분리되므로 **branchName이 응답경로 밖**. 따라서 **무리한 통합 금지** — A 분리로 L2930이 이미 비차단이면 D2 절감 효과 미미. **D2는 보류(hold)**: A 적용 후 L2930은 응답을 안 막으므로 중복 조회 1회는 백그라운드 비용일 뿐. 회귀 위험 > 이득. **건드리지 않음.**
- **D3 resolvePointRate(L2223~2257) 2→1**: matrix 쿼리(L2245)가 1차 grade 쿼리(L2231)의 `gradeRow.id`에 **데이터 의존** → 병합 불가(순차 필수). **보류(hold).** 위험 대비 이득 없음.
- → **D는 D1만 적용. D2/D3 보류.**

## Build 순서 (의존)
1. C (products 통합) — B가 phantom/track 맵에 의존하나 그건 기존, is_taxable만 추가라 독립.
2. B (재고 배치) — 가장 큰 절감, C와 무관하게 가능.
3. A (알림 비차단).
4. D1 (point_history 배치).
순서 무관하나 위 순으로. 각 항목 독립 — 하나 실패해도 나머지 유효.

## Out of Scope (→ BUILD-LOG Known Gaps if surfaces)
- D2 branches 중복 통합 / D3 resolvePointRate 병합 (보류 — 의존성·회귀위험).
- inventories upsert/RPC 전환 (safety_stock 위험).
- 분개(journal)·shipment·sales_order_items 배치(이미 ③ L2783 배열 1회)·결제기록 — 무변경.
- 음수재고 정책·BOM·decimal 로직 — 무변경.

## Acceptance
- `npm run build` 0 error.
- **라운드트립 before/after 표**(아래) 제시.
- 코드 리뷰로 산술 동치 확인: 동일 cart 입력 → stockUpdates·movements행·point_history행·taxableAmount/vatAmount **비트 동일**.
- 폴백 체인(products 4단·sales_orders·shipments·items) 전부 유지.

## 라운드트립 표 (대략, customer+1품목+택배 기준)
| 단계 | Before | After |
|---|---|---|
| ⓪ products(type/track/phantom) | 1 | 1 |
| 과세 products(is_taxable) | 1 | 0 (C: ⓪에 흡수) |
| point rate (resolvePointRate) | 2 | 2 (D3 보류) |
| phantom BOM | 0~1 | 동일 |
| decimal material | 0~1 | 동일 |
| sales_orders insert | 1 | 1 |
| payments insert | 1 | 1 |
| shipments insert | 0~1 | 동일 |
| items insert | 1 | 1 |
| 차감 branches(메모) | 0~1 | 동일 |
| **재고 SELECT** | N키 | **1** (B) |
| **재고 UPDATE/INSERT** | N키(병렬) | N키(병렬, 변동無) |
| **movements INSERT** | N키 | **1** (B) |
| point_history select | 0~1 | 동일 |
| **point_history insert** | 1~2 | **1** (D1) |
| ⑥ customers+branches | 2 (응답차단) | 2 (**비차단**, A) |
| **응답 경로 합계** | **~13–15** | **~7–8** |
