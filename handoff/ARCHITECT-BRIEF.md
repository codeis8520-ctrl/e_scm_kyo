# Architect Brief — Step: 판매현황 목록 수령일자별 그룹 토글

## Goal
판매현황 'list' 서브뷰 목록을 '주문일순'(현행 flat) / '수령일자별'(receipt_date 그룹) 토글로 볼 수 있게 한다. 프론트 전용, DB/쿼리/필터 무변경.

## Scope (한 파일만)
`src/app/(dashboard)/pos/SalesListTab.tsx` 만 수정. 그 외 파일 손대지 말 것.
**DB/마이그/schema.ts/tools.ts 변경 전혀 없음** — 확인됨, 손대지 말 것.

## Build Order

### 1) 정렬 토글 state
- `subView` state 선언부(L159 인근)에 추가:
  `const [listSort, setListSort] = useState<'order' | 'receipt'>('order');`

### 2) 그룹 useMemo
- `filtered` useMemo(L442~497) 바로 뒤에 신규 useMemo `receiptGroups` 추가. deps: `[filtered]`.
- `listSort` 분기는 useMemo 안에서 하지 말고 항상 그룹을 계산해도 됨(렌더에서 모드 분기). 로직:
  - 그룹 키 = `o.receipt_date`(YYYY-MM-DD 문자열) 그대로. null/빈값 = '미지정' 버킷.
  - 날짜 그룹 배열을 날짜 **오름차순**(string 비교로 충분, ISO date) 정렬. **'미지정' 그룹은 항상 맨 끝**.
  - 각 그룹 내 주문 정렬 = receipt_status 우선순위:
    `PICKUP_PLANNED(0) < PARCEL_PLANNED(1) < QUICK_PLANNED(2) < RECEIVED(3) < 기타(4)`.
    (status 없거나 위 4개 외 = 4). status 없음의 기본 표시는 기존 코드가 'RECEIVED'로 폴백하나(L941, L959), **정렬 우선순위에선 null을 RECEIVED로 강제하지 말고 '기타(4)'로** 두면 됨. 동순위는 안정정렬 유지.
  - 각 그룹마다 수령방식별 건수 요약 카운트도 함께 계산: `{ pickup, parcel, quick, received, other }`.
  - 반환 형태 예: `{ date: string|null, label: string, orders: Order[], counts: {...} }[]`.

### 3) 토글 UI
- 'list' 서브뷰에서만 노출. 위치: **테이블 카드(L902) 헤더 줄 — L903 `flex items-center justify-between` 안**, '판매 내역 (N건)' h3 옆 또는 환불 버튼 왼쪽에 토글 배치(좁은 세그먼트 버튼 2개).
- 패턴 재사용: L603~615 subView 토글 스타일(`bg-slate-100 rounded-lg p-1`, active=`bg-white text-blue-700 shadow-sm`)을 작게 복제. 라벨: `['order','주문일순'], ['receipt','수령일자별']`.

### 4) tbody 렌더 분기 (L927~ tbody, 행 본체 L934~)
- **핵심: 기존 per-order `<tr>` 본체(L934의 `filtered.map(o => { ... return (<tr key=...>...</tr>) })`)를 절대 다시 쓰지 말 것.** 행 1줄(약 L934~끝 tr)을 `const renderOrderRow = (o) => { ... return <tr ...> }` 헬퍼로 **추출**해 재사용한다. 셀 구성·onClick 상세이동·환불·뱃지 로직 그대로 보존.
- loading / `filtered.length===0` 분기(L928~933)는 그대로 유지.
- 그 다음:
  - `listSort === 'order'` → `filtered.map(renderOrderRow)` (현행과 동일 출력).
  - `listSort === 'receipt'` → `receiptGroups.flatMap(g => [ <그룹헤더 tr key={'h-'+...}>, ...g.orders.map(renderOrderRow) ])`.
- **그룹 헤더 행**: `<tr><td colSpan={13} className="...">...</td></tr>`.
  - colSpan 은 반드시 **13** (헤더 th 13개 = L912~924, 기존 빈/로딩 행도 colSpan=13).
  - 표시: 날짜(미지정 그룹은 '수령일 미지정') + 그 날짜의 수령방식별 건수 요약.
    예: `2026-06-20 · 방문 3 · 택배 5 · 퀵 1` (건수 0인 방식은 생략 권장). 수령완료/기타도 건수 있으면 덧붙임.
  - 스타일: 눈에 띄는 구분 행(예: `bg-slate-100 font-semibold text-slate-700 text-sm`). sticky 불필요.

## Out of Scope (건드리면 안 됨)
- 필터/검색/기간/CSV/요약카드/일자별요약/compare 서브뷰 로직 — 무변경.
- 정렬은 **이미 받은 filtered 클라이언트 기준**. 서버 재조회 없음.
- '미지정' 그룹 내부 정렬은 status 우선순위만(주문일 정렬 불필요).

## Acceptance
- 토글 '주문일순' = 현재와 픽셀 동일 출력(회귀 없음).
- 토글 '수령일자별' = receipt_date 오름차순 그룹, 미지정 맨 끝, 그룹 내 방문→택배→퀵→수령완료→기타.
- 각 그룹 헤더에 날짜 + 수령방식별 건수 요약 노출.
- 행 클릭→상세, 환불, 뱃지 등 기존 동작 receipt 모드에서도 정상.
- `npm run build` 통과. 빈 목록/미지정만 있는 목록/로딩 상태에서 깨지지 않음.

## Flags (추측 금지)
- colSpan = 13 고정.
- receipt_status enum: RECEIVED / PICKUP_PLANNED / QUICK_PLANNED / PARCEL_PLANNED (L88). 그 외/null = 기타.
- 날짜 비교는 문자열 그대로(이미 YYYY-MM-DD). Date 파싱·타임존 변환 금지.
