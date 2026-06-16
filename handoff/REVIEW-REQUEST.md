# Review Request — Step 1: ESC 닫기 훅 + 핵심 모달 9곳 (재제출 — Must Fix 2건 반영)
Date: 2026-06-16
Ready for Review: YES

## 재제출 변경 (REVIEW-FEEDBACK Must Fix 2건)

1. **재출력 중첩 ESC 동시발화** (SalesListTab.tsx)
   - SalesDetailDrawer에 `reprintOpen: boolean` prop 추가(1306 `reprintOpen={!!reprintReceipt}`, 1470 시그니처/타입).
   - 드로어 훅을 `useEscClose(onClose, { enabled: !reprintOpen, isDirty: () => editingDetails })`(L1505)로 변경 → ReceiptModal 떠 있는 동안 드로어 ESC OFF. ESC 1회 = 영수증만 닫힘.
2. **InventoryModal prefill 오탐** (InventoryModal.tsx:54-59)
   - `isDirty`를 `(!inventory && !!selectedProduct) || formData.quantity !== 1 || formData.safety_stock !== (inventory?.safety_stock ?? 0) || formData.memo.trim() !== ''` 로 재정의.
   - edit 모드 prefill(unchanged)는 dirty 아님. create에서 새 품목 선택 / quantity·safety_stock·memo 실변경만 dirty.

Bob 플래그 1(SalesDetailDrawer 인라인편집 이중발화)은 리뷰어 확인대로 **변경 없음**(편집 input에 자체 onKeyDown Escape 없음 — document 훅만 발화).

## Files Changed

### 신규 훅
- src/hooks/useEscClose.ts:1-39 — document keydown 'Escape' 리스너 훅. enabled(default true)·IME 가드(isComposing/keyCode 229)·isDirty 시 window.confirm 후에만 onClose. handler를 useEffect 내부 정의, cleanup에서 리스너 제거. deps=[onClose, enabled, isDirty, confirmMessage].

### 표시 전용 (isDirty 없음, 즉시 닫기)
- src/app/(dashboard)/pos/ReceiptModal.tsx:5 import, :50 `useEscClose(onClose)`
- src/app/(dashboard)/inventory/MovementHistoryModal.tsx:6 import, :68 `useEscClose(onClose)`
- src/app/(dashboard)/pos/SalesListTab.tsx:12 import, :1353 CustomerLookupModal `useEscClose(onClose)` (검색 전용)

### 폼 모달 (isDirty 콜백, 입력 중이면 confirm)
- src/app/(dashboard)/pos/SalesListTab.tsx:1505 SalesDetailDrawer `enabled: !reprintOpen, isDirty: () => editingDetails` (reprint 중첩 가드 추가)
- src/app/(dashboard)/pos/RefundModal.tsx:6 import, :53-55 `isDirty: () => !!order || orderNumber.trim() !== '' || Object.keys(selectedItems).length > 0`
- src/app/(dashboard)/inventory/InventoryModal.tsx:5 import, :54-59 `isDirty: () => (!inventory && !!selectedProduct) || formData.quantity !== 1 || formData.safety_stock !== (inventory?.safety_stock ?? 0) || formData.memo.trim() !== ''` (prefill 오탐 수정)
- src/app/(dashboard)/inventory/StockUsageModal.tsx:5 import, :54-56 `isDirty: () => rows.length > 0 || usageTypeId !== '' || memo.trim() !== ''`
- src/app/(dashboard)/inventory/TransferModal.tsx:5 import, :30-32 `isDirty: () => formData.to_branch_id !== '' || formData.memo.trim() !== ''`
- src/app/(dashboard)/inventory/PackUnpackModal.tsx:6 import, :44-46 `isDirty: () => parentQty !== 1 || memo.trim() !== ''`

기존 X 버튼·배경클릭 onClose는 전부 무변경(ADD only).

## Build
`npm run build` 통과 — 전 라우트 컴파일·생성 완료, 에러/경고 0.

## Open Questions
- (없음 — 이전 2건 모두 Must Fix로 해소.)

## Out of Scope (logged in BUILD-LOG)
- shipping/page.tsx 인라인 모달 2개, system-codes/page.tsx 인라인 모달 9개 → Step 2.
- inventory/count/page.tsx, TransferBatchPanel(패널, 모달 아님) → 제외.
- 공통 Modal 컴포넌트 리팩터(오버레이 통일) → 범위 밖.
