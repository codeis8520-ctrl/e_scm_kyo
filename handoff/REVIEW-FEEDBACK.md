# Review Feedback — POS 큐 #1: 과거구매(legacy) 복사 → 새 판매 (Phase 1 MVP)
Date: 2026-06-02
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
없음.

## Escalate to Architect
없음.

## Cleared
2파일(pos/page.tsx, customers/[id]/page.tsx) diff 전체 리뷰 — 7개 점검항목 모두 통과.

### 점검 결과
1. **checkout 무변경(보안 핵심)** ✅ — processPosCheckout 은 import(L8)·호출(L1081)만 존재, diff에 없음. 판매등록/재고차감/포인트 경로 0변경. applyLegacyCopy 는 prefill(setCart/setShipping/탭전환)까지만 — 자동 submit 없음. 기존 applyCopy(L487~) diff 0(별도 신설).
2. **품목 매칭** ✅ — `String(p.name).trim()===String(it.item_text??'').trim()` 단일키, item_code/유사도 미사용. CartItem 필드(productId/name/price/quantity/discount/barcode/deliveryType) 기존 형태 일치. 매칭가=현재 prod.price(Number 가드). quantity `Number(it.quantity)||1` NaN/0 가드 정상. 미매칭은 unmatched 원본 보존.
3. **발송정보 prefill** ✅ — recipient_* → setShipping(type PARCEL, zipcode/detail ''), recipient 없으면 NONE. setAddressFromRegistry(false) 호출. 컬럼명(recipient_name/phone/address) 기존 쿼리(customers L233·pos L842)와 동일.
4. **state 리셋/루프** ✅ — resetCheckoutForm 에 setUnmatchedLegacyItems([]) 추가(판매완료 비움). legacyCopy useEffect: loading 가드 + aborted 플래그 + router.replace('/pos') 로 1회 적용, deps [legacyCopyId, loading] — 무한루프 없음. 기존 ?copy= useEffect 와 독립(충돌 없음).
5. **버튼 중첩** ✅ — POS: toggle button(L1808~1833) 닫힘 뒤 isOpen 형제 div(L1834+) 안에 복사버튼(L1851). 고객상세: toggle button(~L1242) 뒤 isOpen div(L1244+) 안에 복사버튼(L1268). 둘 다 button-in-button 없음 → hydration 안전.
6. **🔍 제품 찾기** ✅ — setSearch(item_text)+searchRef.focus() 만. 새 모달/검색API 없음.
7. **범위 가드** ✅ — 2파일만 수정. 별칭맵/유사도/포장/legacy_purchases/DB마이그/schema.ts 미접촉. legacy는 읽기전용 select.
