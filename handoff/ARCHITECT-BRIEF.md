# Architect Brief — 지점별 매출 통합 조회 (legacy+sales, day/month/year)

## Goal
판매현황 '지점비교'(compare) 서브뷰를 2018~현재 legacy+sales 통합·일/월/연 grain 토글·지점별합계+전체합계+미매칭 열로 확장. 집계는 신규 DB RPC.

## 잠긴 결정 (Bob: 추측 금지, 그대로 구현)
- **1단계 배포** (RPC + 프론트 한 슬라이스). 프론트는 RPC 없이는 무의미하므로 분리 안 함.
- **컷오프 = 2026-05-19** (RPC 내부 상수 `_CUTOFF date := '2026-05-19'`). legacy: `ordered_at < _CUTOFF`. sales: `ordered_at >= _CUTOFF`. 겹침구간 이중집계 방지.
- **legacy 상태필터 없음**: legacy_orders.payment_status 는 '결제 완료'/'미결' 한글 텍스트(취소플래그 아님). 과거=완료매출 가정, **전 행 집계**. (취소 표시 없음 확인 완료.)
- **sales 상태필터**: `status NOT IN ('CANCELLED','REFUNDED','PARTIALLY_REFUNDED')`. (기존 loadCompare L334 와 동일 기준 — PARTIALLY_REFUNDED 도 제외 유지.)
- **legacy branch_id NULL = '미매칭' 그룹**: 제외 안 함. RPC 는 branch_id NULL 그대로 반환. 프론트가 NULL 열을 '미매칭' 고정라벨로 렌더.
- **RPC = SECURITY DEFINER** + `GRANT EXECUTE ... TO anon, authenticated`. (search_customers_full 패턴.) custom session auth라 client 는 anon role.
- **grain=day 가드**: day 선택 시 기간 366일 초과면 프론트에서 조회 막고 안내(8년 일별 폭주 방지). month/year 는 무제한.
- **기본 기간**: compare 진입 시 startDate/endDate 를 **올해 1/1~오늘**로 세팅하고 grain='month' 기본. (현재 기본 'today'는 분석 부적합.) list 서브뷰 기본은 건드리지 말 것.
- **branch_id 인자 없음**: RPC 는 기간·grain 만 받고 전 지점 반환. 지점 선택 필터는 **프론트 클라이언트단**에서 유지(compareBranchIds, 미매칭 열은 항상 표시). RPC 시그니처 단순화.

## Build Order
1. **마이그 `supabase/migrations/081_branch_sales_summary.sql`** (Arch가 Supabase 적용; Bob은 파일만 작성)
   - `CREATE OR REPLACE FUNCTION public.branch_sales_summary(p_from date, p_to date, p_grain text DEFAULT 'month')`
   - RETURNS TABLE(period_date date, branch_id uuid, total numeric)
   - LANGUAGE sql, SECURITY DEFINER, `SET search_path = public`
   - 내부: `WITH unioned AS ( legacy SELECT ordered_at, branch_id, total_amount WHERE ordered_at >= p_from AND ordered_at <= p_to AND ordered_at < '2026-05-19' UNION ALL sales SELECT ordered_at::date, branch_id, total_amount WHERE ordered_at::date 동일범위 AND ordered_at::date >= '2026-05-19' AND status NOT IN(...) )` → `SELECT date_trunc(p_grain, period)::date, branch_id, SUM(total) GROUP BY 1,2`.
     - ⚠️ sales_orders.ordered_at 은 timestamptz 일 수 있음 — 범위·grain 모두 `(ordered_at AT TIME ZONE 'Asia/Seoul')::date` 또는 ::date 로 **KST 일자 통일**(기존 kstDayStart/fmtDateKST 와 일치하게). legacy.ordered_at 은 DATE 라 그대로. Bob: sales_orders.ordered_at 타입 확인 후 KST 캐스팅 적용.
   - `date_trunc(p_grain, ...)` 의 p_grain 은 'day'|'month'|'year' 만 허용 — 함수 시작부 가드(아니면 RAISE EXCEPTION).
   - `GRANT EXECUTE ON FUNCTION public.branch_sales_summary(date,date,text) TO anon, authenticated;`
   - 헤더 주석에 컷오프·union 정책 명시(070/077 주석 스타일).
2. **`SalesListTab.tsx` compare 서브뷰 교체** (단일 파일)
   - 상태 추가: `compareGrain` ('day'|'month'|'year', 기본 'month'). compareRows 타입을 RPC 반환형 `{ period_date: string; branch_id: string|null; total: number }[]` 로 교체.
   - `loadCompare` 재작성: 페이지네이션 루프 삭제 → `sb.rpc('branch_sales_summary', { p_from: startDate, p_to: endDate, p_grain: compareGrain })` 1회 호출. **폴백 없음**(RPC 미적용이면 에러 표시; Arch가 마이그 먼저 적용). deps 에 compareGrain 추가.
   - day 가드: compareGrain==='day' && (endDate-startDate>366일)면 loadCompare 조기반환 + 안내 메시지 상태.
   - `compareMatrix` 재작성: RPC rows 로 rebuild. **미매칭 열 추가** — branch_id NULL 합계를 별도 '미매칭' 열(항상 표시, compareBranchIds 토글과 무관)로. 선택 지점 열 + 미매칭 열 + 합계열. colTotals/grandTotal 동일.
   - compare 진입 useEffect: 기본기간(올해 1/1~오늘) 1회 세팅 (이미 사용자가 바꿨으면 덮어쓰지 말 것 — 진입 플래그 1회만).
   - UI: 기간 프리셋 줄 아래(또는 지점선택 옆)에 grain 토글 3버튼(일/월/연) 추가, compare 서브뷰일 때만. 매트릭스 헤더 '일자'→grain 따라 '월'/'연' 라벨, 행 키 period_date. 제목 '지점별 매출' (일/월/연).
   - 미매칭 합계 0이면 미매칭 열 숨겨도 됨(선택). 표시 시 라벨 '미매칭' 고정.

## Out of Scope (→ BUILD-LOG Known Gaps if surfaces)
- legacy 취소/환불 반영(과거엔 신뢰가능 플래그 없음).
- 지점별 매출의 CSV 내보내기(compare).
- list 서브뷰 기본기간/동작 변경.
- 물리적 데이터 이전(read-union 유지).
- 지점선택을 RPC 인자로 내리는 최적화.

## Acceptance
- compare 진입 → 올해 월별 지점매출 매트릭스 즉시 표시(legacy+sales 통합). grain '일/월/연' 토글 동작. custom from/to 변경+조회 반영.
- 2018년 등 과거 연/월 조회 시 legacy 행 합산 표시. 미매칭(legacy branch NULL) 열 노출.
- 컷오프 경계(5/18 legacy / 5/19 sales)에서 이중집계 없음. 지점 합계열·전체 합계·지점별 열합 정확.
- `npm run build` 통과. RBAC: !isBranchUser 에서만 compare 노출(기존 유지).

## AI Sync (CLAUDE.md 매트릭스)
- 신규 RPC는 테이블 아님 → DB_SCHEMA 변경 불요.
- `src/lib/ai/schema.ts` BUSINESS_RULES 에 1줄 추가: "지점별 매출 = legacy_orders(ordered_at<2026-05-19) + sales_orders(>=2026-05-19, status NOT IN CANCELLED/REFUNDED/PARTIALLY_REFUNDED) 통합. RPC branch_sales_summary(from,to,grain). legacy branch_id NULL=미매칭."
- tools.ts 영향 없음(에이전트 도구 미추가 — 범위 밖).
