# Architect Brief — Step 1: ESC 닫기 훅 + 핵심 모달

## Goal
모든 핵심 팝업/상세창을 ESC로 닫을 수 있게 한다. 입력 중(dirty) 폼은 ESC 시 confirm 후에만 닫힌다. 기존 X버튼·배경클릭 닫기는 그대로 유지.

## Build Order
1. **신규 훅** `src/hooks/useEscClose.ts` ('use client' 불필요 — 훅 파일은 directive 없이, 호출하는 컴포넌트가 client)
   시그니처:
   ```ts
   export function useEscClose(
     onClose: () => void,
     opts?: { enabled?: boolean; isDirty?: () => boolean; confirmMessage?: string }
   ): void
   ```
   동작:
   - `useEffect`로 `document.addEventListener('keydown', handler)`, cleanup에서 remove.
   - handler: `e.key !== 'Escape'` → return. `enabled === false` → return.
   - **IME 가드**: `e.isComposing || e.keyCode === 229` → return (한글 입력 조합 중 ESC 무시).
   - `isDirty?.()` 가 true면 `if (!window.confirm(confirmMessage ?? '작성 중인 내용이 있습니다. 닫으시겠습니까?')) return;` 후 onClose(). 아니면 즉시 onClose().
   - deps: `[onClose, opts?.enabled, opts?.isDirty, opts?.confirmMessage]` — 단, onClose/isDirty가 매 렌더 새 함수일 수 있으니 **handler를 useEffect 내부에서 정의하고 deps에 onClose, enabled, isDirty, confirmMessage 직접 넣기**(useCallback 강제 안 함, 리스너 재등록은 저렴).
   - **중첩 처리 결정(LOCKED)**: capture/stopPropagation 안 씀. 각 모달이 자기 document 리스너를 건다. 이 ERP는 모달 중첩이 사실상 없음(둘러보다 확인됨 — 모달 안에서 또 다른 fixed inset-0 모달 동시 오픈 케이스 없음). 따라서 "top-most만 닫기" 로직 불필요. 만약 향후 중첩 생기면 그때 stack 도입. 지금은 단순 유지.

2. **핵심 모달에 훅 부착** (각 파일 컴포넌트 본문 상단에서 호출, onClose 재사용):

   | 파일 | dirty 전략 |
   |------|-----------|
   | `pos/SalesListTab.tsx` `SalesDetailDrawer` | isDirty = `() => editingDetails` (편집모드 진입 시 dirty). **편집모드일 때 ESC는 편집취소가 아니라 드로어 닫기 confirm** — 단순화. 추가-품목 입력폼도 editingDetails와 무관하게 열려있을 수 있으면 OR 조건 추가 가능하나, 우선 editingDetails만. |
   | `pos/SalesListTab.tsx` `CustomerLookupModal` | 표시/검색 전용 → isDirty 없음, 즉시 닫기 |
   | `pos/ReceiptModal.tsx` | 표시 전용(영수증) → 즉시 닫기 |
   | `pos/RefundModal.tsx` | 폼 → isDirty = 환불 대상/사유 등 입력값이 초기값과 다른지. 간단히 **모달별 dirty 플래그**: 사용자가 주문 조회/품목 선택/사유 입력 중 하나라도 했으면 dirty. 최소구현 = 조회된 주문이 있거나(orderNumber 입력) 선택 품목이 있으면 dirty. Bob 판단으로 가장 가벼운 플래그 1개. |
   | `inventory/InventoryModal.tsx` | 폼(조정) → isDirty = 선택 품목 있음 or 수량/사유 입력됨 |
   | `inventory/StockUsageModal.tsx` | 폼(다건 소모) → isDirty = 담긴 품목行 있음 or 사용유형/사유 입력됨 |
   | `inventory/TransferModal.tsx` | 폼(단건 이동) → isDirty = 수량/도착지 입력됨 |
   | `inventory/PackUnpackModal.tsx` | 폼(분해/조립) → isDirty = 수량 입력됨 |
   | `inventory/MovementHistoryModal.tsx` | 표시 전용(이력) → 즉시 닫기 |

   - dirty 플래그는 **이미 있는 state로 판정**(새 state 최소화). 각 모달의 기존 입력 state를 OR로 묶어 `isDirty` 콜백 인라인 작성. 빈 초기값과만 비교(정확한 diff 불필요 — "건드렸나" 수준).
   - **표시 전용 3종(Receipt/CustomerLookup/MovementHistory)**: `useEscClose(onClose)` 만.

## Out of Scope (→ BUILD-LOG Known Gaps)
- `shipping/page.tsx` 인라인 모달 2개(1586,1734), `system-codes/page.tsx` 인라인 모달 9개 — 별도 파일 아닌 page 내부 인라인. **Step 2에서 일괄 부착**. 이번 단계 제외.
- `inventory/count/page.tsx`, `TransferBatchPanel`(패널, 모달 아님 — 확인됨) 제외.
- 공통 Modal 컴포넌트로의 리팩터(오버레이 통일)는 범위 밖. 훅만 신설.

## Acceptance
- `npm run build` 통과.
- 각 대상 모달에서 ESC 누르면: 표시전용=즉시 닫힘 / 폼=입력 없으면 즉시, 입력 중이면 confirm 후 닫힘.
- 한글 입력 조합 중 ESC가 모달을 안 닫음(IME 가드).
- input 내 기존 onKeyDown Escape(인라인 편집 취소: pos qty/option/discount, system-codes/shipping 가격편집)와 충돌 없음 — input 핸들러가 자체 처리하고 document 리스너는 별개 동작(둘 다 실행될 수 있으나 input ESC는 setState만, 모달 닫기는 별개라 실害 검토). **Bob: SalesDetailDrawer 내 인라인 편집(editingDetails 폼 안 input) ESC가 드로어까지 닫는 이중발화 가능 → 허용(편집 input ESC는 setEditingDetails(false), 동시에 드로어 isDirty=editingDetails였으나 이미 false로 바뀜 타이밍 주의). 우선 동작 확인하고 문제되면 REVIEW에 플래그.**

## Flag (Bob 추측 금지)
- DB/마이그/schema.ts/tools.ts 변경 **없음** — 확인됨. 'use client' 컴포넌트만 수정.
- 새 npm 패키지 없음.
- confirm 문구 한국어 고정.
