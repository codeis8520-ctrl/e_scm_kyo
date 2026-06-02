# ARCHITECT-BRIEF — POS 판매등록 위젯 표시 속성 (pos_widget)

## 목표
제품마다 "판매등록 위젯 표시" 여부 속성을 둔다. 기본값 = 완제품(FINISHED) & 비-세트(is_phantom=false)만 위젯 노출. 세트(phantom)·RAW·SUB·SERVICE 는 위젯 미노출이되 **검색으로는 등록 가능**. 제품 편집 화면에서 토글 가능.

## 범위 밖 (손대지 말 것)
- POS 과거 구매(legacy) 이력 표시 (#1, 다음 스프린트)
- 포장(쇼핑백/보자기) 옵션화 (#2b, 설계 미정)
- legacy_* 테이블

## 확인된 사실 (Arch DB 검증)
- products: product_type(FINISHED/SUB/RAW/SERVICE), is_phantom(boolean). 활성: FINISHED non-phantom 63 / FINISHED phantom 154 / RAW 58 / SUB 155 / SERVICE 5. 세트=phantom.
- POS 제품 로드: src/app/(dashboard)/pos/page.tsx 약 L349-372 — select(...,product_type) 후 in-memory product_type !== 'RAW' && !== 'SUB' 필터(마이그042 폴백 포함). 이 리스트가 그리드+검색 공용 소스. 그리드 표시 분기는 filteredProducts(약 L613).

## Bob 작업 (5개 파일)
1. **supabase/migrations/071_products_pos_widget.sql**
   - `ALTER TABLE products ADD COLUMN IF NOT EXISTS pos_widget boolean NOT NULL DEFAULT false;`
   - 백필: `UPDATE products SET pos_widget = (product_type='FINISHED' AND COALESCE(is_phantom,false)=false);`
   - COMMENT ON COLUMN. 인덱스 없음(활성 ~435행, 불필요).
2. **제품 편집 UI** (grep 으로 ProductModal.tsx 등 폼 컴포넌트 확정): interface 에 `pos_widget` 추가, 초기값(편집=기존값, 신규=완제품&비세트→true). track_inventory 체크박스 옆에 "판매등록 위젯 표시" 체크박스 추가 — **모든 product_type 에서 노출**(세트도 수동 on 가능). 직렬화는 기존 formData 패턴 사용.
3. **src/lib/actions.ts** `createProduct`/`updateProduct`: 폼값 우선, 부재 시 규칙(FINISHED&비phantom) 폴백. 기존 `delete productData.xxx`(마이그 미적용) 폴백 패턴에 `pos_widget` 동일 적용.
4. **pos/page.tsx**: select 에 `pos_widget` 추가. `filteredProducts`(약 L613) 분기 — **검색어 없으면 pos_widget===true 만 그리드, 검색어 있으면 name/code 매칭 전체(세트 포함)**. 로드 리스트(RAW/SUB 제외 전체)는 유지(검색 소스). 컬럼 부재 폴백=전부 노출. productMap·Enter 등록 경로 무변경.
5. **src/lib/ai/schema.ts** products 라인에 `pos_widget` 추가.

## 락된 결정
- 컬럼명 `pos_widget`, NOT NULL DEFAULT false, 백필 = FINISHED & 비-phantom.
- 그리드/검색 분리: 한 로드 리스트 유지, 표시단계 분기(검색어 유무).
- 마이그 071 미적용 폴백 전 구간 보존.
- 마이그 071 적용·검증은 Arch(오케스트레이터)가 psycopg 로 직접. Bob 은 .sql 작성만, DB 적용 금지.

## 제약
- Bob: DB 적용 금지(.sql/.ts/.tsx 작성만). 범위 밖 손대지 말 것. schema.ts 변경 후 `npm run build` 통과 확인.
- 보안/판매경로 변경 가능성 → Richard 리뷰 필수.
