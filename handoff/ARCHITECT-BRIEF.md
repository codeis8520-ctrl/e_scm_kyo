# Architect Brief — 재고 소모(사용유형) · Step 2: 다건 재고 소모 차감 화면

## Goal
지점 + 사용유형을 고른 뒤 여러 품목을 리스트업해 한 번에 OUT 차감(소모)할 수 있게 된다. 판매 아님. inventory_movements 에 reference_type='USAGE' + usage_type_id 로 일괄 기록된다. (마이그 추가 없음 — 079 가 스키마 전부 커버. 확인 완료.)

## 마이그/스키마 (확정 — 변경 금지)
- 신규 마이그 없음. 079(inventory_usage_types + inventory_movements.usage_type_id)로 충분. Bob 은 .sql 만들지 말 것.
- schema.ts 의 DB_SCHEMA 는 Step 1 에서 usage_type_id·USAGE·inventory_usage_types 다 반영됨 → DB_SCHEMA 무수정(BUSINESS_RULES 1줄만 추가, 아래 AI Sync 참조).

## Build Order

### 1) 서버액션 recordStockUsage — src/lib/actions.ts (adjustInventory L1005 바로 아래 새 섹션)
시그니처: recordStockUsage(input: { branch_id: string; usage_type_id: string; memo?: string; items: { product_id: string; quantity: number }[] })
(FormData 아님 — 다건이라 객체 인자. 'use server' 파일 내 직접 export.)
- 검증(전체 거부, 처리 전): branch_id/usage_type_id 필수, items 비어있으면 { error: '소모 품목을 1개 이상 추가하세요.' }. 각 quantity 정수 >=1 아니면 거부.
- RAW/SUB 본사 제한 — adjustInventory L1016~1031 패턴 그대로 재사용(일관성 lock, 새 정책 아님):
  - HQ id 1회 조회(branches.is_headquarters=true). 폴백 동일(컬럼 부재 시 제한 생략, try/catch).
  - 라인별로 product_type 확인. RAW/SUB 인데 branch_id != HQ 면 그 라인을 거부하고 처리 시작 전 { error: "'<품목명/product_id>' 원자재·부자재는 본사에서만 소모 처리할 수 있습니다." } 반환.
- 처리(라인 루프, 비트랜잭션 — 기존 코드 일관): 각 item 마다
  - inventories select(quantity) → newQuantity = (current?.quantity||0) - quantity. 음수 허용(adjustInventory 선례). 행 없으면 insert(quantity = -quantity, safety_stock=0) — 음수 재고 행 생성. (adjustInventory 의 OUT 행없음 abs 입고 분기 복붙 금지. 소모는 OUT 이므로 음수 생성이 맞음. lock)
  - inventory_movements insert: branch_id, product_id, movement_type:'OUT', quantity, reference_type:'USAGE', usage_type_id, memo: memo||null.
- partial-failure 정책 (lock): 검증·RAW/SUB 제한은 루프 진입 전 전수 통과해야 시작 → 2-pass. 1st pass: branch/usage/items/quantity + 각 라인 product_type HQ 체크 전부 OK 확인. 2nd pass: 실제 차감. 차감 패스 도중 supabase 에러는 비트랜잭션이라 롤백 불가 → 기존 코드 동일 한계(BUILD-LOG Known Gap 기재). 사용자 거부는 전부 1-pass 에서 발생 → 실무상 부분차감 거의 없음.
- (supabase as any) 방어 패턴 유지(마이그 미적용 폴백). 끝에 revalidatePath('/inventory') + { success: true, count: items.length }.

### 2) UI — 새 모달 src/app/(dashboard)/inventory/StockUsageModal.tsx (신규 파일)
결정: 새 모달(TransferModal 동형 mount). 탭/서브뷰 아님 — 입출고 버튼군과 한 자리.
- Props: { branches: {id;name;is_headquarters?}[]; inventories: Inventory[]; usageTypes: {id;code;name}[]; defaultBranchId?: string; onClose; onSuccess }. 자체 fetch 없음 — page 가 이미 가진 데이터 주입.
- 상단: 지점 select(지점고정 사용자면 자기 지점 고정·disabled — page 의 isBranchUser 로 defaultBranchId 강제), 사용유형 select(usageTypes active 만; 빈 목록이면 '사용유형을 먼저 시스템코드에서 등록하세요' 안내 + 처리버튼 disable), 공통 memo(optional).
- 하단 다건 리스트: 제품 검색 입력(이름/코드, inventories 의 product 로 필터) → 선택 시 행 추가. 행 = 품목명·코드 / 선택 지점의 현재고 표시 / 수량 input / 삭제. 같은 품목 중복추가 막기(이미 있으면 수량 포커스).
  - 현재고는 inventories 에서 (branch_id===선택지점 && product_id) 매칭. 지점 바꾸면 각 행 현재고 재계산.
  - 수량 > 현재고: 경고 표시(빨강 텍스트/배지)하되 차단 안 함(음수 정책). 처리 버튼 살아있음.
- 처리 버튼: recordStockUsage 호출. error 면 표시·중단. success 면 onSuccess(→ fetchInventory + close). 처리 중 disable.
- 스타일은 TransferModal 클래스(input/btn-primary/btn-secondary) 재사용.

### 3) inventory/page.tsx 배선
- import: StockUsageModal, getInventoryUsageTypes (from '@/lib/actions').
- state: showUsageModal(bool). usageTypes 목록은 최초 useEffect/fetchInventory 에서 getInventoryUsageTypes() 호출해 보관(active 만 필터해 모달에 전달). 마이그 미적용/빈배열이면 빈배열.
- 헤더 버튼군(L481~489, '+ 입출고' 옆)에 '+ 소모 차감' 버튼 추가 → setShowUsageModal(true).
- 모달 mount: TransferModal mount(L875~) 옆에 {showUsageModal && <StockUsageModal branches inventories usageTypes defaultBranchId={isBranchUser? userBranchId : ''} onClose onSuccess />}.

## Flags (추측 금지)
- RBAC: inventory 페이지 접근 권한(screen_permissions)에 종속 — 별도 역할 체크 추가 X. 지점고정 사용자는 지점 select 고정(자기 지점). 본사 전용 별도 게이트 없음(RAW/SUB 라인만 HQ 제한으로 자연 차단).
- 행 없을 때 insert: 음수 quantity 로 생성(소모는 OUT). adjustInventory 의 abs 분기 복붙 금지.
- recordStockUsage 는 FormData 가 아니라 객체 인자(다건). transferInventory(FormData)와 다름 — 주의.
- as any 방어 패턴 필수(079 미적용 환경 빌드 통과).

## AI Sync 결정 (CLAUDE.md 매트릭스 적용)
- schema.ts DB_SCHEMA: 무수정 — Step 1 에서 inventory_usage_types·usage_type_id·reference_type='USAGE' 전부 반영됨. analyze_data 가 이미 읽음.
- tools.ts WRITE_TOOLS: 이번에도 미추가 (lock). 에이전트 자동 소모 실행 비즈니스 요구 없음(로스/자가사용은 사람 판단). 읽기는 analyze_data 로 충분.
- BUSINESS_RULES 한 줄 추가: schema.ts BUSINESS_RULES 재고/소모 섹션(L29 인근)에 → "재고 소모 차감은 재고화면 '소모 차감' 버튼(recordStockUsage)으로 다건 일괄 OUT 처리 — 지점+사용유형+품목리스트, 음수 허용, RAW/SUB 본사 제한." (DB_SCHEMA 무수정과 모순 아님: BUSINESS_RULES 텍스트 1줄만.)

## Out of Scope (→ BUILD-LOG Known Gaps)
- 소모 이력 보고/필터/조회 화면.
- 비트랜잭션 부분실패 자동 롤백(기존 코드 한계 동일).
- tools.ts 에이전트 소모 WRITE 도구.
- CSV/엑셀 업로드 다건 입력.
- 사용유형별 재고 소모 통계/대시보드.

## Acceptance
- npm run build 통과.
- 재고화면 헤더에 '+ 소모 차감' 버튼 → 모달: 지점·사용유형·다건 품목·현재고·수량.
- recordStockUsage: items 빈배열 거부, quantity<1 거부, RAW/SUB 비본사 라인 거부(1-pass), 통과 시 라인별 inventories 음수허용 차감 + inventory_movements(OUT/USAGE/usage_type_id) insert.
- 지점고정 사용자 지점 select 고정.
- 마이그 신규 0개. schema.ts DB_SCHEMA 무수정, BUSINESS_RULES 1줄만 추가.
