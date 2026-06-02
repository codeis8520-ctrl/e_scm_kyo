# Review Feedback — POS 고객패널 과거구매(legacy) 표시
Date: 2026-06-02
Ready for Builder: YES

(독립 검증 — git diff + 070 마이그 스키마 + customers/[id] 참조 패턴 직접 대조.)

## Must Fix
없음.

## Should Fix
없음.

## Escalate to Architect
없음.

## Cleared
검증 항목 전수 통과:

1) state 누수/잔재 — `setHistory(` 5건 전수(L723 부분 loading:true / L750 성공 / L758 catch /
   L828 clearCustomer / L1088 resetForm). 전체 리셋 4곳 모두 `legacyOrders: []` 동기화됨.
   `setExpandedLegacy(new Set())` 진입부(L724)·clearCustomer(L826)·resetForm(L1086) 3곳 초기화.
   잔재 버그 없음.

2) 페치 정확성 — legacy_orders select 컬럼·중첩(branch:branches(name),
   legacy_order_items(...)) 이 customers/[id] L230 검증된 패턴과 글자 단위로 동일.
   070 마이그 대조: customer_id/ordered_at/channel_text/branch_id/branch_code_raw/
   recipient_*/payment_status/total_amount/source_file 전부 존재, legacy_order_items.order_id
   →legacy_orders FK·branch_id→branches FK 존재 → 임베드 정상. .eq(customer_id).limit(50) 정확.
   Promise.all 디스트럭처링 `[consultRes, ordersRes, legacyRes]` — 기존 2개 인덱스 안 어긋남.

3) 폴백/Promise.all 회귀(핵심) — **회귀 없음**. Supabase 쿼리빌더는 thenable 이 {data,error}
   로 resolve 하며 쿼리 오류(테이블/컬럼 부재 404/400)는 error 필드로 들어감 — reject 아님.
   .throwOnError() 미사용. 따라서 legacy_orders 실패가 Promise.all 을 reject 시키지 못하고
   consultRes/ordersRes 는 정상 resolve. legacyRes.data 는 null → `(legacyRes.data||[])` 로
   빈 배열. 상담/구매 이력 로딩 무손상. 신규 try/catch 없음(기존 함수 catch 재사용).

4) 렌더 — historyTab union 'legacy' 추가, 탭 항상 노출+빈상태("과거 구매 이력이 없습니다."),
   발송지 셋다 빈값 시 "발송지 정보 없음"/개별 '-', 품목 line_seq 오름차순 정렬
   (`(a.line_seq??0)-(b.line_seq??0)`), 카드 클릭 토글(expandedLegacy.has). 정상.

5) 범위 가드 — 단일 파일(pos/page.tsx)만 변경. 복사버튼·포장옵션·schema.ts·검색필터·페이징·
   legacy_purchases/마이그 미접촉 확인.

6) 기존 상담/구매 이력 탭 — ternary 1단 확장(consult ? : orders ? : legacy), 기존 두 분기
   로직·렌더 무변경. 무손상.
