# Review Feedback — Step 3.5: getVatReport/getGlBalances 페이지네이션 버그 수정
Date: 2026-06-26
Status: APPROVED
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
없음.

## Escalate to Architect
없음.

## Cleared
src/lib/accounting-actions.ts getVatReport(681~719)·getGlBalances(749~792)의 journal_entry_lines 무페이지네이션(1000행 무음절단) 버그 수정을 리뷰함. 두 함수 모두 배포·검증된 getProfitLoss(186~220)와 동형 패턴으로 정확히 정렬됨 — 승인.

검증 결과(재무 정확성 엄격 검토):
1. 페이지네이션 정확성 — 두 함수 모두 `.order('id',{ascending:true})` 안정정렬 + `.range(from, from+PAGE-1)` + `if(rows.length===0) break` + `from += rows.length`. getProfitLoss와 1:1 동형. 서버 max-rows<PAGE(예 500)여도 실제 반환분만큼 전진하므로 누락 0, 종료는 오직 빈 페이지로 판단 → 경계 이중합/누락 없음.
2. getVatReport `.in()` 필터 — targetAccIds=[2151id,1150id].filter(Boolean). 2151≠1150(상이 코드)이라 한 라인은 둘 중 하나의 account_id만 가짐 → 원본의 두 독립 `if`와 `if/else if`가 동작 동일. 계정 미존재 시 빈 배열 → 루프 스킵 → 0 집계 안전. 단일 계정만 존재해도 미존재 계정 브랜치 미발화 → 0. 결과 동일.
3. getGlBalances — account_id 필터 없이 전 라인 페이지네이션(전 계정 집계라 정당). balances Map 누적·isDebitNormal 부호(ASSET/EXPENSE/COGS=차변-대변, 그 외=대변-차변)·result 매핑·`거래없는 계정 제외` 필터(790) 모두 불변.
4. 집계 수치 불변 — 반환 구조 무변경(getVatReport 725~733 outputVat/inputVat/vatPayable/summary, getGlBalances 777~792 accounts). netOutputVat/netInputVat/vatPayable 산식·부호 무변경.
5. 에러 처리 — 원본은 `const {data}` 만으로 에러 무시(무음 undefined→부분/0집계 은폐)였으나, 수정본은 pageErr 시 throw(`부가세 GL 집계 실패`/`계정잔액 GL 집계 실패`)로 과소집계 은폐 방지. getProfitLoss와 동일하며 오히려 개선.

무회귀: diff 상 두 함수 외 변경 없음(closePeriod 등 미수정). schema.ts/마이그 변경 불요(read-only 집계 로직).
