# Review Feedback — Feature B (다건 지점 재고 이동)
Date: 2026-06-12
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
- TransferBatchPanel.tsx:271 — `parseInt(e.target.value) || 0` 으로 빈 입력/비정수 시 수량 0 저장.
  hasOver/submitDisabled 가 0 을 막지 못함(0 > stock 거짓, rows.length>0 참) → `일괄 이동` 버튼 활성 가능.
  서버 pass1(actions.ts:1281)이 `quantity < 1` 거부하므로 데이터 무결성은 안전하나, 버튼이 눌려 에러 박스가 뜨는 UX.
  권장: submitDisabled 에 `rows.some(r => r.quantity < 1)` 추가, 또는 0 행 빨강 표시. 5분 미만 — 인라인 수정 권장.

## Escalate to Architect
- [Known Gap 심각도 판정 — 비지점(HQ/SUPER_ADMIN) 사용자 후보 빈 문제]
  page.tsx:199-210 fetchInventory 는 hasFilter(검색·필터·지점고정) 가 true 일 때만 실행.
  - 지점 사용자: isBranchUser&&userBranchId 로 마운트 즉시 hasFilter=true → inventories 채워짐 → 갭 무효(moot).
  - 비지점 사용자: 검색 전 inventories=[] (L203-204). 지점이동 직행 → 출발지 선택 → 검색 입력해도 candidates 영구 빈.
  즉 HQ/관리자에게는 "재고현황 탭에서 먼저 검색" 선행 없이는 기능이 사실상 동작 안 함. 흔한 경로.
  왜 코드 레벨에서 못 정함: Brief 가 "inventories 재사용·별도 페치 미요청" 으로 스코프를 명시적으로 그음(REVIEW-REQUEST L27).
  스코프 확장 여부는 제품 결정. 권장 해소안: transfer 서브뷰 진입 시 fromBranchId 선택분 inventories 자체 페치(별도 effect) 또는 검색어 기반 페치. Arch 가 스코프 포함/Known Gap 유지 결정.

- [RBAC 서버측 출발지 미강제 — 기존 단건과 동일 한계]
  transferInventoryBatch 는 fromBranchId 를 입력에서 그대로 사용, 호출자 지점 대조 없음.
  기존 단건 transferInventory(actions.ts:1176-1203)도 동일하게 form 의 from_branch_id 무검증 사용 — 서버측 잠금 부재는 선례.
  배치 액션은 이 한계를 복제할 뿐 악화시키지 않음(동일 공격면). UI 는 fromBranchLocked 로 잠금.
  Brief 가 "acceptably gated 여부 확인" 요청 → 코드 레벨 판단: 신규 회귀 아님, 따라서 Must Fix 아님.
  단, 지점 사용자가 자기 지점 아닌 출발지로 재고를 빼낼 수 있는 잠재 경로(서버 무방비)는 단건·배치 공통 보안 갭으로 별도 후속(BUILD-LOG)에서 서버측 강제 검토 권장. 제품/보안 정책 결정.

## Cleared
transferInventoryBatch 2-pass(전수검증 후 일괄 처리, pass1 from===to·정수≥1·라인별 재고부족 거부, pass2 OUT+IN reference_type='TRANSFER' 음수 미허용, 부분쓰기 없음), 재고 산식(출발 -q / 도착 +q or insert positive), 서브뷰 토글(기존 stock 뷰·모달 fragment 밖 보존, 회귀 없음), 마이그·schema.ts·tools.ts 무변경 — 검토·통과.

---

# Review Feedback — Feature B AMENDMENT 재리뷰 (출발지 후보 자체 페치 + qty=0 가드)
Date: 2026-06-12
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
없음. (이전 라운드 qty=0 Should Fix 흡수 확인 — submitDisabled 에 hasInvalidQty 반영됨)

## Escalate to Architect
- [RBAC 서버측 출발지 미강제 — 변동 없음, 정상 파킹 확인]
  transferInventoryBatch 서버측 출발지 RBAC 미강제 항목은 이번 amendment 에서 **수정/변경되지 않고 BUILD-LOG Known Gaps 후속으로 그대로 파킹**됨(REVIEW-REQUEST L16, brief L101-102). 이전 라운드 Escalate 항목 그대로 유효 — 단건·배치 공통 서버측 출발지 잠금 부재는 제품/보안 정책 결정으로 잔존.

## 검증 결과 (전 항목 통과)
1. 후보 소스 전환 — `srcInventories` state 추가, `useEffect([fromBranchId])` 에서 `getInventory(fromBranchId)`(actions.ts:984, branch_id eq) 페치. page-level `inventories` prop 의존 완전 제거(Props 인터페이스에서 삭제). `stockOf`/`candidates` 모두 `srcInventories` 참조, candidates deps 도 srcInventories. → HQ/관리자 직행+출발지 선택 시 사전 검색 없이 후보 노출됨. **이전 라운드 Escalate(HQ 후보 공백 갭) 실질 해소.**
2. Stale 가드 — `cancelled` 플래그 클로저, cleanup 에서 `cancelled=true`. then/catch/finally 모두 `if(!cancelled)` 가드. fromBranchId 빠른 전환 시 이전 응답 무시 → 타지점 재고 표시 불가. 정확.
3. quantity>0 스코프 — stockOf 는 매칭 inv.quantity 반환, candidates 는 `inv.quantity<=0` 컷 + branch_id===fromBranchId 재확인. 유지됨.
4. loading/empty — fromBranchId 빈 값 시 useEffect 즉시 `setSrcInventories([])` return(페치 안 함). search 입력 disabled + placeholder 안내. loadingInv 힌트/검색결과없음 힌트 분기 정상. fromBranchId 빈 상태 stockOf/candidates 모두 null/[] → 크래시 없음.
5. submitDisabled — `hasInvalidQty = rows.some(r => r.quantity < 1)` 포함 확인(L126,131). qty=0/빈 행 버튼 비활성.
6. page.tsx prop 제거 — L502-507 패널에 inventories 미전달. L933 StockUsageModal 의 `inventories={inventories}` 는 별개 consumer, 그대로 유지(미손상). 빌드 통과로 타 consumer 회귀 없음 확인.
7. 무변경 확인 — git diff: transferInventoryBatch(actions.ts) 본문, subView 토글 와이어링, 단건 TransferModal 미변경. 마이그/schema.ts/tools.ts 무변경.
8. getInventory 반환 형태 — `{ data: [] }` (절대 undefined 아님), `product:products(*)` 포함 → `res?.data||[]` 안전, `inv.product` 존재. npm run build ✓ Compiled successfully.

## Cleared
출발지 후보 자체 페치(useEffect[fromBranchId]·getInventory·cancelled stale 가드), stockOf/candidates srcInventories 전환(quantity>0 유지), qty<1 submitDisabled 흡수, page.tsx inventories prop 제거(L933 StockUsageModal 무손상), 단건 모달·배치 액션·서브뷰 와이어링·마이그·schema.ts·tools.ts 무변경, 빌드 통과 — 재검토·통과. RBAC 서버측 항목 정상 파킹.
