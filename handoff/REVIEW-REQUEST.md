# Review Request — POS 큐 #1: 과거구매(legacy) 복사 → 새 판매 등록 (Phase 1 MVP)
Date: 2026-06-02
Ready for Review: YES

## Build 결과
- `npm run build` → ✓ Compiled successfully in 8.6s. 에러/경고 0. `/pos`·`/customers/[id]` 모두 컴파일됨.

## Files Changed

### src/app/(dashboard)/pos/page.tsx
- L172 — `legacyCopyId = searchParams?.get('legacyCopy')` 추가 (copyOrderId 옆).
- L174-181 — `unmatchedLegacyItems` state 신설 (브리프 타입 그대로).
- 신규 `applyLegacyCopy` useCallback — 기존 `applyCopy` 바로 아래 신설(applyCopy 수정 없음). legacy_orders 페치 → 매출처/출고지/고객 prefill → 품목 `products.name.trim()===item_text.trim()` 정확매칭만 CartItem 생성(price=현재 prod.price, deliveryType=recipient 있으면 PARCEL 아니면 PICKUP), 미매칭은 unmatched 보존 → setCart(newCart) → 발송정보 setShipping(PARCEL, zipcode/detail '')/없으면 NONE → 날짜·승인 초기화 → setMainTab('checkout') → setUnmatchedLegacyItems → setCopyBanner. confirm 없음(버튼 onClick에서).
- 신규 useEffect — `?legacyCopy=` 1회 적용 후 `router.replace('/pos')`. 기존 copy useEffect 옆, abort 가드 동일.
- resetCheckoutForm 내 `setUnmatchedLegacyItems([])` 추가(판매완료/초기화 시 비움). clearCustomer는 미접촉(복사 후 유지).
- 참고 패널 — 장바구니 목록 div 바로 아래(`length>0`일 때만). 헤더 "참고: 과거 주문 미매칭 품목 (N개)" + ✕(비움). 각 줄 item_text/option_text/수량/원본금액(total_amount ?? unit_price_vat) + 🔍 "제품 찾기"(setSearch+searchRef.focus, 그게 전부).
- POS 내부 "과거 구매" 탭 카드 — isOpen 블록 하단 footer "📋 이 주문 복사" 버튼(toggleLegacy button 밖). cart 있으면 대체 경고 confirm → `applyLegacyCopy(o.id)` 직접 호출(URL 미경유).

### src/app/(dashboard)/customers/[id]/page.tsx
- L1267 legacy 카드 footer — 기존 legacy_order_no 행을 좌(📋 복사)·우(order_no) 배치로 변경. onClick confirm → `router.push('/pos?legacyCopy='+o.id)`. useRouter 기존 import 재사용.

## 정확매칭 키 / 가격 규칙 (Locked Decision 준수)
- 매칭 = `String(p.name).trim() === String(it.item_text ?? '').trim()` 단일. item_code/유사도/정규화 전부 미사용.
- 매칭가 = 현재 `products.price`. 원본 단가(unit_price_vat/total_amount)는 참고 패널에만 표시.

## Open Questions
- 동명복수 제품 시 `products.find` 첫 매칭(브리프 명시). 별도 처리 안 함.

## Out of Scope (브리프 준수 확인)
- processPosCheckout/checkout 로직 diff 0 (절대 미변경). Richard 필수 확인 요청.
- applyCopy 수정 0, selectCustomer/addToCart/ShippingForm/setShipping 등 재사용 함수 시그니처 미변경.
- 학습형 별칭맵·유사도·포장옵션·legacy_purchases·자동제거 미접촉. DB 마이그·schema.ts 미변경.
