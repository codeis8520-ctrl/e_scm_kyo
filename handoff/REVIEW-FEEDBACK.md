# Review Feedback — Step 1: ESC 닫기 훅 + 핵심 모달 9곳
Date: 2026-06-16
Ready for Builder: NO

## Must Fix

- src/app/(dashboard)/pos/SalesListTab.tsx:1307 + :2069 (handleReprint) + ReceiptModal — 중첩 리스너로 ESC 1회에 영수증+드로어 동시 닫힘.
  - 원인: `onReprint`(1307)와 `handleReprint`(2069)는 드로어를 unmount 하지 않음. 따라서 재출력 영수증(ReceiptModal)이 뜬 동안 SalesDetailDrawer와 ReceiptModal 두 개의 document keydown 리스너가 동시에 활성. ESC 1회 → ReceiptModal `onClose`(즉시) + SalesDetailDrawer `onClose`(editingDetails=false면 즉시) 가 같은 이벤트에서 둘 다 실행 → 영수증만 닫고 드로어로 돌아가려던 사용자가 드로어까지 닫힘.
  - 훅 주석(useEscClose.ts:9) "중첩 모달은 발생하지 않음" 전제가 이 경로에서 깨짐. onRefundIntent(1308-1311)는 `setSelectedOrderId(null)`로 드로어를 먼저 unmount 하므로 안전하지만, reprint 경로는 그 가드가 없음.
  - 고치는 법(택1, Bob 판단): (a) ReceiptModal이 떠 있는 동안 SalesDetailDrawer의 훅을 끄기 — 드로어 useEscClose에 `enabled: !reprintOpen` 류 플래그 전달(상위 reprintReceipt 상태를 prop으로 내려 받아). 가장 직접적. (b) 재출력도 onRefundIntent처럼 드로어를 닫고 영수증만 띄우는 패턴으로 통일(단 UX상 영수증 닫으면 목록으로 가버리므로 (a) 권장).

- src/app/(dashboard)/inventory/InventoryModal.tsx:54-56 — 기존 재고행 편집 진입 시 무입력 ESC에도 confirm 발생(prefilled≠dirty).
  - `selectedProduct`(36-43)는 edit 모드에서 `inventory` prop으로 미리 채워짐. isDirty가 `!!selectedProduct || memo.trim()` 이라 사용자가 아무것도 안 고쳐도 항상 true → ESC마다 confirm. 가장 흔한 "행 클릭→조정폼" 경로에서 dirty 게이트가 무의미해지고 오히려 성가심.
  - 고치는 법: prefill을 dirty로 치지 말 것. 실제 사용자 변경만 판정. 예: create 모드(=`!inventory`)에서 product를 새로 고른 경우만 dirty 인정 + 항상 quantity/safety_stock 변경·memo 입력을 dirty로. 구체: `isDirty: () => (!inventory && !!selectedProduct) || formData.quantity !== 1 || formData.safety_stock !== (inventory?.safety_stock ?? 0) || formData.memo.trim() !== ''`. (quantity 기본 1, safety_stock 기본 prefill값과 비교.)

## Should Fix

- (없음)

## Escalate to Architect

- (없음 — 두 건 모두 코드 레벨에서 해결 가능. reprint 중첩은 enabled 플래그, InventoryModal은 isDirty 재정의.)

## Cleared (조건부)

훅 useEscClose.ts 구현은 정상 — IME 가드(isComposing/keyCode 229), isDirty→confirm 게이트, cleanup 리스너 제거, enabled 존중 모두 확인. deps에 onClose/isDirty 포함이라 인라인 콜백이 매 렌더 재구독되지만(리스너 churn) stale closure는 없고 최신 클로저가 항상 호출됨 — 누수 없음, 기능상 안전(개선 여지일 뿐 차단 아님).

Bob 플래그 1(SalesDetailDrawer 인라인편집 ESC 이중발화): **문제 없음**. 편집 input에 자체 onKeyDown Escape 핸들러가 코드에 존재하지 않음(파일 전체 grep: setEditingDetails는 button onClick 2201/2343에서만 false). 따라서 ESC는 document 훅만 발화 → editingDetails=true이면 confirm 정상. close-without-confirm/이중액션 발생 안 함. 수용.

표시전용 3개(ReceiptModal:50, MovementHistoryModal:68, CustomerLookupModal:1353) isDirty 없이 즉시 닫기 정상. 폼모달 중 StockUsageModal:55·TransferModal:31·PackUnpackModal:45·RefundModal:54 의 isDirty는 prefill 오탐 없음(to_branch_id/rows/usageTypeId/order/orderNumber/parentQty 모두 기본값 기준 사용자 변경만 판정). InventoryModal만 prefill 오탐(위 Must Fix). 기존 X버튼·배경클릭 onClose 무변경 확인. DB/마이그/schema.ts/tools.ts 변경 없음 확인.

---

# Re-Review — Step 1 Must Fix 2건 (재제출)
Date: 2026-06-16
Ready for Builder: YES

## Must Fix 검증 결과

- **Fix 1 (reprint 중첩 ESC) — 통과.** SalesListTab.tsx 호출부 L1307 `reprintOpen={!!reprintReceipt}` (라이브 상태, stale 없음), 시그니처/타입 L1471·1474 `reprintOpen: boolean` 정상 추가. 훅 L1507 `useEscClose(onClose, { enabled: !reprintOpen, isDirty: () => editingDetails })`. ReceiptModal 떠 있는 동안 reprintReceipt 진실 → reprintOpen=true → enabled=false → 드로어 ESC 리스너 OFF → ESC 1회 = 영수증만 닫힘. 영수증 닫힘(reprintReceipt=null) → reprintOpen=false → enabled=true → 드로어 ESC 복구. prop 배선·상태 동기 정확.

- **Fix 2 (InventoryModal prefill 오탐) — 통과.** CRITICAL 베이스라인 대조: formData 초기화(L44-50) quantity:1 / safety_stock: inventory?.safety_stock || 0 / memo:''. isDirty(L54-59) 베이스라인: quantity!==1(초기 1→FALSE), safety_stock!==(inventory?.safety_stock ?? 0)(초기값과 동일→FALSE), memo.trim()!==''(초기 ''→FALSE). quantity는 ADJUST 이동량이라 1로 하드코딩 — 현재고로 prefill되지 않음(리뷰어 우려 해소). selectedProduct 절은 !inventory 가드 → edit 모드 prefill는 dirty 아님; create 모드 초기 null→FALSE. 미수정·신규개봉 시 두 모드 모두 isDirty=FALSE 확인. safety_stock 초기화 `|| 0` vs isDirty `?? 0` 차이는 숫자/널 모두 동일 결과(0)라 오탐 없음.

## Cleared

reprint 중첩 ESC 가드(prop 배선)와 InventoryModal isDirty 베이스라인 두 Must Fix 모두 정확히 수정됨. 잔여 Must Fix 0건.
