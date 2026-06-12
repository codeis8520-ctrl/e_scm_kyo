# Review Request — Feature B (다건 지점 재고 이동)
Date: 2026-06-12
Ready for Review: YES

## AMENDMENT 적용 (2026-06-12) — 출발지 후보 자체 페치 + qty=0 가드
리뷰의 사용성 갭(HQ/SUPER_ADMIN 직행 시 후보 공백)과 Should Fix(qty=0 버튼 활성)를 brief AMENDMENT(L78-107) 대로 반영. 그 외 전부 불변.

### 변경 라인 (이번 amendment 분)
- TransferBatchPanel.tsx:3-4 — `useEffect` import 추가, `getInventory` 액션 import 추가.
- TransferBatchPanel.tsx:Props — `inventories` prop 제거(후보 소스 아님). page.tsx 의 `inventories={inventories}` 전달도 함께 제거.
- TransferBatchPanel.tsx — `srcInventories`/`loadingInv` state 추가. `useEffect([fromBranchId])`: fromBranchId 변경 시마다 `getInventory(fromBranchId)`(actions.ts:984, branch_id eq) 페치 → srcInventories 세팅, 빈 fromBranchId 면 [] 클리어, cancelled 가드로 stale 응답 무시.
- TransferBatchPanel.tsx — `stockOf`/`candidates` 의 참조를 `inventories` → `srcInventories` 로 교체(quantity>0 스코프 유지). candidates useMemo deps 도 srcInventories 로.
- TransferBatchPanel.tsx — 검색 입력 아래 로딩("재고 불러오는 중...")/빈("검색 결과 없음") 인라인 힌트 추가.
- TransferBatchPanel.tsx:submitDisabled — `hasInvalidQty = rows.some(r => r.quantity < 1)` 추가 → qty=0/빈 행 시 `일괄 이동` 버튼 비활성(서버 pass1 거부 전 차단). (Should Fix 흡수)
- page.tsx:502-507 — `inventories` prop 전달 제거(L504). 그 외 props/와이어링 불변. (L934 의 무관한 inventories 사용은 그대로 둠)
- 명시적 제외: transferInventoryBatch 서버측 출발지 RBAC 미강제는 이번 스텝 아님(brief L101-102) → BUILD-LOG Known Gaps 후속.
- npm run build ✓ Compiled successfully (에러/경고 없음).

## Files Changed
- src/lib/actions.ts:1254-1359 — 신규 `transferInventoryBatch({from_branch_id,to_branch_id,memo?,items[]})`. recordStockUsage 의 2-pass 구조 + 단건 transferInventory 의 OUT/IN 로직을 라인별 배치 래핑. pass1 전수검증(from/to 필수·from===to 거부·empty 거부·정수≥1·출고지 재고부족 라인 거부, 음수 미허용), pass2 라인 루프(출고지 차감 / 입고지 가산 or insert / movement OUT+IN 둘 다 reference_type='TRANSFER', memo `지점 이동: ${memo||'출고'}` / `${memo||'입고'}`). revalidatePath('/inventory').
- src/app/(dashboard)/inventory/TransferBatchPanel.tsx (신규 전체) — 인라인 풀폭 패널. StockUsageModal 다행 품목검색 패턴(candidates/rows/stockOf/over) 복제·모달 래퍼 제거. 상단 [출발 select]→[화살표]→[도착 select], fromBranchLocked 면 출발 disabled, from===to 인라인 경고. 하단 출발지(fromBranchId) 재고>0 품목만 검색 후보, 행별 현재고/수량/삭제, over 행 빨강보더+배지. 출발 변경 시 rows 초기화. 제출: from===to·over·empty·미선택 시 `일괄 이동 (N)` disabled, 성공 시 rows/memo 초기화 + onSuccess().
- src/app/(dashboard)/inventory/page.tsx:11 — import TransferBatchPanel.
- src/app/(dashboard)/inventory/page.tsx:138 — `subView` state ('stock'|'transfer').
- src/app/(dashboard)/inventory/page.tsx:483-508 — 서브뷰 토글 바(SalesListTab L556-568 패턴 복제, `bg-slate-100 rounded-lg p-1 w-fit`, 활성 `bg-white text-blue-700 shadow-sm`). isBranchUser 게이트 없음(항상 노출). 그 아래 transfer 분기(패널 + RBAC props: defaultFromBranchId/fromBranchLocked = isBranchUser&&userBranchId 기준, onSuccess=fetchInventory) + `{subView==='stock' && (<>` 로 기존 재고현황 전체 래핑 시작.
- src/app/(dashboard)/inventory/page.tsx:912 — stock fragment 닫힘 `</>)}`. 이후 모든 모달(단건 TransferModal·StockUsageModal·MovementHistoryModal·PackUnpackModal)은 fragment 밖, 그대로 유지.

## Self-review
- 가장 먼저 지적할 것: 패널 검색 후보가 page 의 inventories state 의존 → 비지점 사용자 transfer 직행 시 후보 빈 가능. Brief 가 inventories 재사용 명시·별도 페치 미요청 → 스코프 유지, BUILD-LOG Known Gaps 기록.
- Brief 요구사항 전수 확인: 토글·2-panel·화살표·출발지 재고>0 검색·수량 다행·일괄이동 버튼·from===to/over/empty disable·RBAC 잠금·OUT+IN(TRANSFER) 2N건·부분실패 없음·단건 TransferModal 유지 — 모두 구현.
- 빈 데이터/실패 시: 액션 error 는 인라인 빨강 박스로 표시(raw DB 용어 노출 없음, 한글 친화 메시지). 출발 미선택 시 검색창 disabled + 안내 placeholder.
- npm run build ✓ Compiled successfully (에러/경고 없음).

## Open Questions
- 없음. 동시성 비트랜잭션은 기존 단건과 동일 한계로 의도된 스코프(BUILD-LOG Known Gaps).

## Out of Scope (logged in BUILD-LOG)
- AI 에이전트 다건 이동 도구(단건 transfer_inventory 존재 — UI 전용).
- DB 마이그레이션·schema.ts/tools.ts 변경 없음.
- pass1↔pass2 트랜잭션화 / 동시성 강화.
- RAW/SUB 본사 제한 이동 미적용(단건 선례 일치).
- 비지점 사용자 transfer 뷰 직행 시 inventories 자체 페치(Brief 미요청).
