# Review Request — 판매현황 목록 수령일자별 정렬 토글
Date: 2026-06-16
Ready for Review: YES

## Verified colSpan
colSpan = **13** — 실측 확인. 목록 표 헤더 th 13개(일자·수령·매출처·출고처·담당자·고객/연락처·품목·수량·합계·결제/승인·받는분·주소·상담·옵션·상태). 기존 로딩/빈행 colSpan=13과 동일. 그룹 헤더 tr도 13 사용.

## Files Changed
단일 파일: src/app/(dashboard)/pos/SalesListTab.tsx

- SalesListTab.tsx:160-161 — listSort state ('order'|'receipt', 기본 'order') 추가 (subView 인근).
- SalesListTab.tsx:501-544 — receiptGroups useMemo(deps [filtered]): receipt_date 버킷(null→'미지정'), 키 ASC 정렬·'미지정' 강제 맨끝, 그룹 내 status rank 정렬(PICKUP0<PARCEL1<QUICK2<RECEIVED3<기타4; null/그외=4; .slice().sort()로 안정정렬), counts{pickup,parcel,quick,received,other}.
- SalesListTab.tsx:546-692 — renderOrderRow(o) 헬퍼. 기존 per-order <tr> 본체를 **바이트 그대로 추출**(셀·onClick 상세이동·환불·뱃지 로직 무변경).
- SalesListTab.tsx:1090-1108 — 테이블 카드 헤더(flex)에 세그먼트 토글 2개 추가(주문일순/수령일자별). L603 subView 토글 패턴 축소 복제. subView==='list' 래퍼(L865) 내부 → list 서브뷰에서만 노출.
- SalesListTab.tsx:1138-1159 — tbody 렌더 분기. loading / filtered.length===0 원본 유지. listSort==='order'→filtered.map(renderOrderRow)(현행과 동일 출력). listSort==='receipt'→receiptGroups.flatMap([그룹헤더 tr(colSpan=13, label + 방식별 건수 요약), ...g.orders.map(renderOrderRow)]).

## 검증 포인트
- order 모드는 본체 추출만 했으므로 픽셀 동일(회귀 없음) — 헬퍼 본문이 원본 바이트 그대로인지 확인 부탁.
- receipt 모드: 날짜 ASC, '미지정' 맨끝, 그룹 내 방문→택배→퀵→수령완료→기타.
- 그룹 헤더 요약 예: "2026-06-20 · 방문 3 · 택배 5 · 퀵 1" (건수 0 방식 생략).
- 빈 목록 / 미지정만 / 로딩 상태 비파손.
- 날짜 비교는 문자열 그대로(Date 파싱/TZ 변환 없음).

## Build
npm run build ✓ Compiled successfully (에러/경고 0).

## Open Questions
- 없음.

## Out of Scope (logged in BUILD-LOG)
- 필터 기간이 주문일 기준이라 좁은 기간이면 미래 수령건이 수령일자별에도 안 보임 (사용자 안내 사항).
- '미지정' 그룹 내부는 status 우선순위만(주문일 2차 정렬 없음).
