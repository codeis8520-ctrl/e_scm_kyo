# Review Request — #51 재고현황 클릭 기본 '자가 사용' · '강제 조정' 분리
Date: 2026-06-19
Ready for Review: YES

## Files Changed
- src/app/(dashboard)/inventory/StockUsageModal.tsx:22-29,38-65 — `defaultProductId?` prop 추가 + rows useState 초기화 시 클릭 제품 1행(qty 1) 자동 생성. branchLocked·다건·정수제약 무변경.
- src/app/(dashboard)/inventory/page.tsx:90-91 — usagePreselect 상태 추가.
- src/app/(dashboard)/inventory/page.tsx:286-301 — handleAdjust 주석(상단버튼 전용) + handleUsageClick 신설.
- src/app/(dashboard)/inventory/page.tsx:529-543 — 상단 버튼: '+ 자가 사용'(btn-primary) + '⚠ 강제 조정'(bg-red-600, isHQUser).
- src/app/(dashboard)/inventory/page.tsx:783-818 — 데스크톱 매트릭스 셀: usageBlocked RBAC + handleUsageClick + title 분기. (구 adjustBlocked/handleAdjust 제거)
- src/app/(dashboard)/inventory/page.tsx:828-830 — 데스크톱 힌트 문구 갱신.
- src/app/(dashboard)/inventory/page.tsx:879-940 — flat(지점별) 관리열: usageBlocked + '자가 사용'(파랑)·'⚠ 강제 조정'(빨강) 2버튼.
- src/app/(dashboard)/inventory/page.tsx:971-984 — StockUsageModal 마운트에 defaultProductId/defaultBranchId 전달 + onClose/onSuccess usagePreselect 초기화.
- src/app/(dashboard)/inventory/InventoryModal.tsx:170-180 — 제목 '⚠ 강제 조정' + red 경고 배너(로직 무변경).
- src/lib/ai/schema.ts:172-173 — 자가사용(지점직원 자기지점)·강제조정(본사 전용) 접근규칙 보강.

## RBAC 적용
- usageBlocked = materialBlocked || (isBranchUser && 셀지점≠본인지점) || 현재고≤0. 데스크톱 셀·flat 행 동일.
- 강제 조정(handleAdjust/InventoryModal)은 isHQUser 전용 유지, 셀에서 분리.

## Open Questions
- 본사용 StockUsageModal에 branches 전체 목록 전달(잠금되므로 무방). 클릭 지점만 필터링하는 편이 나은지 — 현재는 전체.

## Out of Scope (logged in BUILD-LOG)
- 소수재고 제품 자가사용 소수 수량 입력(현행 정수≥1만). 별도 요청 필요.
