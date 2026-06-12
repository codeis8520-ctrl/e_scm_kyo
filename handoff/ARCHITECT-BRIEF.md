# Architect Brief — Feature B (다건 지점 재고 이동) · 1 deployable step

> AMEND (2026-06-12): UI = 재고 페이지 내 **서브뷰 탭(subView 토글)**. 모달 아님.
> Project Owner 명시 선택 "재고 페이지 내 새 화면/탭" + SalesListTab 지점비교 서브뷰 토글 선례(commit 5b8c319) 일치.

## Goal
재고 페이지에 "지점 이동" 서브뷰 탭을 추가한다. 토글 '재고현황' ↔ '지점이동'.
'지점이동' 뷰: 상단 좌=출발 지점 / → / 우=도착 지점 (풀폭 2-panel), 하단 다품목(검색·수량 다행) + 일괄 이동.
기존 행별 단건 TransferModal('이동' 버튼)은 그대로 유지.

## Build Order

### 1) 신규 서버 액션 transferInventoryBatch — src/lib/actions.ts  (변경 없음 — 그대로)
recordStockUsage(L1086~)를 템플릿으로, 단건 transferInventory(L1176~) 로직을 배치로 래핑.
- 시그니처(객체 인자, FormData 아님):
  transferInventoryBatch(input: { from_branch_id: string; to_branch_id: string; memo?: string; items: { product_id: string; quantity: number }[] })
- 2-pass (recordStockUsage 와 동일 구조):
  - pass1 전수검증 → 하나라도 실패 시 처리 시작 전 거부:
    - from_branch_id / to_branch_id 필수
    - from === to → '동일 지점 간 이동은 할 수 없습니다.' (단건 선례 문구 그대로)
    - items.length === 0 → '이동 품목을 1개 이상 추가하세요.'
    - 각 item: product_id 존재, Number.isInteger(quantity) && quantity >= 1 아니면 '이동 수량은 1개 이상의 정수여야 합니다.'
    - 출고지 재고부족 전수검사(단건 L1201 선례 — 음수 미허용이 이동 정책): 라인별 from_branch_id 재고 조회,
      재고없음 || 재고<quantity 면 "'<품명>' 이동 수량이 출고 지점의 재고보다 많습니다." 거부.
      소모(음수허용)와 다름 — 이동은 음수불가, 반드시 거부.
  - pass2 라인 루프(비트랜잭션 — 기존 코드 일관): 단건 transferInventory 의 OUT/IN 을 라인마다 반복:
    - 출고지 inventories quantity -= q (행은 pass1 에서 존재 확인됨)
    - 입고지 inventories 행 있으면 += q, 없으면 insert { branch_id: to, product_id, quantity: q, safety_stock: 0 } (단건 L1212~ 동일)
    - inventory_movements 2건: OUT(branch_id=from) + IN(branch_id=to), 둘 다 reference_type='TRANSFER',
      memo `지점 이동: ${memo||'출고'}` / `${memo||'입고'}`
- revalidatePath('/inventory') → return { success: true }
- Flag: pass1 재고검증과 pass2 차감 사이 트랜잭션 없음(기존 단건과 동일 한계) — 동시성 레이스 이번 스코프 아님.

### 2) 신규 컴포넌트 TransferBatchPanel.tsx — src/app/(dashboard)/inventory/  (모달 → 인라인 서브뷰 패널)
StockUsageModal.tsx 의 다행 품목검색 로직(candidates/rows/search/over)을 복제하되, 모달 래퍼(오버레이/onClose)를 제거하고 full-width 인라인 섹션으로 렌더.
- Props: { branches, inventories, defaultFromBranchId?, fromBranchLocked?, onSuccess }  (onClose 없음 — 패널이므로)
- state: fromBranchId(default 주입), toBranchId, memo, search, rows, error, loading
- 레이아웃(풀폭 2-panel 좌→우): 상단 가로 한 줄 — [좌 "출발 지점 *" select] [→ 화살표] [우 "도착 지점 *" select].
  fromBranchLocked 면 출발 select disabled. from===to 면 인라인 경고.
- 하단 다품목 리스트(StockUsageModal 인라인 섹션 패턴 그대로): 출발 지점(fromBranchId) 기준 inventories 에서 quantity>0 만 검색 후보.
  행마다 품명/현재고(stockOf=fromBranchId 기준)/수량입력/삭제. over(quantity>stock) 행 빨강보더/배지. 중복/추가됨 제외 동일.
- 제출: from===to 거나 over 행 있으면 `일괄 이동 (N)` 버튼 disabled (pass1 거부와 일관).
  transferInventoryBatch({from_branch_id,to_branch_id,memo,items:rows}) → 성공 시 rows 초기화 + onSuccess()(fetchInventory). error 인라인 표시.
- 섹션 헤더 "지점 재고 이동", 버튼 `일괄 이동 (${rows.length})`.

### 3) page.tsx 서브뷰 토글 와이어링 — src/app/(dashboard)/inventory/page.tsx
- import TransferBatchPanel. state: const [subView, setSubView] = useState<'stock' | 'transfer'>('stock').
- 서브뷰 토글 바: SalesListTab.tsx L554-569 패턴 복제 — `bg-slate-100 rounded-lg p-1 w-fit`, 두 버튼
  [['stock','재고현황'],['transfer','지점이동']]. 활성 `bg-white text-blue-700 shadow-sm`, 비활성 `text-slate-500`.
  · ⚠ SalesListTab 은 `!isBranchUser` 게이트가 있으나 **여기선 토글 항상 노출** — 지점고정 사용자도 지점이동 사용(출발지 자기지점 잠금). isBranchUser 게이트 넣지 말 것.
  · 위치: 최상단 `<div className="card">`(L483) 안 헤더 블록(L484~508) 위에 토글 바 배치.
- 분기 렌더:
  · subView==='stock' 일 때만 기존 재고현황 전체(헤더의 "+ 입출고/+ 소모 차감" 버튼들 · 검색바 L510~ · 테이블 · 페이지네이션)를 렌더 → 그 JSX 블록을 `{subView==='stock' && (<>…</>)}` 로 감쌀 것.
  · subView==='transfer' 면 그 자리에 패널만:
    `{subView==='transfer' && <TransferBatchPanel branches={branches} inventories={inventories}
      defaultFromBranchId={isBranchUser && userBranchId ? userBranchId : ''}
      fromBranchLocked={isBranchUser && !!userBranchId} onSuccess={fetchInventory} />}`
- 기존 단건 행별 TransferModal(L893~ 렌더 + 행 "이동" 버튼) · StockUsageModal · MovementHistoryModal 전부 그대로 유지 — 손대지 말 것.
- RBAC: 지점고정 사용자 출발=자기지점 고정(defaultFromBranchId + fromBranchLocked → 출발 select disabled), 도착 자유 선택.

## Out of Scope (→ BUILD-LOG Known Gaps)
- AI 에이전트 배치 이동 도구 추가 안 함. 단건 transfer_inventory(tools.ts L248/1888) 이미 존재 — 배치는 UI 전용.
  BUSINESS_RULES 변경 불필요(reference_type='TRANSFER' 동일, 신규 enum/테이블 없음).
- DB 마이그레이션 없음 — inventories + inventory_movements(TRANSFER) 재사용. schema.ts DB_SCHEMA 변경 불필요(확인 완료).
- pass1↔pass2 트랜잭션화/동시성 강화(기존 단건과 동일 한계 유지).
- RAW/SUB 본사 제한 이동에 미적용(지점간 물류, 단건 transferInventory 에도 제한 없음 — 선례 일치).

## Acceptance
- npm run build 통과.
- 재고 페이지 서브뷰 토글 '재고현황' ↔ '지점이동'. '지점이동' 뷰: 출발/도착 2 select + 화살표(풀폭) + 하단 품목검색(출발지 재고>0)·수량 다행 → "일괄 이동 (N)" 1회 다건 이동.
- 출발===도착 거부. 수량<1 거부. 출고지 재고 초과 라인 거부(음수 미발생). 부분실패 없음(pass1 전수검증).
- 이동 후 출고지 차감/입고지 가산, movement OUT+IN(TRANSFER) 2N건 기록.
- 지점고정 사용자: 토글 노출됨, 출발 자기지점 잠금, 도착 자유.
- 기존 행별 단건 "이동"(TransferModal) 정상 유지.

---

## AMENDMENT (2026-06-12) — 출발지 후보 자체 페치 + qty=0 가드

리뷰 결과 Must Fix 0건이나, 비지점(HQ/SUPER_ADMIN) 사용성 갭 1건이 기능 목적을 무력화 → 스코프 확장 확정.

**근거**: 지점이동의 주 사용자는 HQ/관리자. page.tsx fetchInventory 는 hasFilter=true(검색·필터·지점고정) 일 때만 실행 → HQ 사용자가 지점이동 직행 시 inventories=[] 영구 빈, 검색해도 후보 0. 원래 brief "inventories 재사용·별도 페치 미요청" 스코프 경계가 원인. → 패널이 자체 페치하도록 변경.

### A) TransferBatchPanel — 출발지 inventories 자체 페치 (prop 의존 제거)
- 데이터원 확정: `getInventory(branchId, search)` — src/lib/actions.ts:984. branch_id eq 필터, `*, branch, product` 반환. 이게 정답 소스.
- 변경: candidates/getStock 를 page-level `inventories` prop 대신 **선택된 fromBranchId 의 자체 페치 결과**로 산출.
  - useState `srcInventories` 추가 (Inventory[]).
  - useEffect([fromBranchId]): fromBranchId 있으면 `getInventory(fromBranchId)` 호출 → srcInventories 세팅. 빈 fromBranchId 면 [] 로 클리어. **fromBranchId 변경 시마다 refetch.**
  - 출발지 stock>0 스코프 유지(candidates 의 quantity>0 필터 그대로). getStock·candidates 의 참조를 srcInventories 로 교체.
  - inventories prop: 제거 가능하면 제거. page.tsx 의 `inventories={inventories}` 도 함께 제거(미사용 prop 정리). 단, 다른 용도로 쓰이면 그대로 두고 candidates 만 srcInventories 로 전환.
- branch 필터 외 search 인자는 미사용(클라 측 candidates 가 search 텍스트로 이미 필터링) — getInventory(fromBranchId) 만 호출, search 인자 생략.

### B) qty=0 가드 (리뷰 Should Fix 흡수)
- submitDisabled 에 `rows.some(r => r.quantity < 1)` 추가 (TransferBatchPanel.tsx:102-103).
  → 빈/비정수 입력으로 quantity=0 인 행이 있으면 `일괄 이동` 버튼 비활성. 서버 pass1 거부 전 UX 차단.

### 잠금/불변
- 그 외 전부 빌드된 상태 유지. 마이그레이션 없음. schema.ts / tools.ts 무변경.
- 2-pass 서버 로직, 서브뷰 토글, 단건 TransferModal/StockUsageModal/MovementHistoryModal 전부 손대지 말 것.

### 명시적 제외 (이 스텝 아님)
- transferInventoryBatch 의 서버측 출발지 RBAC 미강제(호출자 지점 무대조)는 **이번 스텝에서 고치지 않는다.** 기존 단건 transferInventory(actions.ts:1176-1203)와 동일한 선례적 한계 — 배치가 신규 회귀를 만들지 않음. 단건+배치 공통 보안 하드닝으로 BUILD-LOG Known Gaps 에 별도 후속 등록. 제품/보안 정책 결정 사안.

### Acceptance (추가)
- HQ/SUPER_ADMIN 사용자가 재고현황 선검색 없이 지점이동 직행 → 출발지 선택 시 해당 지점 재고>0 후보가 검색에 노출되어야 한다.
- 출발지 변경 시 후보가 새 출발지 기준으로 갱신.
- quantity=0/빈 행 존재 시 `일괄 이동` 버튼 비활성.
