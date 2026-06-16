# Review Feedback — Step 2 (자사몰 total_amount 백필 라우트)
Date: 2026-06-16
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
- route.ts:79 — ORDER BY가 ordered_at desc 단일 키. 동일 ordered_at 타이가
  많으면 페이지 경계에서 행 순서가 호출 간 흔들려 일부 행 건너뜀/중복 처리
  가능성(이론적). 단, 백필은 멱등(같은 값=unchanged)이라 중복은 무해하고,
  스킵된 행은 다음 전수 스캔(offset 0부터 재실행)에서 잡히므로 실무 영향
  미미. 권장: 안정 정렬을 위해 .order('id', { ascending: true }) 등 고유키
  2차 정렬 추가. 5분 미만이면 인라인, 아니면 BUILD-LOG에 기록.

## Escalate to Architect
없음.

## Cleared
신규 GET /api/cafe24/backfill-amount 라우트 전체(L1-144) 리뷰 — 가드(CRON_SECRET
미설정 500 / Bearer 불일치 401 / 토큰 null 401, /backfill와 동일), 대상 SELECT
(channel='ONLINE' + cafe24_order_id NOT NULL + 취소/환불 제외, 깨짐필터 미사용),
건별 getOrder→cafe24OrderTotal(전 tender 합, types.ts 정상 import) 재계산 후
다를 때만 total_amount만 인플레이스 update(멱등 unchanged-skip), payload에 total_amount
단독(discount/payment_method/recipient/items/customer/status/delete 무손상), 건별
try/catch 실패 격리(failed++ + continue, 배치 중단 없음), 페이지네이션
(nextOffset=offset+limit when scanned===limit, done=scanned<limit), 재실행 멱등성,
schema.ts/tools.ts/마이그 무변경 — 모두 브리프 사양대로 확인. 통과.
