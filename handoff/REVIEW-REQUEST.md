# Review Request — phone2 (전화번호2) 추가

Date: 2026-06-02
Ready for Review: YES

## Build 결과
`npm run build` → ✓ Compiled successfully in 6.1s (에러/경고 없음)

## Files Changed
- src/app/(dashboard)/customers/CustomerModal.tsx
  - interface Customer 에 `phone2?: string | null` 추가
  - formData 초기값 `phone2: customer?.phone2 || ''` (편집 prefill)
  - "연락처 *" 블록 바로 아래 "전화번호2" 입력(optional, type=tel, formatPhone 적용, 검증 없음)
  - form.append('phone2', formData.phone2) — 빈문자 그대로 전송(NULL 정규화는 actions)
- src/lib/actions.ts (createCustomer) — customerData 에 `phone2: (formData.get('phone2') as string)?.trim() || null` 추가
- src/lib/actions.ts (updateCustomer) — 동일 추가. 폴백 retry 패턴 없음(070 적용 전제).
- src/app/api/customers/search/route.ts — **fallbackSearch 폴백 경로만** 변경
  - orFilters 에 `phone2.ilike."%${sQ}%"` 추가, phonePatterns 루프에 `phone2.ilike` push
  - select 3곳(fetchDefaultList / fallback directResults / productOnly)에 `phone2` 추가
  - directResults reasons 에 phone2 매칭 push (field 'phone' 재사용)
  - RPC 호출부(supabase.rpc 'search_customers_full') **미변경**
- src/app/(dashboard)/customers/[id]/page.tsx
  - interface CustomerDetail 에 `phone2: string | null` 추가
  - 헤더 phone 표시 옆에 `{customer.phone2 && <span> · {formatPhone(customer.phone2)}</span>}`
  - 상세 customer select 는 `*` 사용(L209)이라 select 변경 불필요 — phone2 자동 포함

## 상세 헤더: 포함됨(스킵 안 함)
구조 명확(customer select 가 '*' + formatPhone import 기존 존재)해서 적용. phone2 도 formatPhone 으로 표기.

## Open Questions
- 없음. 브리프 명세 그대로 구현.

## Out of Scope (건드리지 않음)
- DB 마이그 072 / RPC search_customers_full·search_customers_unified — Arch 직접
- route.ts RPC 호출부
- src/lib/ai/schema.ts (070 동기화 전제)
- phone2 unique 제약, 고객 병합, 엑셀 백필/임포터, 포장옵션, legacy, POS phone2 노출

## Escalation
- 없음
