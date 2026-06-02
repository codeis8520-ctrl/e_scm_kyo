# Architect Brief — phone2 (전화번호2) 추가

## Goal
고객 등록/수정 폼에서 두 번째 전화번호(phone2)를 입력·저장하고, 고객 검색에서 phone 또는 phone2 중 아무 번호로도 찾을 수 있게 한다.

## Build Order (Bob 담당 — 프론트 + 액션만. DB RPC 072 는 Arch 직접)

### 1. CustomerModal.tsx — `src/app/(dashboard)/customers/CustomerModal.tsx`
- `interface Customer`에 `phone2?: string | null;` 추가.
- `formData` 초기값에 `phone2: customer?.phone2 || ''` (편집 시 prefill).
- "연락처 *" 입력 블록 **바로 아래** 새 블록: label "전화번호2"(optional), `type="tel"`, value=`formData.phone2`, onChange 에 phone 과 동일 `formatPhone(...)` 적용, placeholder "010-0000-0000". 검증 없음.
- 직렬화 form.append 구간: `form.append('phone2', formData.phone2);` 추가(빈문자 그대로, NULL 정규화는 actions).

### 2. actions.ts — createCustomer / updateCustomer
- customerData 에 `phone2: (formData.get('phone2') as string)?.trim() || null,` 추가(빈문자→NULL).
- 폴백 retry 패턴 불필요(070 적용됨). 추가하지 말 것.

### 3. route.ts (검색) — `src/app/api/customers/search/route.ts` — TS **폴백 경로만**
- ⚠️ 운영 기본 경로는 RPC(Arch 가 072 로 처리). 여기선 폴백·일관성용만.
- fallbackSearch directResults orFilters: `phone.ilike` 옆에 `phone2.ilike."%${sQ}%"` 추가, phonePatterns 루프에도 `phone2.ilike."%${sp}%"` push.
- select 들(fetchDefaultList / directResults / productOnly): `phone` 뒤에 `, phone2` 추가(응답 포함).
- reasons: phone2 매칭도 reason push(field 'phone' 재사용).

### 4. 고객 상세 헤더 — phone2 보조 표기 (가벼움)
- 고객 상세 페이지 헤더 phone 표시 옆에 `{customer.phone2 && <span>· {customer.phone2}</span>}`. 해당 select 에 phone2 추가. 구조 애매하면 스킵 + REVIEW-REQUEST 사유.

## Out of Scope (Bob 건드리지 말 것)
- DB 마이그/RPC search_customers_full·search_customers_unified — **Arch 직접(마이그 072)**. route.ts RPC 호출부 변경 금지.
- src/lib/ai/schema.ts — 070 에서 phone2 동기화됨. 손대지 말 것.
- phone2 unique 제약, 고객 병합, 엑셀 백필/임포터, 포장옵션, legacy, POS phone2 노출.

## Acceptance
- `npm run build` 통과.
- 신규 등록: phone2 입력 → 저장 → 편집 재오픈 prefill.
- phone2 빈칸 → DB NULL.
- (폴백 경로) phone2 번호 검색 시 노출.
- 상세 phone2 보조 표기(스킵 시 사유).

## Arch 직접 처리 (Deploy Gate)
마이그 072: `search_customers_full`(+`search_customers_unified`) 의 direct_matches 에 phone2 ILIKE 매칭(phone 패턴·digits 비교 동일) 추가, CREATE OR REPLACE 적용. 운영 검색에서 phone2 실제 매칭의 핵심.

## Review
쓰기 경로(고객정보) → Richard 리뷰 필수. RPC 072 도 리뷰 포함.
