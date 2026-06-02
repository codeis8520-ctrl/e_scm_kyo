# Review Request — POS 큐 #1: 판매등록 고객패널 과거구매(legacy) 표시
Date: 2026-06-02
Ready for Review: YES

## Files Changed (단일 파일, 표시 전용, DB 변경 없음)
`src/app/(dashboard)/pos/page.tsx`
- L119~142 — `LegacyOrderItem`/`LegacyOrder` 타입 추가(customers/[id] L54~77과 동일 필드).
- L227~241 — history state 에 `legacyOrders: LegacyOrder[]`(초깃값 []), historyTab union 에 `'legacy'`, `expandedLegacy: Set<string>` state + `toggleLegacy` 토글 헬퍼.
- L703~735 — loadCustomerHistory: 진입부 `setExpandedLegacy(new Set())`, Promise.all 3번째 쿼리 legacy_orders(.limit(50), branch:branches(name) + legacy_order_items 중첩), setHistory 에 `(legacyRes.data || []) as LegacyOrder[]` 세팅. catch 도 `legacyOrders: []` 동기화. 기존 try/catch 재사용 — 신규 try/catch 없음.
- L828, L1088 부근 — clearCustomer/resetForm 의 setHistory 전체 리셋에 `legacyOrders: []` + `setExpandedLegacy(new Set())` 추가.
- 탭 버튼 — "구매 이력" 버튼 다음에 "과거 구매 ({history.legacyOrders.length})" 버튼(동일 className, 항상 노출).
- 본문 렌더 — historyTab 3분기 ternary로 확장(`consult ? : orders ? : legacy`). legacy 분기: 빈 상태 문구 + 컴팩트 주문 카드(헤더: 일자·지점배지/code·합계·품목수 / 발송지 줄: name·phone·address 각 '-', 셋다 빈값 "발송지 정보 없음" / 카드 클릭 펼침 → line_seq 순 품목 item_text·option_text·quantity·total_amount).

## setHistory 전수 확인 (Flag 항목)
`grep setHistory(` → 5건. L690 `{...prev, loading:true}`(부분, 영향 없음) + 전체 리셋 4건 전부 `legacyOrders: []` 동기화 완료.

## Build
`npm run build` → ✓ Compiled successfully in 6.9s. TS 에러 0. `/pos` 정상 컴파일.

## Self-review
- Richard 첫 지적 예상: 본문 ternary 중첩 가독성 → 기존 코드(consult/orders 2분기 ternary) 패턴 그대로 1단 확장이라 일관성 유지.
- Brief 요구사항 7항목 전부 구현 확인(타입·state·리셋3+1·페치·탭union·탭버튼·본문).
- 빈/실패 케이스: legacy 0건 → "과거 구매 이력이 없습니다." / 페치 실패 → 기존 함수 catch 로 빈 배열(조용히). 발송지 셋다 빈값 → "발송지 정보 없음".

## Open Questions
- 없음.

## Out of Scope (logged in BUILD-LOG)
- 복사→재판매 버튼, 포장옵션, legacy_purchases 드롭/임포터, schema.ts 수정, legacy 검색필터, 페이징 UI — 전부 미접촉.
