# BUILD-LOG — 재고 소모(사용유형) · Step 2: 다건 재고 소모 차감 화면

## Step 2 — recordStockUsage + StockUsageModal (BUILD DONE · 리뷰 대기)
시작: 2026-06-12 · 빌드완료: 2026-06-12

### Locked Decisions
- recordStockUsage 는 **객체 인자**(FormData 아님 — 다건). `{ branch_id, usage_type_id, memo?, items[] }`.
- 2-pass: pass1 = branch/usage/items/quantity(정수>=1) 전수검증 + RAW/SUB 본사 제한 라인별 전수검사 → 하나라도 실패 시 처리 시작 전 거부. pass2 = 라인별 실제 차감.
- RAW/SUB 제한: HQ id 1회 조회(is_headquarters=true). branchId!=HQ 일 때만 라인별 product_type 조회(불필요 쿼리 절약). RAW/SUB 면 `'<품명>' 원자재·부자재는 본사에서만 소모 처리할 수 있습니다.` 거부. 폴백 try/catch(컬럼 부재 시 제한 생략).
- 행 없을 때 insert: `quantity = -item.quantity`, safety_stock=0 (음수 재고 행 생성 — 소모는 OUT). adjustInventory 의 abs 입고 분기 **복붙 금지** 준수.
- 행 있을 때: `newQuantity = (current.quantity||0) - quantity` 음수 허용 update.
- inventory_movements insert: movement_type='OUT', reference_type='USAGE', usage_type_id, memo||null.
- 모달은 자체 fetch 없음 — page 가 branches/inventories/usageTypes 주입. 현재고는 inventories(branch_id===선택지점 && product_id) 매칭, 지점 변경 시 재계산.
- 현재고 초과 경고는 비차단(배지/빨강 보더), 처리 버튼 유지(음수 정책).
- 지점고정 사용자: defaultBranchId 주입 → 지점 select disabled. branches 도 page 에서 자기 지점만 필터 전달.
- `(supabase as any)` 방어 패턴(079 미적용 빌드 통과).

### Files Changed
- `src/lib/actions.ts` — adjustInventory 바로 아래 recordStockUsage 추가.
- `src/app/(dashboard)/inventory/StockUsageModal.tsx` — 신규 모달(TransferModal 동형, 자체 fetch 없음).
- `src/app/(dashboard)/inventory/page.tsx` — import(StockUsageModal·getInventoryUsageTypes), state(showUsageModal·usageTypes), 첫 useEffect 에서 usageTypes active 로드, '+ 소모 차감' 헤더 버튼, 모달 mount.
- `src/lib/ai/schema.ts` — BUSINESS_RULES 에 recordStockUsage 1줄 추가(DB_SCHEMA 무수정).

### AI Sync
- schema.ts DB_SCHEMA: **무수정**(Step 1 에서 inventory_usage_types·usage_type_id·reference_type='USAGE' 전부 반영됨).
- BUSINESS_RULES: 소모 차감 워크플로우 1줄 추가.
- tools.ts WRITE_TOOLS: 미추가(lock — 에이전트 자동 소모 비즈니스 요구 없음. 읽기는 analyze_data 충분).

### Build
- `npm run build` ✓ Compiled successfully, 에러·경고 없음.

### Known Gaps (Out of Scope)
- 비트랜잭션 부분실패 자동 롤백 없음 — pass2 차감 도중 supabase 에러 시 앞선 라인은 이미 반영(롤백 불가). 기존 코드(adjustInventory 등) 동일 한계. 사용자 거부는 전부 pass1 에서 발생하므로 실무상 부분차감 거의 없음.
- 모달 품목 검색 후보는 page 의 `inventories`(검색조건 매칭분)에 한정 — 재고 페이지에서 아무 검색도 안 한 상태면 후보 비어있을 수 있음(page 의 검색 결과를 그대로 주입하는 브리프 설계). 전체 제품 독립 검색은 스코프 밖.
- 소모 이력 보고/필터/조회 화면, CSV 다건 업로드, 사용유형별 통계 대시보드 — 스코프 밖.

### Deploy
- 미배포.

---

# BUILD-LOG — 재고 소모(사용유형) · Step 1: 코드 테이블 + 코드 관리 UI

## Step 1 — 사용유형 코드 테이블 + 관리 UI (REVIEW FIX 적용 · 배포 대기)
시작: 2026-06-12 · 빌드완료: 2026-06-12

### Locked Decisions
- 마이그 079(Arch 작성분) 사용. Bob 은 마이그 파일 신규/수정 안 함.
- CRUD 4종은 createChannel/updateChannel/deleteChannel(actions.ts L1403~1471) 패턴 미러링. color 필드 제외.
- code 정규화: createChannel 방식 재사용, VARCHAR(30) → slice(0,30). 한글이면 원문. is_system=false 고정.
- deleteInventoryUsageType: ① is_system=true 거부('시스템 기본 유형은 삭제할 수 없습니다. 비활성만 가능합니다.') ② inventory_movements.usage_type_id 참조 존재 시 거부('소모 이력이 있어 삭제할 수 없습니다. 비활성 처리하세요.').
- UI: system-codes 페이지에 '사용유형' 탭 신규(채널 탭 동형). 시스템 행은 삭제 버튼 미노출(수정 모달의 활성 토글로만 비활성 가능). 시스템 배지 표기.
- 마이그 미적용 환경 대비: 모든 SELECT/CRUD `(supabase as any)` 방어 패턴(기존 코드 동일).

### Files Changed
- `src/lib/actions.ts` — Inventory Usage Types 섹션(4 액션) 추가.
- `src/lib/ai/schema.ts` — inventory_movements 라인에 usage_type_id + reference_type 'USAGE' 주석, inventory_usage_types 신규 라인.
- `src/app/(dashboard)/system-codes/page.tsx` — import 4액션, InventoryUsageType 인터페이스, 탭/state/fetchData/삭제핸들러/렌더섹션/모달 마운트/UsageTypeModal 추가.

### AI Sync
- schema.ts DB_SCHEMA: 신규 테이블 + usage_type_id 컬럼 + reference_type='USAGE' 반영 완료.
- tools.ts WRITE_TOOLS: 이 단계 미추가(Step 2 consume 액션 생긴 뒤 검토 — 브리프 지시).

### Build
- `npm run build` ✓ Compiled successfully in 6.3s, 에러·경고 없음.

### Review Fix (2026-06-12)
- Richard Must Fix: 마이그 079 RLS 정책만 있고 GRANT 누락 → anon 롤 전면 접근거부.
- 수정: 079 L81 에 `GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_usage_types TO anon, authenticated;` 추가(064 패턴 동일). 앱 코드 무변경.

### Known Gaps (Out of Scope)
- 다건 소모 차감 화면 + consumeInventory 서버액션 (Step 2).
- inventory_movements.usage_type_id 쓰기/읽기 (Step 2).
- 재고 페이지 변경, 소모 이력 보고/필터 화면, tools.ts WRITE_TOOLS 소모 도구.

---

# BUILD-LOG — 판매현황 지점 매출 비교 서브뷰

## Step 1 — 지점비교 서브뷰 (BUILD DONE · 리뷰 대기)
시작: 2026-06-12 · 빌드완료: 2026-06-12

### Locked Decisions
- 집계 방식: **(B) 클라이언트 집계** + 1000행 캡 우회 페이지네이션. RPC/마이그 없음 → AI Sync(schema.ts/tools.ts) 해당 없음.
- 매출 정의: `total_amount` 합계, status ∈ {CANCELLED, REFUNDED, PARTIALLY_REFUNDED} 제외. discount 미반영(목록 일별집계 L389~407과 동일 기준).
- 날짜 경계: KST(kstDayStart/kstDayEnd gte·lte, 그룹핑 fmtDateKST).
- 권한: `!isBranchUser`(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE)만 토글 노출. 지점직원 숨김.
- 다수선택 state(`compareBranchIds`)는 단일 `branchFilter`와 별개. 기본 전체선택.

### Files Changed
- `src/app/(dashboard)/pos/SalesListTab.tsx` (유일 변경 대상)
  - state: `subView`, `compareBranchIds`, `compareRows`, `compareLoading`
  - useEffect: branches 로드 시 compareBranchIds 전체선택 초기화
  - `loadCompare`: 경량 select(branch_id, ordered_at, status, total_amount) + PAGE=1000 페이지네이션 + KST gte/lte + .in(branch_id) + status 제외(.not in). subView==='compare'일 때만 호출.
  - `compareMatrix`(useMemo): 날짜행×지점열 + 행총계/열총계/총계. fmtDateKST 그룹핑.
  - UI: 토글 세그먼트(!isBranchUser), 지점 체크박스(전체/해제), 매트릭스 표(table only). 목록 본문은 subView==='list' 게이트.

### Key Decisions
- 조회 버튼: subView에 따라 loadCompare/loadOrders 분기.
- status 제외는 쿼리단(.not status in). discount 미반영.
- schema.ts/tools.ts 무수정(테이블/컬럼/enum/액션 변경 0 → AI Sync 해당없음).

### Build
- `npm run build` ✓ Compiled successfully (5.8s), 에러·경고 없음.

### Known Gaps (Out of Scope)
- 비교뷰 차트
- 비교뷰 CSV 내보내기
- 순매출(discount/환불 반영) 컬럼
- 결제수단·채널별 분해

### Deploy
- 미배포.
