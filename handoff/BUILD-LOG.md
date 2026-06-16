# BUILD-LOG

## Sprint B Step 1 — 카페24 옵션조합→내부제품 매핑 데이터층 (빌드 완료 · 리뷰 대기)
시작: 2026-06-16

### Build Status — npm run build ✓ Compiled successfully in 6.9s (에러/경고 0)

### 변경 파일 (5)
- **src/lib/cafe24/types.ts**: `normalizeOptionValue(raw)` export 추가(단일 출처). safeDecodeKey/isNoSelectionValue 내부 자급(route.ts 비export 로직 동작 복제). 규칙(LOCKED): null/non-string→'', '&' split, eq없으면 토큰 전체를 value, '선택안함'(공백제거)·빈값 페어 제거, key localeCompare 사전순 정렬, `key=value`(key없으면 value) `&` join.
- **src/app/api/cafe24/orders/route.ts**:
  - import에 normalizeOptionValue 추가.
  - 주문 페치를 2-pass로 분리: 1차 `fetched`(detail/receiver/items만), 그 사이 cafe24_product_map 1회 + products 1회 조회(N+1 없음), 2차 `fetched.map`로 주문 객체 빌드.
  - 매핑 Map: `mapKey(code, normalizedOptValue)`→product_id, product_id→name. **try/catch + error 무시 → 테이블 미적용 시 빈 Map 폴백(크래시 금지)**.
  - itemsSummary: 매핑 name 있으면 `${mapped} x${qty}`, 없으면 현행 extractItemOptions 경로.
  - order_items[]에 product_code/option_value(정규화키)/mapped_name(string|null) 추가. interface(Cafe24OrderForShipping) 동기 확장. DEMO_ORDERS 3건 order_items도 신규 필드 채움(타입 정합).
- **src/app/(dashboard)/shipping/page.tsx** downloadCjExcel L431: F열(품목명) 두번째 `''` → `s.items_summary || ''` 복원. G열 RTC·header·13컬럼 불변.
- **src/lib/cafe24-actions.ts**: normalizeOptionValue import. 신규 서버액션 3종 — createCafe24ProductMap(requireSession + role 화이트리스트 [SUPER_ADMIN,HQ_OPERATOR], **저장 직전 normalizeOptionValue 재적용 LOCKED**, upsert onConflict 'cafe24_product_code,option_value'), listCafe24ProductMaps(requireSession, products(name) join), deleteCafe24ProductMap(동 role, 삭제키도 정규화). 셋 다 createClient() as any + try/catch, {success}|{error} 반환.
- **src/lib/ai/schema.ts**: DB_SCHEMA cafe24_product_map 테이블 추가(컬럼+UNIQUE 주석). BUSINESS_RULES [자사몰] 섹션 1줄 추가.

### 결정 사항
- 키 단일 출처: route(조회)·actions(저장) 모두 types.ts의 normalizeOptionValue import. byte 동일 보장.
- session.role 검증: session.ts SessionUser.role(string) 확인, actions.ts adjustInventory 선례 그대로.
- tools.ts 무변경: 매핑은 UI/송장 표현 전용, 에이전트 호출 불요(브리프 6 명시).

### Known Gaps (Out of Scope — 미수정)
- 인라인 매핑 UI = Step 2(다음 브리프). 이번엔 데이터층/적용/액션/export만.
- 기존 저장된 shipment.items_summary 소급 갱신 안 함 — 주문 재조회·재추가해야 매핑 반영.
- product_code 빈 카페24 품목: 키 ('' + opt)로 동작하나 실질 매핑 불가, fallback 유지.
- 마이그082는 Arch 소유(미작성). 코드는 082 미적용 상태에서 build+런타임 통과(빈 Map 폴백).

---

# BUILD-LOG — Sprint A: 송장 보내는분=구매자명 + 품목명 제거

## Sprint A — 1 step (빌드 완료 · 리뷰 대기)
시작: 2026-06-16

### Build Status (2026-06-16) — npm run build ✓ Compiled successfully in 6.1s (에러/경고 0)
- 단일 파일: src/app/(dashboard)/shipping/page.tsx.
- **A1** `handleAddSelectedOrders` createShipment 호출: 보내는분 성명/전화 = 구매자(주문자).
  - `sender_name: order.orderer_name || ''`, `sender_phone: order.orderer_phone || ''`.
  - 주소 인자(zipcode/address/address_detail) = undefined 유지 — export 시 resolveSenderForRow가 출고지점 발송지로 채움.
  - dead code 정리: `const sender = cafe24DefaultSender;` 제거. cafe24DefaultSender가 더 이상 read 안 됨 → useState 선언(L147~152) 및 setCafe24DefaultSender 호출(L721) 제거. data.default_sender는 미사용(다른 소비자 없음, grep 확인).
- **A2** `downloadCjExcel` rows: F(품목명) `s.items_summary || ''` → `''`. G(내품명) `KX-...` RTC 코드 그대로 유지. header 배열·컬럼 13개·순서 무변경.
- **검증** guardSenders(L388~): resolveSenderForRow가 sender 이름/전화 = `s.sender_name||지점명폴백`, 주소=출고지점 → 통과 정상. 별도 수정 없음.

### Known Gaps (Out of Scope — 미수정)
- 기존(이미 빈 sender로 생성된) 카페24 shipment 자동 폴백 안 함. [잠근 결정] shipments에 buyer/orderer 컬럼 없음(마이그 012), export 시점 구매자명 복구 소스 없음. 운영 워크어라운드: 해당 행 삭제 후 카페24 주문 탭에서 재추가하면 구매자명 채워짐.
- 품목명 짧은 이름 대체 = Sprint B(옵션조합→내부제품 매핑). 이번엔 비우기만.
- exportSelectedToExcel '품목' 컬럼·배송 리스트 화면 items_summary 노출 = 유지. 이번 A는 CJ export 출력만.

---

## Feature: 판매현황 목록 수령일자별 그룹 토글 — 1 step (브리프 작성)

### Locked Decisions (Project Owner 확정)
- 정렬 토글: 기본 '주문일순'(현행 flat) / '수령일자별'(그룹). 프론트 전용, DB/쿼리/필터 무변경.
- 수령일자별: receipt_date 그룹, 날짜 오름차순(가까운 날 먼저), 미지정 그룹 맨 끝.
- 그룹 내 정렬: 방문(PICKUP_PLANNED) → 택배(PARCEL_PLANNED) → 퀵(QUICK_PLANNED) → 수령완료(RECEIVED) → 기타.
- 그룹 헤더에 날짜 + 수령방식별 건수 요약 표시(예: 2026-06-20 · 방문 3 · 택배 5 · 퀵 1).
- 대상 파일: src/app/(dashboard)/pos/SalesListTab.tsx 단일. colSpan=13.

### Build Status (2026-06-16) — 빌드 완료 · 리뷰 대기
- BUILT — npm run build ✓ Compiled successfully (에러/경고 0).
- 단일 파일: src/app/(dashboard)/pos/SalesListTab.tsx.
- colSpan 실측 확인 = **13** (목록 표 헤더 th 13개: 일자·수령·매출처·출고처·담당자·고객/연락처·품목·수량·합계·결제/승인·받는분·주소·상담·옵션·상태). 기존 로딩/빈행 colSpan=13과 일치.
- 변경 내용:
  - listSort state ('order'|'receipt', 기본 'order') subView 인근 추가.
  - receiptGroups useMemo (deps [filtered]): receipt_date 버킷 → 키 ASC 정렬(미지정 맨끝) → 그룹 내 status rank 정렬(PICKUP0<PARCEL1<QUICK2<RECEIVED3<기타4, null=4, .slice().sort()로 안정정렬) → counts{pickup,parcel,quick,received,other}.
  - 테이블 카드 헤더(L903 flex)에 세그먼트 토글 2개 추가(L603 패턴 축소 복제). subView==='list' 래퍼(L865) 내부라 list에서만 노출.
  - 기존 per-order <tr> 본체를 renderOrderRow(o) 헬퍼로 **바이트 그대로 추출**(셀·onClick·뱃지 무변경). order모드=filtered.map(renderOrderRow) 픽셀동일. receipt모드=receiptGroups.flatMap([헤더tr(colSpan13, 날짜+방식별건수), ...orders.map(renderOrderRow)]).
  - loading / filtered.length===0 분기 원본 유지. 빈목록→receiptGroups=[]→빈출력. 미지정만→'수령일 미지정' 그룹 1개.

### Known Gaps (Out of Scope — 미수정)
- 필터 기간은 **주문일 기준**. 주문일 범위가 좁으면 그 안에 없는 미래 수령건은 '수령일자별'에도 안 보임. 수령일 기반 분석을 원하면 사용자가 조회 기간을 넓혀야 함(사용자 안내 사항, 이번 스코프 아님).
- '미지정' 그룹 내부는 status 우선순위만 적용(주문일 2차 정렬 없음).

# BUILD-LOG — Feature D: 재고 조정 권한 정리 (입고/출고 제거 · 본사만 조정)

## Feature D — 1 step (빌드 완료 · 리뷰 대기)
시작: 2026-06-16

### Build Status (2026-06-16)
- BUILT — npm run build ✓ Compiled successfully in 6.8s (에러/경고 0).
- 마이그/DB 변경 없음.
- 변경 파일:
  - src/lib/actions.ts — adjustInventory 맨 앞 requireSession + role 화이트리스트(SUPER_ADMIN/HQ_OPERATOR) 서버 가드 추가. 기존 RAW/SUB 본사 제한·이하 로직 무변경.
  - src/app/(dashboard)/inventory/InventoryModal.tsx — movement_type 기본값 IN→ADJUST, IN/OUT/ADJUST 3버튼 토글 삭제 후 정적 안내 1줄, 수량 라벨 '변경 후 수량 *' 고정, memo placeholder '조정 사유...'.
  - src/app/(dashboard)/inventory/page.tsx — isHQUser 추가, 헤더 버튼 '+ 입출고'→'+ 재고 조정' 본사만 노출, 그리드 셀 adjustBlocked(=materialBlocked||!isHQUser) 진입 차단·title·↓배지, 플랫 '입출고'→'조정' 본사만 노출, 하단 안내 문구 정리.
  - src/lib/ai/schema.ts — BUSINESS_RULES [재고 처리 판단]에 본사 전용 조정 정책 1줄 추가.

### Locked Decisions (Arch brief 그대로)
- IN/OUT 전면 삭제. ADJUST 단일 고정. movement_type 항상 'ADJUST'.
- 조정 권한 = ['SUPER_ADMIN','HQ_OPERATOR']. 그 외 조정 불가, 조회는 유지.
- AI 에이전트 adjust_inventory(execAdjustInventory) 무관 — tools.ts 무변경.
- RAW/SUB→본사 제한 기존 로직 유지.

### Known Gaps (Out of Scope — 미수정)
- bulk_adjust_inventory / 에이전트 도구 description 문구 — 이번 단계 아님.
- inventory_movements 과거 'IN'/'OUT' 데이터 — 그대로.
- TransferModal/TransferBatchPanel(창고이동) — 변경 없음.

---

# BUILD-LOG — Feature C: 지점별 매출 통합 조회 (legacy+sales, day/month/year)

## Feature C — 1 step (빌드 완료 · 리뷰 대기)
시작: 2026-06-16

### Build Status (2026-06-16)
- BUILT — npm run build ✓ Compiled successfully in 8.2s (에러/경고 없음).
- 마이그 081 (branch_sales_summary RPC)은 Arch 소유 — Bob 미작성. **현재 미적용** 상태에서 빌드/런 정상 (RPC 에러 시 compareError 안내 + 빈 매트릭스, 크래시 없음).
- 마이그 081 작성 완료 (2026-06-16, Arch) — `supabase/migrations/081_branch_sales_summary.sql`. **Supabase 미적용** 상태. 적용 전까지 RPC 에러→빈 매트릭스 폴백 유지. 배포 게이트 시 Supabase 실행 필수.
  - 검증 사항: legacy_orders.ordered_at=DATE(KST 일자, 변환 없음) / sales_orders.ordered_at=timestamptz(AT TIME ZONE 'Asia/Seoul'). 컷오프 2026-05-19. status 제외=CANCELLED,REFUNDED,PARTIALLY_REFUNDED(마이그 019 확장 확인). period_date=date_trunc(grain,…)::date. grain 화이트리스트 가드. SECURITY DEFINER + GRANT anon,authenticated.
- 변경 파일:
  - src/app/(dashboard)/pos/SalesListTab.tsx — compare 서브뷰 전면 교체 (state·loadCompare·matrix·UI·render).
  - src/lib/ai/schema.ts — BUSINESS_RULES 에 [지점별 매출(통합 조회)] 블록 추가.

### Review Fix (2026-06-16, Arch) — 컷오프 경계 off-by-9h 누락 (Must Fix)
- 마이그 081 라인 63 `so.ordered_at >= cutoff::timestamptz` 수정.
  `cutoff`=DATE 2026-05-19, `::timestamptz` 캐스트가 UTC 자정(=KST 09:00)으로 해석 → legacy(`< cutoff` KST일자)와 sales(`>= cutoff::timestamptz`) 사이 KST 2026-05-19 00:00~09:00 매출 9시간치 누락(legacy·sales 양쪽 다 미포함).
- 수정: `WHERE (so.ordered_at AT TIME ZONE 'Asia/Seoul')::date >= cutoff` 로 교체. legacy `< cutoff` / sales `>= cutoff` 가 동일 KST 캘린더 일자 경계에서 맞물림 → 누락·중복 모두 제거. (라인 65 BETWEEN 표현식과 동일 표현식 재사용.)
- 헤더 주석(라인 9~)도 KST 캘린더 경계로 갱신. legacy 측 `lo.ordered_at < cutoff`(DATE) 무변경(원래 정확). CREATE OR REPLACE 멱등.
- npm 빌드 영향 없음(.sql 마이그, Supabase 미적용 유지). 배포 게이트 시 적용.

### Locked Decisions (Arch brief 그대로 구현)
- 컷오프 2026-05-19 · legacy 상태필터 없음 · sales status NOT IN(CANCELLED/REFUNDED/PARTIALLY_REFUNDED) — 전부 RPC 내부(Arch). 프론트는 RPC 결과만 매핑.
- RPC 시그니처 = (p_from, p_to, p_grain) 만. 지점 선택은 클라이언트(compareMatrix)에서 필터. 미매칭(branch_id NULL) 열은 compareBranchIds 토글과 무관하게 항상 합산, NULL 행 존재 시에만 열 노출.
- day grain 366일 초과 → 조회 차단 + 안내(compareError). month/year 무제한.
- compare 진입 시 기본기간 올해 1/1~오늘 + grain='month' 1회 세팅(compareInit 가드, 사용자 변경 덮지 않음). list 서브뷰 기본 미변경.

### Known Gaps (Out of Scope — 미수정)
- legacy 취소/환불 미반영(과거 신뢰가능 플래그 없음) — 의도된 가정.
- compare CSV 내보내기 없음(list 만 보유).
- 지점선택 RPC 인자화 최적화 안 함(클라 필터 유지).

---

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

---

## Feature F — 지점 재고 이동 둘러보기·체크박스 다중선택 · 1 step (빌드 완료 · 리뷰 대기)
시작: 2026-06-13

### Build Status — BUILT
- npm run build ✓ Compiled successfully in 6.6s, 에러/경고 0.
- 변경 파일: src/app/(dashboard)/inventory/TransferBatchPanel.tsx (단일 파일).
  - 제거: `candidates` 드롭다운 memo(검색어 트리거·이미담긴품목 제외·slice(20)).
  - 추가: `browseAll` memo(출발지 재고>0 dedup, name 한글 localeCompare 정렬), `browseFiltered` memo(search 부분일치 필터), `browseList`=slice(0,200), `overCap` 플래그.
  - `addRow` 에서 `setSearch('')` 제거(토글 시 필터 유지). 토글 핸들러 `toggleProduct`(checked=rows 파생 → removeRow / addRow), `selectAllFiltered`(필터 미담김 전부 qty:1 추가), `deselectAllFiltered`(보이는 product_id 만 제거).
  - UI: 드롭다운 → max-h-72 스크롤 체크박스 목록. 각 행 `<label>`+checkbox+상품명/코드+현재고(stockOf). 헤더 우측 전체선택/해제. 200초과 안내 문구. 미선택/로딩/재고없음/필터무결과 인라인 힌트.

### Locked Decisions (브리프 준수)
- 체크 단일 출처 = rows: `checked = rows.some(r=>r.product_id===pid)`. 별도 selection state 없음 → ✕삭제 시 자동 언체크.
- 전체선택/해제 = 현재 필터된 browseList 기준. 전체해제는 visible product_id 만 제거(필터 밖 담긴 품목 보존).
- search = 목록 필터(이름/코드). 드롭다운 트리거 의미 폐기. submit 성공·출발지 변경 시 search 초기화는 기존대로 유지.
- 레이아웃 = 상하 단일컬럼(출발→도착+메모 → 둘러보기 → 선택 rows → 일괄 이동). rows UI·가드(sameBranch/hasOver/hasInvalidQty/빈행/submitDisabled)·handleFromChange 리셋·stale 가드 무변경.
- 서버/DB/마이그/schema.ts/tools.ts 변경 없음. getInventory·transferInventoryBatch 인자 무변경.

### Known Gaps
- 없음(Out of Scope 항목 표면화 없음: 가상화/카테고리필터/수량일괄/즐겨찾기·서버페이지네이션 모두 미채택대로 미구현).

---
## Step: 직원 삭제 스마트 삭제 + 비활성 토글/재활성 (빌드 완료 · 리뷰 대기 — 2026-06-16)
- Root cause: deleteUser가 supabase.auth.admin.deleteUser 선호출 → 커스텀 bcrypt 인증이라 실패+early return → users DELETE 미실행.
- Locked: RBAC = SUPER_ADMIN/HQ_OPERATOR (adjustInventory 패턴). 가드 = 본인 불가 + 마지막 활성 SUPER_ADMIN 불가.
- Locked: 하드 DELETE → 23503 → is_active=false 폴백. soft 시 session_tokens 삭제(강제 로그아웃). 반환 {deleted}|{deactivated}|{error}.
- Locked: reactivateUser 전용 액션 신설. UI render-side 필터 + '비활성 포함 보기' 토글, getUsers 시그니처 불변.
- 확인됨: session_tokens.user_id = ON DELETE CASCADE, audit_logs.user_id = ON DELETE SET NULL → 둘 다 삭제 차단 안 함. 23503은 sales_orders.ordered_by 등 RESTRICT 테이블에서 발생.
- DB 마이그 없음(is_active 기존). 에이전트 user 관리 도구 없음 → schema.ts/tools.ts 동기화 불필요.
### Build Status (2026-06-16) — BUILT
- npm run build ✓ Compiled successfully in 6.3s, 에러/경고 0.
- 변경 파일:
  - src/lib/actions.ts L1914-1972 — deleteUser 재작성(RBAC+본인가드+마지막SUPER_ADMIN가드+하드DELETE→23503폴백→session_tokens정리). L1974-1991 — reactivateUser 신규.
  - src/app/(dashboard)/system-codes/page.tsx — import(reactivateUser), showInactiveUsers state, handleDeleteUser 분기메시지 재작성+handleReactivateUser 신규, staff 탭 '비활성 포함 보기' 토글, render-side 필터+비활성 opacity-50+재활성 버튼 분기.
- DB 마이그/schema.ts/tools.ts 무변경(확인됨).

### Build Decisions
- 23503 방어: error.code==='23503' OR error.message.includes('violates foreign key') — PostgREST 코드 누락 대비 이중 방어.
- target select에 is_active 포함(컨텍스트용), 마지막 SUPER_ADMIN 판정은 active count 쿼리가 권위 소스.

### Known Gaps
- createUser: auth.signUp + SHA256 사용(bcrypt 아님) — 기존 불일치, 이번 step 미수정.

### 마이그레이션 082 작성 완료 (2026-06-16, Arch)
- **supabase/migrations/082_cafe24_product_map.sql** 작성됨 (위 L29 "미작성" 해소).
- FK 타깃 검증: products(id) = UUID PRIMARY KEY (schema.sql L70-71) → 정합.
- 064/079 패턴 준수: RLS ENABLE + FOR ALL TO anon,authenticated USING/CHECK(true) + GRANT SELECT,INSERT,UPDATE,DELETE TO anon,authenticated (LOAD-BEARING, 079 Must Fix 재발 방지).
- 멱등: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS 가드.
- option_value NOT NULL DEFAULT '' — UNIQUE(cafe24_product_code, option_value) 가 조회 인덱스 겸함, 별도 인덱스 없음.
- actions.ts upsert onConflict 'cafe24_product_code,option_value' 와 UNIQUE 제약 일치 확인.
- ⚠️ Supabase 적용은 Arch가 배포 게이트에서 직접 실행 (DB 마이그=Arch 소유).
