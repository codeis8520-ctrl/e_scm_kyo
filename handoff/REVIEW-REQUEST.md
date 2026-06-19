# Review Request — #46 배송메시지 ↔ 포장/옵션 분리
Date: 2026-06-19
Ready for Review: YES

## Files Changed
- src/app/(dashboard)/shipping/page.tsx:147-152 — composeDeliveryMessage 합성 제거, 순수 delivery_message만 반환(시그니처 단순화)
- src/app/(dashboard)/shipping/page.tsx:1585-1587 — 배송목록 thead에 '포장/옵션' th 추가(배송메모·품목 사이)
- src/app/(dashboard)/shipping/page.tsx:1625-1632 — 배송목록 tbody에 order_options td 추가(없으면 '-')
- src/app/(dashboard)/shipping/page.tsx:482-489 — CJ export header에 '포장/옵션' 맨 끝 추가
- src/app/(dashboard)/shipping/page.tsx:496-506 — CJ export rows에 s.order_options 원소 맨 끝 추가
- src/app/(dashboard)/shipping/page.tsx:508-513 — CJ export !cols 폭 배열 1개 추가(헤더/행/폭 14개 일치)
- src/lib/ai/schema.ts:74 — #40 주석에 #46 분리 한 줄 갱신

## Open Questions
- CJ '포장/옵션' 컬럼 = 맨 끝(Flag B, PO 확정). packer가 배송메세지1 옆에서 보길 원하면 Deploy Gate에서 위치 조정 가능. 코드상 위치만 바꾸면 됨.

## Out of Scope (logged in BUILD-LOG)
- 카페24 탭 원본 shipping_message 파싱 분리(cafe24 원본 데이터, split 마커 미보장)
- items_summary에 옵션 박힌 과거 historical 행(order_options NULL, 분리 불가)

## Build
- npm run build: 0 error.
