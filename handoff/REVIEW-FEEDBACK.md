# Review Feedback — 레거시 판매데이터 정규화 2단계 (앱 read 리팩터)
Date: 2026-06-02
Ready for Builder: YES

(독립 검증 — 셀프리뷰 내용 덮어씀. git diff + 070 스키마 대조로 처음부터 재검증.)

## Must Fix
없음.

## Should Fix
- search/route.ts attachHistory + [id]/page.tsx 페치: legacy 페치 상한(`limit(ids.length*3)` / `range(0,9999)`)은 이번 변경 이전부터 있던 캡으로, 이 스텝이 도입/악화시킨 것 아님. 주문수 < 라인수라 오히려 캡 여유가 늘어남 → 조치 불필요, 기록만. (필요 시 BUILD-LOG Known Gaps.)

## Escalate to Architect
없음.

## Cleared
변경 6파일(코드 5 + analytics 안내문) 한정, 드리프트 없음. 070 스키마 대조 완료:

1) 정합성/버그픽스 — analytics 3함수(getRfmAnalysis/getRepurchaseCycles/getChurnRiskCustomers) 모두 `.from('legacy_purchases')`→`.from('legacy_orders')` 순수 교체, select 컬럼 동일(customer_id, total_amount, ordered_at, branch_id). 4컬럼 전부 legacy_orders 에 존재(070 L26/39/28/30). accumulate 는 행당 count+=1 / totalAmount+=헤더금액 → legacy_orders 가 주문당 1행이라 F(빈도)·재구매·이탈 카운트가 자동으로 "주문수" 기준이 됨 = 라인수 부풀림 버그픽스. M=헤더 total_amount(=070 e-1 L125 SUM(line)) 로 값 보존 확인.

2) legacy_purchases 앱 read 잔존 — `grep "from('legacy_purchases')" src/` = 0 (exit 1) 직접 확인.

3) 고객상세 과거구매 탭 — 중첩 select 1회: `legacy_order_items(line_seq,item_code,item_text,option_text,quantity,total_amount)` (FK order_id→legacy_orders.id, 070 L60 유효) + `branch:branches(name)` (FK branch_id→branches, 070 L30 유효). 임베드 컬럼 6개 전부 legacy_order_items 에 존재(070 L61-70). 렌더: 주문 카드 묶음, 품목 `line_seq` 정렬, 발송지 recipient_name/phone/address 표시(빈값 '-', 셋다빈값 '발송지 정보 없음', 값 정제 없음), 합계/건수=주문 기준(헤더 total_amount 합). expandedLegacy 별도 Set state 로 sales 탭 expandedOrders 와 분리 — 토글 충돌 없음. 구 legacy_purchase_no(NULL) 잔재 제거, legacy_order_no mono 로 대체.

4) 카운트 의미 변경 — legacy_purchase_count(search 반환 필드명) 의도적 유지, 의미만 라인수→주문수. UI 라벨 "과거 구매 N건"·"총 N건(주문)" 중립/명시어라 모순 없음. SalesListTab.tsx 미변경(값만 소비) 확인.

5) 범위 가드 — legacy_purchases DROP/ALTER/UPDATE 없음(SELECT only). 임포터·복사UI·POS prefill 미혼입. schema.ts 미변경(070 에서 이미 동기화) 확인.

6) RBAC/보안 — 읽기 전용. 신규 2테이블 RLS ENABLE + GRANT SELECT TO anon (070 d, 064 패턴 동일) → custom session auth 의 anon 경로 read 동작 가능. 신규 쓰기 경로·권한 우회 없음.

build ✅ (REVIEW-REQUEST 보고: 0 errors). 독립 검증 결과 Must Fix 없음 — Step is clear.
