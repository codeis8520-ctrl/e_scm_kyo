# Review Request — Sprint A (송장 보내는분=구매자명 + 품목명 제거)
Date: 2026-06-16
Ready for Review: YES

## Files Changed
- src/app/(dashboard)/shipping/page.tsx:146 — cafe24DefaultSender useState 선언 제거(write-only가 되어 dead). 기존 L147~152 블록 삭제.
- src/app/(dashboard)/shipping/page.tsx:712~720 — handleLoadCafe24Orders 내 setCafe24DefaultSender(data.default_sender) 호출 제거. data.default_sender는 더 이상 소비자 없음.
- src/app/(dashboard)/shipping/page.tsx:768~780 — handleAddSelectedOrders: `const sender = cafe24DefaultSender;` 제거, createShipment의 sender_name/phone을 `order.orderer_name||''`/`order.orderer_phone||''`로, 주소 3인자는 undefined 유지.
- src/app/(dashboard)/shipping/page.tsx:438 — downloadCjExcel rows F(품목명) `s.items_summary || ''` → `''`. G(내품명) `KX-${...}` RTC 코드 무변경.

## Self-review
- Richard가 먼저 볼 것: cafe24DefaultSender 완전 제거가 안전한가 → setter(L721)와 read(L780) 둘 다 제거 후 grep 0건 확인. data.default_sender 페치 결과만 미사용으로 남고 다른 소비자 없음.
- Brief 요구사항: A1(보내는분=구매자) ✓, 주소 인자 미변경(undefined) ✓, A2(F 비움, G 유지) ✓, header/컬럼 13개 불변 ✓, guardSenders 확인만 ✓, Out of Scope 미터치 ✓.
- 빈/실패 케이스: orderer_name/orderer_phone은 타입상 non-optional string(L36~37)이나 `|| ''` 폴백 유지. sender 주소 빈값이어도 export의 resolveSenderForRow가 출고지점 발송지로 채우므로 guardSenders 통과. CJ F열 빈칸은 의도된 동작.
- npm run build: ✓ Compiled successfully in 6.1s, 경고/에러 0, cafe24DefaultSender 잔존 참조 0.

## Open Questions
- 없음.

## Out of Scope (logged in BUILD-LOG)
- 기존 빈 sender 카페24 shipment 자동 폴백 안 함(운영 워크어라운드로 처리).
- 품목명 짧은 이름 대체 = Sprint B.
- exportSelectedToExcel·배송 리스트 items_summary 노출 유지.
