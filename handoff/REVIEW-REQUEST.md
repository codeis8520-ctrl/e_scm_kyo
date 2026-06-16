# Review Request — 지점별 매출 통합 조회 (legacy+sales, day/month/year)
Date: 2026-06-16
Ready for Review: YES

## Files Changed

### src/app/(dashboard)/pos/SalesListTab.tsx (compare 서브뷰 전면 교체)
- L158-169 — compare state: compareRows 타입을 RPC 반환형 `{period_date, branch_id, total}[]` 로 교체, compareError·compareGrain('month' 기본)·compareInit 추가.
- L324-331 — compareDaySpan(useMemo): startDate~endDate 일수 차이 계산(day grain 366일 가드용).
- L333-372 — loadCompare 재작성: 페이지네이션 루프 삭제 → `sb.rpc('branch_sales_summary', {p_from, p_to, p_grain})` 1회. day grain 366일 초과 시 조기반환+안내. RPC 에러 → compareError 안내 + 빈 rows(크래시 없음). deps=[startDate,endDate,compareGrain,compareDaySpan].
- L374-388 — compare 진입 useEffect 2개: ① subView==='compare' 시 loadCompare ② 최초 진입 시 기본기간(올해 1/1~오늘)+'custom' 1회 세팅(compareInit 가드).
- L383-419 — compareMatrix 재작성: period 행 × 선택지점 열 + 고정 '미매칭'(branch_id NULL) 열(NULL 행 존재 시에만 노출, compareBranchIds 무관 항상 합산) + colTotals + grandTotal.
- L421-427 — fmtPeriodLabel: grain 따라 연(YYYY)/월(YYYY-MM)/일(YYYY-MM-DD) 라벨.
- L714-755 — compare 필터 UI: 집계 단위(일/월/연) 토글 3버튼 추가 + 기존 지점 다수선택 묶음.
- L1081-1134 — 매트릭스 render: 제목 '지점별 매출 (일/월/연)', 헤더 라벨 grain 연동, 행 키 period_date+fmtPeriodLabel, compareError 안내 분기. 미매칭 열은 compareMatrix.cols 에 포함되어 자동 렌더.

### src/lib/ai/schema.ts (AI Sync)
- L267-270 — BUSINESS_RULES 에 `[지점별 매출(통합 조회)]` 블록: legacy(<2026-05-19)+sales(>=2026-05-19,status 제외조건) 통합, RPC branch_sales_summary 시그니처, 미매칭=branch_id NULL 명시.

## Self-Review
- **Richard 첫 지적 예상**: "RPC 미적용 상태에서 크래시?" → 아니오. loadCompare 의 `if (error)` 분기가 compareError 세팅 + 빈 rows 반환. render 가 compareError 우선 분기. 마이그 081 미적용 상태에서 npm run build 통과 확인.
- **Brief 요구사항 전수 확인**: RPC 호출✓ / grain 토글(기본 month)✓ / day 366일 가드✓ / 기본기간 올해1/1~오늘 1회세팅✓ / 미매칭 고정열✓ / colTotals+grandTotal✓ / 지점명 from branches✓ / RBAC !isBranchUser 유지✓ / AI Sync 1줄✓ / list 서브뷰 미변경✓.
- **빈 데이터/실패 시 사용자 화면**: RPC 실패→amber 안내문. 지점 0개 선택→"비교할 지점을 1개 이상 선택하세요". 기간 매출 없음→"해당 기간 매출이 없습니다". day 366일 초과→amber 안내(조회 차단).

## Open Questions
- 마이그 081 RPC 의 `period_date` 반환이 `date_trunc(...)::date` (예: 월=YYYY-MM-01)라고 가정하고 fmtPeriodLabel 이 앞자리만 잘라 표시함. RPC 가 다른 형식 반환 시 라벨만 조정 필요(로직 무영향, period_date 는 그룹 키로만 사용).

## Out of Scope (logged in BUILD-LOG)
- legacy 취소/환불 미반영(의도된 가정).
- compare CSV 내보내기 없음.
- 지점선택 RPC 인자화 최적화 안 함(클라 필터 유지).
