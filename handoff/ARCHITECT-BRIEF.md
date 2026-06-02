# Architect Brief — POS 큐 #1: 과거구매(legacy) 복사 → 새 판매 등록 (Phase 1 MVP)

## Goal
과거 주문(legacy) 1건의 "📋 복사" 버튼으로 POS 새 판매에 반영: 발송정보 100% 자동 prefill + 품목 이름 정확매칭만 자동 장바구니 담기 + 미매칭 품목은 참고 패널로 노출(수동 검색·추가). 학습형 매칭·별칭 UI 없음.

## 건드릴 파일 (2개, DB 변경 없음 — 읽기 전용)
1. `src/app/(dashboard)/pos/page.tsx` — 신규 `applyLegacyCopy`, `unmatchedLegacyItems` state + 참고 패널, `?legacyCopy=` 처리, POS 내부 legacy 카드 복사버튼.
2. `src/app/(dashboard)/customers/[id]/page.tsx` — legacy 카드에 복사버튼(POS로 `?legacyCopy=` 이동).

## Build Order

### A. POS `applyLegacyCopy(legacyOrderId)` (pos/page.tsx)
기존 `applyCopy`(L487~579) 바로 **아래에 신설**. applyCopy 수정 금지 — legacy는 product_id 없어 별도 경로.
- 페치: `legacy_orders.select('id, legacy_order_no, customer_id, recipient_name, recipient_phone, recipient_address, ordered_at, total_amount, branch_id, channel_text, legacy_order_items(line_seq, item_code, item_text, option_text, quantity, unit_price_vat, total_amount)').eq('id', legacyOrderId).maybeSingle()`.
  - legacy엔 recipient_zipcode/address_detail 없음 → ''. address는 recipient_address 통째로 `recipient_address`에(분리 금지). `if (!src) return;`.
- 고객: `src.customer_id` 있으면 `customers.find` → `await selectCustomer(cust)` (applyCopy L524-527 패턴).
- 매출처/출고지: `src.branch_id` 있으면 setSelectedBranch + setShipFromBranchId (applyCopy L519-522).
- **품목 정확매칭**:
  - `products` state에서 `String(p.name).trim() === String(it.item_text).trim()`. active 제품(products state 그대로, 별도 필터 금지).
  - **item_code 매칭 금지**(이름으로만). 동명복수면 find 첫 매칭.
  - 매칭 → CartItem: `productId: prod.id, name: prod.name, price: prod.price`(현재가), `quantity: Number(it.quantity)||1, discount:0, barcode: prod.barcode, deliveryType`(recipient 있으면 'PARCEL' 없으면 'PICKUP').
  - 실패 → `unmatchedLegacyItems`에 `{item_text, option_text, quantity, unit_price_vat, total_amount}` 보존.
- 카트: `setCart(newCart)` 대체. confirm은 **버튼 onClick**에서(applyCopy 패턴), 함수 내부 confirm 금지.
- 발송정보(applyCopy L547-565 패턴): recipient 있으면 `setShipping(prev=>({...prev, type:'PARCEL', recipient_name, recipient_phone, recipient_address, recipient_zipcode:'', recipient_address_detail:'', delivery_message:''}))` + `setAddressFromRegistry(false)`. 없으면 `setShipping(prev=>({...prev, type:'NONE'}))`.
- 마무리: `setOrderMemo('')`(빈문자 권장), `setReceiptDate(today)`, `setSaleDate(today)`, `setApprovalStatus('COMPLETED')`, `setMainTab('checkout')`, `setUnmatchedLegacyItems(unmatched)`, `setCopyBanner('📋 과거주문 복사 — 발송정보 복사됨 · 품목 N개 자동 / M개 수동 확인 필요')`.

### B. `unmatchedLegacyItems` state + 참고 패널 (pos/page.tsx)
- state: `useState<{item_text:string|null; option_text:string|null; quantity:number|null; unit_price_vat:number|null; total_amount:number|null}[]>([])`.
- 리셋: `resetForm`(판매완료/초기화)에서 `setUnmatchedLegacyItems([])`. clearCustomer에선 비우지 말 것(복사 후 유지 요구).
- 위치: 장바구니 카드 바로 아래. `length>0`일 때만.
- 내용: 헤더 "참고: 과거 주문 미매칭 품목 (N개)" + 비움(✕, `setUnmatchedLegacyItems([])`). 각 줄: item_text(굵게)/option_text(작게)/수량/원본금액(total_amount or unit_price_vat) + 🔍 "제품 찾기".
- 🔍 onClick: `setSearch(it.item_text||'')` + `searchRef.current?.focus()` 그게 전부. 새 모달/검색API 금지.
- 자동 제거 로직 금지(MVP). 비움 버튼만.

### C. `?legacyCopy=<id>` 처리 (pos/page.tsx)
- `const legacyCopyId = searchParams?.get('legacyCopy') || null;` (copyOrderId 옆).
- applyCopy useEffect(L582-591) 옆 별도 useEffect: `if(!legacyCopyId||loading) return;` → `await applyLegacyCopy(legacyCopyId)` → `router.replace('/pos')`. abort 가드 동일.

### D. POS 내부 legacy 카드 복사버튼 (pos/page.tsx)
- "과거 구매" 탭 카드 헤더는 `<button onClick={toggleLegacy}>`(L1705) → 버튼 중첩 금지. `isOpen` 블록(L1731~) 하단 footer 행에 "📋 이 주문 복사": `const warn = cart.length>0 ? '현재 장바구니가 복사된 과거주문으로 대체됩니다. 진행할까요?' : '이 과거 주문을 복사해 새 판매로 등록할까요?'; if(confirm(warn)) applyLegacyCopy(o.id);` (URL 경유 없이 직접).

### E. 고객상세 legacy 카드 복사버튼 (customers/[id]/page.tsx)
- legacy 카드 펼침 footer(L1267-1269, legacy_order_no 행, toggle button 밖이라 안전). 좌우 배치: 좌측 "📋 복사" + 우측 기존 legacy_order_no.
- onClick: `if(confirm('이 과거 주문을 복사해 새 판매로 등록할까요?\n수령자·주소는 자동 채워지고, 매칭 안 된 품목은 POS 참고 패널에 표시됩니다.')) router.push(\`/pos?legacyCopy=\${o.id}\`);` (sales_order 복사 L1133-1141 미러, useRouter 이미 import).

## 재사용(수정 금지)
applyCopy(L487, 참고만), selectCustomer(L762), addToCart(L680), setCart/CartItem(L108), shipping/setShipping/ShippingForm, setAddressFromRegistry, search/setSearch/searchRef, filteredProducts, setSelectedBranch/setShipFromBranchId, setMainTab/setApprovalStatus/setReceiptDate/setSaleDate, copyBanner/setCopyBanner, products, kstTodayString. customers/[id]: useRouter, expandedLegacy/toggleLegacy, legacyOrders.

## Locked Decisions
- 매칭 키 = item_text == products.name(trim) 단일. item_code/유사도/정규화 전부 금지.
- 매칭가 = 현재 products.price (원본 단가는 참고패널에만).
- 발송정보 = legacy recipient_* → shipping prefill, type=PARCEL(있을 때). zipcode/detail 없음 → ''.
- 기존 카트 대체(confirm은 버튼). 참고패널 복사 후 유지(자동 제거 없음).
- 🔍 = setSearch+focus. checkout(processPosCheckout) 절대 미변경.
- DB 마이그 없음. schema.ts 미변경.

## Out of Scope
학습형 별칭맵·유사도/정규화 매칭·별칭 UI(Phase 2/3), 포장옵션, legacy_purchases, 동명이품 고도화, 미매칭 자동제거, 원본단가로 카트가 덮기.

## Acceptance
- `npm run build` 통과.
- 고객상세 legacy "📋 복사" → /pos?legacyCopy= → 발송정보 자동 + 이름매칭 품목 자동 담김 + 미매칭 참고패널.
- POS 내부 legacy 카드 복사 → 동일(직접).
- 🔍 제품 찾기 → 검색창 item_text 채움 + 그리드 후보 → 수동 addToCart.
- 요약 배너 노출.
- processPosCheckout/checkout diff 0 (Richard 필수 확인).
