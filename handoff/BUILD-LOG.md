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
