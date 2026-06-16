# Architect Brief — Sprint B: 카페24 옵션조합 → 내부제품 매핑 (이카운트식 짧은 품목명)

Prior: Sprint A DONE/deployed (b9b236b). CJ export F열(품목명) 현재 '' 비움 상태 → 이 스프린트에서 되돌림.

## Goal
카페24 주문 품목을 (product_code + option_value 정규화)로 내부 product에 매핑하여, 송장(CJ F열)·배송화면 items_summary에 짧은 내부 품목명 표시. 미매핑은 원본정리(현행) fallback. 매핑 관리는 카페24 주문 탭 인라인.

## 스텝 분할 (LOCKED) — 2 step, 하나씩 배포
- **Step 1 (이 브리프)**: 마이그082(Arch 소유) + orders/route 매핑 적용 + CJ export F열 복원 + 신규 서버액션 3종 + AI Sync. (인라인 UI 없이도 동작: 매핑 없으면 fallback, 매핑 행은 DB에 직접 있으면 반영.)
- **Step 2 (다음 브리프)**: 카페24 주문 탭 인라인 매핑 UI(행 확장·제품검색·연결/해제). Step 1 배포·로그 후 착수.
- **이 브리프 = Step 1만.** Step 2 빌드 금지.

## 정규화 규칙 (LOCKED — 매핑 키 일관성의 핵심)
`normalizeOptionValue(raw)`: cafe24 item의 **원본 option_value 문자열**(예 "보자기포장=선택안함&쇼핑백=선택안함") 기준.
1. null/undefined → `''`.
2. URL 인코딩 디코드: 각 토큰에 `safeDecode`(기존 route.ts L9) 적용.
3. `&`로 split → 각 `key=value` 페어. eq 없으면 토큰 전체.
4. value가 `isNoSelection`(기존 L13: 공백제거 후 '선택안함') → 그 페어 **제거**(키도 버림). value 빈문자 → 제거.
5. 남은 페어를 `key=value`(원형 유지, key·value 각각 trim, 내부 공백 보존) 형태로.
6. **정렬: key 기준 사전순(localeCompare)** — 카페24 응답 순서 흔들림 무효화.
7. `&`로 join → 최종 정규화 키. (모든 옵션 무선택이면 `''`.)
- **이 정규화 함수는 매핑 저장(서버액션)·조회(orders/route) 양쪽에서 동일 모듈을 import**해 써야 함. 키 불일치 = 매핑 영구 실패. → 헬퍼를 `src/lib/cafe24/types.ts`에 export(firstPositiveAmount 선례, route+actions 양쪽 import 가능).
- 주의: 기존 `extractItemOptions`(표시용, "선택안함" 제거+"key: value" 포맷)와 **별개**. 정규화 키는 매칭 전용(저장값과 byte 동일해야). 표시명은 extractItemOptions 유지.

## Build Order

### 1) 마이그082 — Arch 소유, Bob 작성 금지
- 파일: `supabase/migrations/082_cafe24_product_map.sql` (Arch가 별도 작성·적용).
- 테이블 `cafe24_product_map`: id uuid pk, cafe24_product_code text not null, option_value text not null default '', product_id uuid not null references products(id) on delete cascade, created_at timestamptz default now().
- `UNIQUE(cafe24_product_code, option_value)`. 인덱스 동 컬럼.
- RLS enable + GRANT select/insert/update/delete to anon, authenticated (064/079 패턴).
- **Bob: 이 파일 작성하지 말 것.** select-only로 동작하는 코드 작성(미적용 상태에서 build 통과해야 — 테이블 없으면 빈 결과 폴백, 크래시 금지).

### 2) 정규화 헬퍼 — `src/lib/cafe24/types.ts`
- `export function normalizeOptionValue(raw: any): string` — 위 LOCKED 규칙. safeDecode/isNoSelection 로직은 이 함수 내부에 자급(route.ts 비export라 복제 허용, 단 동작 동일).

### 3) 매핑 적용 — `src/app/api/cafe24/orders/route.ts`
- L283 `orders` 빌드 **이전에** 매핑 일괄 조회(N+1 금지):
  - 모든 detailOrder.items에서 `(product_code, normalizeOptionValue(option_value))` 페어 수집(중복 제거).
  - `cafe24_product_map` 1회 조회 → `(product_code, option_value)→product_id` Map. 필요한 product_id들로 `products` 1회 조회(id→name) Map. **테이블 없거나 error → 빈 Map**(폴백, 크래시 금지, try/catch 또는 error 무시).
- item별 매핑 해소 헬퍼: `(item) => mappedName | null`.
  - product_code 추출: cafe24 item의 `product_code`(없으면 `product_code` 폴백 후보 — i.product_code ?? '' ). 정규화 키 = normalizeOptionValue(i.option_value).
- **itemsSummary 재빌드(L300~307)**: 각 item — 매핑 name 있으면 `${mappedName} x${qty}`, 없으면 현행 `extractItemOptions` 경로(opt 있으면 `name [opt] xqty`, 없으면 `name xqty`). join(', ') 동일.
- **order_items[] 확장(L341~346)**: 기존 {name,quantity,price,option}에 **추가** — `product_code: string`, `option_value: string`(정규화된 키), `mapped_name: string | null`(매핑 시 내부 product.name, 아니면 null). Step 2 인라인 UI용. interface(L63)도 동기 확장.

### 4) CJ export F열 복원 — `src/app/(dashboard)/shipping/page.tsx`
- `downloadCjExcel` L431: `s.delivery_message || '', '',` 의 **두번째 ''(=F열 품목명)** → `s.items_summary || ''`로 교체.
- G열(L432 `KX-...` RTC) **불변**. header·컬럼13개·순서 무변경.

### 5) 신규 서버액션 — `src/lib/cafe24-actions.ts`
- `createCafe24ProductMap({ cafe24_product_code, option_value, product_id })`: requireSession + **role 화이트리스트 ['SUPER_ADMIN','HQ_OPERATOR']**(adjustInventory 패턴, session.role 검사). option_value는 호출자가 정규화한 값 그대로 저장(또는 내부에서 normalizeOptionValue 재적용 — **내부 재적용 LOCKED**, 키 일관성 보장). upsert on conflict(cafe24_product_code,option_value) → product_id 갱신. 반환 {success}|{error}.
- `listCafe24ProductMaps()`: requireSession. 전체 매핑 + product name join 반환. (Step 2 UI에서 사용, Step 1에선 export만 해두면 됨.)
- `deleteCafe24ProductMap({ cafe24_product_code, option_value })`: requireSession + 동일 role 화이트리스트. 해당 행 삭제.
- 셋 다 `createClient() as any` + try/catch. revalidate 불필요(주문 재조회로 반영).

### 6) AI Sync (CLAUDE.md 절대규칙)
- `src/lib/ai/schema.ts` DB_SCHEMA: `cafe24_product_map` 테이블 추가(컬럼+UNIQUE 주석).
- BUSINESS_RULES: 1줄 — "카페24 품목(product_code+옵션조합 정규화) → 내부 product 매핑, 송장/배송 짧은 품목명(이카운트식). 미매핑은 원본 옵션정리 표시."
- tools.ts: 신규 도구 추가 **안 함**(이 매핑은 UI/송장 표현 전용, 에이전트 호출 불요). 영향 검토 결과 무변경 — BUILD-LOG에 명시.

## Flag (Bob이 추측 금지)
- 정규화 함수는 **단일 출처**(types.ts). route와 actions 양쪽이 동일 결과 내야 함. actions의 createCafe24ProductMap은 저장 직전 normalizeOptionValue 재적용(LOCKED).
- 마이그082 미적용 상태에서 `npm run build` + 런타임 통과 필수(테이블 없으면 빈 Map 폴백, order_items 폴백 동작).
- session.role 접근 방식: 기존 코드의 SessionUser/requireSession 반환 형태를 grep해서 확인 후 사용(adjustInventory in actions.ts가 선례).

## Out of Scope (→ BUILD-LOG Known Gaps)
- 인라인 매핑 UI = **Step 2**. 이번엔 데이터/적용/액션/export만.
- 기존 저장된 shipment.items_summary 소급 갱신 안 함(주문 재조회·재추가해야 매핑 반영). 명시.
- exportSelectedToExcel '품목' 컬럼·배송리스트 items_summary 표시 = 신규 추가분만 자동 매핑반영, 과거 무손상.
- product_code가 빈 카페24 품목(있을 수 있음) → 매핑 키 (''+opt)로 동작하나 실질 매핑 불가, fallback 유지.

## Acceptance
- `npm run build` ✓ (마이그082 미적용 상태에서도).
- 매핑 행을 cafe24_product_map에 직접 넣고(082 적용 후) 카페24 주문 불러오기 → 해당 품목 items_summary가 내부 product.name(짧음)으로 표시.
- 미매핑 품목 → 현행 원본정리 표시 유지(회귀 없음).
- 배송 추가 → shipment.items_summary = 매핑반영. CJ export F열 = items_summary 출력, G열 RTC 유지.
- normalizeOptionValue: 옵션 순서 뒤바뀐 동일 조합이 같은 키 산출(단위 확인). 전부 '선택안함' → ''.
- createCafe24ProductMap: 비-HQ role 거부.
