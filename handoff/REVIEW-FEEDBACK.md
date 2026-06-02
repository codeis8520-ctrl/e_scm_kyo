# Review Feedback — 고객 검색 개선 (Enter 검색 + 콤마 AND + 안내문구)
Date: 2026-06-02
Ready for Builder: YES

## Must Fix
(없음)

## Should Fix
- route.ts fallbackSearchMultiToken (match_reasons field:'name') — 다중토큰 폴백의 reason 을 field:'name' 으로 넣었는데, page.tsx L405-406 의 extraReasons 필터가 field==='name'/'phone' 을 제외하므로 "검색: 이장우, 청담" 라벨이 화면에 안 뜬다. 깨지진 않음(크래시·레이아웃 영향 0). 단, 폴백은 RPC 미적용/실패 시에만 타는 희귀 경로 → 즉시조치 불필요. 라벨을 굳이 보이려면 field 를 'product' 등 표시 대상으로 바꾸거나 UI 필터에 예외 추가. Arch 의 Open Question 답변에 위임 가능.

## Escalate to Architect
- 다중토큰 폴백 match_reasons 표기 방식(필드 귀속 모호 → "검색: <토큰>" 한 줄) — Bob 의 Open Question. 현재 UI 에선 안 보이지만(위 Should Fix) 폴백 자체가 희귀 경로라 UX 영향 미미. 표기 정책은 제품 결정이라 Arch 가 확정.

## Cleared
검토 대상: page.tsx(state 분리·디바운스 완전 제거·Enter/🔍 커밋·X 클리어·안내문구), route.ts(콤마 AND 교집합 matchOneToken/fallbackSearchMultiToken, 토큰 0/1개 기존경로 보존), 마이그 073(search_customers_full/_unified 콤마 AND).

검증 결과:
1) 단일어 회귀: 073 token_field/token_product + qualified(HAVING>=1) 가 072 direct_matches∪product_matches 와 동치. name/phone/phone2(→field 'phone')/email/address/product·숫자매칭·출력 jsonb 구조·created_at 정렬 모두 보존. 빈 검색어는 route.ts L32 `if(!q)`→fetchDefaultList 로 단락되어 RPC 에 빈 문자열 전달 안 됨(073 의 ARRAY[''] 폴백은 안전하나 앱 미진입). 회귀 0.
2) 콤마 AND: count(DISTINCT tok)>=ntok = 모든 토큰 만족(각 토큰은 필드 OR). tokens DISTINCT·btrim·빈값제외·중복토큰("a,a"→ntok=1) 정상. token_product 가 grade/branch 미필터여도 filtered WHERE 에서 재적용되어 결과 정확(과매칭 후 제거).
3) match_reasons: full merged jsonb_agg(DISTINCT {field,value}) → route FIELD_LABELS(name/phone/email/address/product) 호환, phone2→'phone' 매핑 일치.
4) SQL 안전성: 시그니처(5인자·jsonb·SECURITY DEFINER) 072 와 동일, GRANT anon/authenticated 유지, phone2 regexp_replace NULL 안전, unnest/string_to_array/CROSS JOIN LATERAL 정상, OFFSET/LIMIT·total·page 보존, $$ 단일 dollar-quote(중첩 없음)→psycopg 적용 안전.
5) 프론트: setTimeout/debounceRef 잔존 0(grep 확인), search/grade/hasConsult/sort 변경 시에만 fetch, searchInput onChange 는 fetch 미유발, Enter/🔍 버튼/X 동작 일치, q 초기복원(search·searchInput 둘 다 q), 안내문구·레이아웃(flex-1 max-w-lg) 적용.
6) 범위 가드: schema.ts·legacy·포장·병합·POS·RPC 호출부(supabase.rpc) 미접촉 확인.
