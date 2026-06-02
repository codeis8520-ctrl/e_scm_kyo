# Review Feedback — Step: phone2 (전화번호2) 추가
Date: 2026-06-02
Ready for Builder: YES

## Must Fix
- 없음.

## Should Fix
- 없음 (블로킹 아님). 참고: search_customers_full 의 match_reasons 에서 phone·phone2 값이 서로 다르고 둘 다 매칭되면 {field:'phone'} reason 이 2개 나옴. route.ts 폴백도 동일하게 field 'phone' 재사용 → 표시 일관됨. 정상 동작, 결함 아님.

## Escalate to Architect
- 없음.

## Cleared
072(search_customers_full + search_customers_unified) 를 040 원본과 라인 대조 — phone2 LATERAL/CASE/WHERE/filtered SELECT/출력 jsonb/trgm 인덱스/GRANT 만 추가했고 기존 로직(name·phone·email·address·product 매칭, 페이징, total_points LATERAL, grade/branch 필터, match_reasons 구조, SECURITY DEFINER) 전부 보존. CREATE OR REPLACE 시그니처 동일(오버로드 위험 없음), phone2 NULL 안전(ILIKE/regexp_replace NULL→매칭 안 됨→x.val IS NOT NULL 으로 제외), phone2 만 매칭되는 고객도 direct_matches→merged→filtered 로 포함됨. route.ts 는 RPC 호출부 미변경·폴백 경로에만 phone2 추가(orFilters·phonePatterns 푸시 escape 동일, select 3곳 phone2 포함, reasons push 정상). CustomerModal phone2 optional+prefill+formatPhone, actions .trim()||null(빈문자→NULL, unique 아님), 상세 헤더 조건부 보조표기. 쓰기 경로 권한 우회·GRANT 권한 확대 없음. schema.ts/병합/백필/legacy/포장 미접촉. Build ✓.
