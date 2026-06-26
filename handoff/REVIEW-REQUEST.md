# Review Request — Step 3.5: getVatReport/getGlBalances 페이지네이션 버그 수정
Date: 2026-06-26
Ready for Review: YES
🔴 재무 정합성(부가세·계정잔액 집계). 마이그/schema.ts 변경 없음(read-only 집계 로직).

build ✓ (compile, 에러·경고 0).

## 배경
Step 3에서 getProfitLoss를 GL 단일원천으로 재배선하며 journal_entry_lines 무페이지네이션(1000행 무음절단) 버그를 .range() 루프로 해결함(커밋 77957d4). Arch가 동일 버그를 getVatReport·getGlBalances에서도 발견해 별도 스텝(3.5)으로 보고. 본 작업이 그 수정.

## Files Changed
### src/lib/accounting-actions.ts (단일 파일)
- **getVatReport** (671~): 단일 `.from('journal_entry_lines')` 페치(1000행 상한) → getProfitLoss 동일 패턴 페이지네이션 루프.
  - 2151(부가세예수금)/1150(부가세대급금) 두 계정 ID로 `.in('account_id', targetAccIds)` 필터(행수 축소).
  - `.order('id', {ascending:true})` 안정정렬 + `.range(from, from+PAGE-1)`, 빈 페이지에서 종료, `from += rows.length`(서버 max-rows<PAGE여도 정확).
  - 계정 미존재 시 targetAccIds 빈 배열 → 루프 스킵(0 집계, 안전). pageErr → throw(`부가세 GL 집계 실패`).
  - 집계 로직(outputVatCredit/Debit, inputVatDebit/Credit, netOutputVat/netInputVat/vatPayable) 및 반환 구조 **불변** — 누적 위치만 페이지 루프 안으로 이동, `if/else if`로 정정(원본은 두 독립 `if`였으나 account_id는 상호배타라 동작 동일).
- **getGlBalances** (726~): 동일 버그·동일 수정. **전 계정 집계라 account_id 필터 불가** → 기간 내 전 분개 라인을 페이지네이션으로 전부 누적(누락 위험이 더 큼). balances Map 집계 로직·정상잔액 부호(isDebitNormal)·result 매핑·필터(거래있는 계정만) **불변**.

## 핵심 검증 포인트
1. 페이지네이션 정확성: 빈 페이지 종료 + `from += rows.length`로 서버 max-rows가 PAGE(1000)보다 작아도 누락 0. getProfitLoss(검증·배포됨)와 동형.
2. getVatReport `.in()` 필터 정당성: 2151/1150만 집계하므로 행 사전축소 안전(원본은 전 라인 페치 후 코드에서 필터링). 결과 동일.
3. 집계 수치 불변: 페이지 경계로 인한 이중합/누락 없음(.order('id') 안정정렬). 반환 키·부호·요약 문구 무변경.
4. 무회귀: 두 함수 외 무변경. getProfitLoss·closePeriod 등 미수정.

## Out of Scope
- 다른 분개 라인 스캔 함수(getLedger 등)는 본 스텝 범위 밖(필요 시 별도).
- DB측 RPC 집계 전환(마이그 동반)은 미선택 — 코드 전용 수정으로 블로킹 회피(Step3 동일 결정).
