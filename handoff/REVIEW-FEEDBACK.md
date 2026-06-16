# Review Feedback — 판매현황 목록 수령일자별 정렬 토글
Date: 2026-06-16
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
없음.

## Escalate to Architect
없음. (Out of Scope 2건은 BUILD-LOG 기록됨 — 필터기간=주문일 기준이라 미래 수령건 누락 가능 / '미지정' 그룹 2차정렬 없음. 코드 결함 아님, 사용자 안내 사항.)

## Cleared
SalesListTab.tsx 단일 파일 — 수령일자별 정렬 토글 + receiptGroups useMemo + renderOrderRow 추출.

### 검증 내역 (실측)
- **colSpan=13 확인.** 목록 표 <th> 실측 13개(일자·수령·매출처·출고처·담당자·고객/연락처·품목·수량·합계·결제/승인·받는분·상담/옵션·상태, L1116-1128). renderOrderRow의 <td>도 13개. 로딩(L1133)·빈행(L1135)·그룹헤더(L1151) colSpan 모두 13으로 일치. Bob이 REVIEW-REQUEST에 적은 ~15개는 라벨을 쪼개 센 것일 뿐 실제 컬럼은 13개. 불일치 해소.
- **renderOrderRow 바이트 동일.** git diff로 확인 — 기존 `filtered.map(o => {...})` 본문과 추출된 `renderOrderRow(o)` 본문이 셀·key={o.id}·onClick(상세이동)·뱃지·환불 로직까지 완전 동일. 래퍼만 인라인→named function 전환. 회귀 없음.
- **receiptGroups 정확.** receipt_date 버킷(null/빈값→'미지정'), 키 ASC 문자열 비교(L519-523)·'미지정' 강제 맨끝, 그룹내 rank PICKUP0<PARCEL1<QUICK2<RECEIVED3<기타4(null/그외=4). `.slice().sort()`로 filtered 무변경, V8 stable sort라 동순위는 삽입(주문일)순 유지. counts 5종 정확.
- **receipt 렌더.** 날짜헤더 tr(label+방식별 건수, 0건 방식 생략) → 그룹 주문행. loading/빈목록/미지정-only 모두 비파손. 토글은 subView==='list' fragment(L1054~1164) 내부에만 노출, compare 뷰엔 없음.
- **문자열 날짜 비교만.** Date 파싱/TZ 변환 전무.
- **React key 안전.** 그룹헤더 `h-${date??'unset'}` (UUID o.id와 충돌 불가), 주문행 key={o.id}. flatMap 시 중복키 없음.
- **스코프 준수.** 코드 변경 단일 파일. DB/쿼리/필터/schema.ts/tools.ts 무변경. compare 서브뷰·기타 로직 무손상.
