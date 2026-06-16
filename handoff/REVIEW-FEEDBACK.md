# Review Feedback — Sprint B Step 1 (카페24 옵션조합→내부제품 매핑 데이터층)
Date: 2026-06-16
Status: APPROVED

## Conditions
없음.

## Escalate to Arch
없음.

## Cleared
무결성 핵심(매핑 키 일관성) 검증 완료:

- **normalizeOptionValue 단일 출처(types.ts:144-165)** — LOCKED 규칙 정확. null/non-string→'', '&' split, eq 없으면 토큰 전체를 value, '선택안함'(공백제거)·빈값 페어 제거, key localeCompare 사전순 정렬, key=value(키없으면 value) '&' join. 결정론적·순서무관(정렬이 마지막). route.ts(조회 line 4 import, 323·357 사용)와 cafe24-actions.ts(저장 line 5 import, 176·228 사용) 둘 다 **동일 모듈 import** — 분기 재구현 없음.

- **mapKey 구분자 '\n' 일관성** — route.ts:314-315 mapKey(code, optValue)가 '\n'으로 결합. DB 행 적재(334) `mapKey(code, m.option_value)`와 조회(358) `mapKey(code, normalizeOptionValue(item.option_value))` 동일 tuple/구분자. 저장 경로(actions.ts:176)가 upsert 직전 정규화를 강제하므로 DB의 option_value는 이미 정규화 상태 → 양측 byte 일치. **NUL 바이트 잔존 0건 확인**(tr -dc '\000' | wc -c = 0, 3개 파일 모두). Bob의 self-fix 정상.

- **Graceful degrade** — route.ts:312-352 cafe24_product_map 1회 + products 1회 조회(N+1 없음), try/catch + error 무시 → 빈 Map 폴백. 미적용 테이블/조회실패 시 크래시 없이 itemsSummary가 extractItemOptions 현행 경로로 폴백(369-371).

- **itemsSummary** — 매핑 시 `${mappedName} x${qty}`(369), 미매핑 시 기존 경로 불변. order_items[] 인터페이스(types.ts:63-71 + route 응답 407-415)에 product_code/option_value(정규화)/mapped_name 추가. DEMO_ORDERS 3건(156·173·191) 신규 필드 충족. 기존 소비자 registerCafe24Customers(cafe24-actions.ts:56 별도 narrow 타입, .name/.quantity/.price만 사용) 구조적 타이핑상 미파손.

- **CJ export** — shipping/page.tsx:431 F열 `s.items_summary || ''` 복원, G열 RTC(432) `KX-...` 불변, 13컬럼 유지.

- **서버액션 RBAC** — create/delete 모두 requireSession + 화이트리스트 [SUPER_ADMIN, HQ_OPERATOR](153·166·222) 쓰기 전 강제. upsert onConflict 'cafe24_product_code,option_value'(184). delete 동일 게이트·정규화 키.

- **AI Sync** — schema.ts:141 cafe24_product_map 테이블(컬럼+UNIQUE 주석), schema.ts:280 BUSINESS_RULES [자사몰] 1줄. tools.ts 무변경 — 매핑은 표현 전용이라 적정.

참고(차단 아님): route.ts:334에서 DB 행 적재 시 m.option_value를 재정규화하지 않음. 저장 경로가 항상 정규화를 보장하므로 현 스코프에선 안전. DB에 액션 우회 직접 INSERT가 발생하면 키 불일치 가능성 — Step 2 UI가 유일한 쓰기 경로를 유지하는 한 무관.
