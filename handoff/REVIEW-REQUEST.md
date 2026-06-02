# Review Request — POS 판매등록 위젯 표시 속성 (pos_widget)
Date: 2026-06-02
Ready for Review: YES

## Files Changed

- `supabase/migrations/071_products_pos_widget.sql` (신규, 전체) — pos_widget boolean NOT NULL DEFAULT false 추가 + 백필(product_type='FINISHED' AND COALESCE(is_phantom,false)=false) + COMMENT. 인덱스 없음. **DB 미적용 — Arch 가 psycopg 로 적용·검증.**

- `src/app/(dashboard)/products/ProductModal.tsx`
  - L29 — interface 에 `pos_widget?: boolean` 추가.
  - L68-72 — formData 초기값: 편집=`product?.pos_widget` 우선, 신규=완제품&비세트→true.
  - L460-476 — track_inventory 체크박스 바로 아래 "판매등록 위젯 표시" 체크박스(모든 product_type 노출, disabled 없음).
  - 직렬화: 기존 `Object.entries(formData)` 루프(L312)가 boolean 을 `String(value)` 로 자동 append → 별도 코드 불필요.

- `src/lib/actions.ts`
  - createProduct L73-77 — `posWidget`: 폼값 우선, 부재 시 `productType==='FINISHED' && !isPhantom` 폴백.
  - createProduct L102 — productData 에 `pos_widget: posWidget`.
  - createProduct L107-112 — 마이그 071 미적용 폴백(`/pos_widget/` 매칭 시 delete 후 retry), 기존 pack_child/is_phantom/track_inventory 폴백 앞에 배치.
  - updateProduct L188-192 — `posWidget`: 폼값 우선, 부재+product_type 명시 시 규칙 폴백, 그 외 undefined(미변경).
  - updateProduct L221 — `...(posWidget !== undefined ? { pos_widget: posWidget } : {})`.
  - updateProduct L228-232 — 마이그 071 미적용 delete-retry 폴백.

- `src/app/(dashboard)/pos/page.tsx`
  - L349-368 — loadTier1 select 에 `pos_widget` 추가 + 2단 폴백(071 미적용→pos_widget 제거, 042 미적용→product_type 까지 제거). 기존 RAW/SUB in-memory 필터·productMap·로드 경로 무변경.
  - L619-622 — filteredProducts 분기: `search.trim()` 있으면 name/code 매칭 전체, 없으면 `pos_widget===undefined || ===true`(컬럼 부재 폴백=전부 노출).

- `src/lib/ai/schema.ts`
  - L7 — products 라인 `pos_widget(bool, …)` 추가.

## Self-review

- **Richard 가 먼저 볼 지점**: pos select 폴백 순서. 071 미적용 시 첫 select 가 에러 → pos_widget 제거 재시도(product_type 유지) → 그래도 에러면 042 폴백. pos_widget 값이 row 에 없으면 `p.pos_widget === undefined` → 그리드 전부 노출(안전).
- **모든 요구사항 구현 확인**: (1) 마이그 ✓ (2) UI 체크박스 모든 유형 노출 + 초기값 ✓ (3) actions 폼값 우선+규칙 폴백+미적용 폴백 ✓ (4) pos select+filteredProducts 분기+폴백, productMap/Enter 경로 보존 ✓ (5) schema.ts ✓.
- **데이터 부재/실패 시 사용자 화면**: 마이그 071 미적용 환경에서도 POS 그리드는 전부 노출(기존 동작 유지), 제품 저장은 delete-retry 로 성공. raw 에러 노출 없음.

## Build
`npm run build` → `✓ Compiled successfully in 7.5s`. 타입/문법 통과.

## Open Questions
- 없음.

## Out of Scope (logged in BUILD-LOG)
- 없음 (legacy 이력 표시·포장 옵션화·legacy_* 테이블 미접촉).
