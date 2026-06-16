# Review Feedback — 지점별 매출 통합 조회 (legacy+sales, day/month/year)
Date: 2026-06-16
Ready for Builder: NO

## Must Fix

- supabase/migrations/081_branch_sales_summary.sql:63 — **컷오프 경계 off-by-9h 데이터 누락.**
  `cutoff` 은 `DATE '2026-05-19'` 이고, 라인 63은 `so.ordered_at >= cutoff::timestamptz` 로 비교한다.
  `date::timestamptz` 캐스트는 **DB 세션 타임존**(Supabase 기본 = UTC)에서 자정으로 해석되므로
  `'2026-05-19'::timestamptz` = `2026-05-19 00:00 UTC` = `2026-05-19 09:00 KST` 가 된다.
  - legacy 쪽(라인 52): `lo.ordered_at < cutoff` → KST 일자 ≤ 2026-05-18 까지 포함.
  - sales 쪽(라인 63): KST 2026-05-19 00:00 ~ 09:00 사이 주문(`ordered_at` UTC 기준 05-18 15:00 ~ 05-19 00:00)은
    `>= cutoff::timestamptz` 를 통과하지 못해 **누락**된다. legacy 에도 없고 sales 에도 안 잡힘 → 2026-05-19 오전 9시간치 매출 증발.
  - 중복(이중집계)은 없음(이 방향은 안전). 문제는 **누락**이다.
  - 원인: 컷오프 비교만 raw timestamptz(UTC 자정)로 하고, 나머지 필터/절단은 `(ordered_at AT TIME ZONE 'Asia/Seoul')::date` 로
    KST 일자 정규화를 한다 → 경계 기준이 서로 어긋남.
  - **수정**: sales 컷오프도 legacy 와 동일한 KST 일자 경계로 맞춘다. 라인 63을
    `WHERE (so.ordered_at AT TIME ZONE 'Asia/Seoul')::date >= cutoff` 로 바꾸면
    legacy `< cutoff` / sales `>= cutoff` 가 동일한 KST 캘린더 경계에서 정확히 맞물려 누락·중복 모두 사라진다.
    (이미 라인 65에서 동일 표현식으로 BETWEEN 필터를 하고 있으므로 표현식 재사용 가능.)

## Should Fix

- (없음)

## Escalate to Architect

- supabase/migrations/081_branch_sales_summary.sql:34,76 — **SECURITY DEFINER + GRANT EXECUTE TO anon.**
  이 RPC 는 SECURITY DEFINER 로 소유자 권한 실행되며 anon 키 호출자 누구나 실행 가능하다.
  UI 는 본사/관리자(`!isBranchUser`)로 게이팅하지만 RPC 자체는 게이트 밖이라, anon 키만 있으면
  전 지점 매출 합계를 기간·grain 별로 조회할 수 있다(개별 주문 X, 집계만).
  - 기존 RLS 'allow all' 테이블들과 동일한 노출 수준인지, 아니면 지점 매출 총액이 그보다 민감한지는
    **비즈니스 판단**이라 코드 레벨에서 결정 못 함. 같은 posture 면 그대로 둬도 되고,
    더 조이려면 `authenticated` 만 GRANT 하거나 RPC 내부에서 호출자 role 검증을 넣어야 함.
  - 차단 사유는 아님. Arch 가 노출 허용 수준만 확인해 주면 됨.

## Cleared

다음 항목은 검토 후 정상 확인:
- legacy_orders 에 status/cancel 컬럼 없음(payment_status 만 존재) → legacy 측 status 필터 미적용은 올바름.
- sales status 제외(CANCELLED/REFUNDED/PARTIALLY_REFUNDED) 적용 정확, BUSINESS_RULES 와 일치.
- period_date = `date_trunc(grain, ...)::date` → month=YYYY-MM-01 / year=YYYY-01-01 / day=date.
  Bob 의 fmtPeriodLabel(slice 7/4/full)과 정확히 호응. grain 화이트리스트 가드(day|month|year) 존재.
- 미매칭(branch_id NULL) 행 GROUP BY 보존, 프론트에서 NULL 행 존재 시에만 '미매칭' 열 노출 + 항상 합산.
- compareMatrix 합계 정합: 선택 지점 colTotals + 미매칭 = grandTotal, 행/열 합 일치(라인 398-418).
- grain 토글(기본 month), 진입 시 올해 1/1~오늘 1회 세팅, day grain 366일 가드 + 안내.
- RPC 에러 시 graceful degrade(compareError 안내 + 빈 rows, 크래시 없음) — 081 미적용 상태 대응됨.
- RBAC: subView 토글이 `!isBranchUser` 로 감싸짐(라인 602), 지점 사용자는 비교탭 미노출. list 서브뷰 미변경.
- 컬럼명(ordered_at, total_amount, branch_id, status) 양 소스 모두 정확.
