# Review Request — 레거시 판매데이터 정규화 1단계 (데이터층)
Date: 2026-06-02
Ready for Review: YES

## Files Changed

- `supabase/migrations/070_legacy_orders_normalize.sql` (신규)
  - (a) `customers ADD COLUMN IF NOT EXISTS phone2 TEXT` + COMMENT (백필 없음).
  - (b) `legacy_orders` 테이블 — 주문 헤더. legacy_order_no VARCHAR(40) UNIQUE NOT NULL, FK(customers ON DELETE SET NULL, branches), 인덱스 customer_id·ordered_at (legacy_order_no 는 UNIQUE 가 인덱스 겸함, 별도 생성 안 함).
  - (c) `legacy_order_items` 테이블 — 라인아이템. order_id FK(legacy_orders ON DELETE CASCADE), UNIQUE(order_id, line_seq), 인덱스 order_id·item_code.
  - (d) RLS + GRANT — 두 테이블 각각 064 패턴 그대로 (anon, authenticated / USING(true) WITH CHECK(true) / GRANT SELECT,INSERT,UPDATE,DELETE).
  - (e) 멱등 분리적재 — 헤더 먼저(GROUP BY legacy_order_no, MIN 대표값, SUM(total_amount)) → 아이템 나중(CTE 로 ROW_NUMBER line_seq 생성 후 legacy_orders JOIN). 둘 다 ON CONFLICT DO NOTHING.

- `src/lib/ai/schema.ts` (수정)
  - customers 라인에 `phone2(제2 연락처(정규화))` 추가.
  - legacy_purchases 블록 끝 070 정규화 예정 주석 1줄 + legacy_orders/legacy_order_items 항목 2개 추가.

## Self-review

- **Richard가 가장 먼저 볼 것**: UUID 컬럼 MIN 집계. PostgreSQL 은 uuid 타입에 min() 집계함수가 없으므로 `MIN(lp.customer_id::text)::uuid`, `MIN(lp.branch_id::text)::uuid` 로 캐스팅. 주문 내 값갈림 0%(Arch 검증)라 결정적 대표값이면 동일 결과.
- **Brief 요구사항 전수 확인**: (a)~(e) 전부 구현. 헤더 대표값 MIN(col), total_amount=SUM, line_seq=ROW_NUMBER OVER(PARTITION BY legacy_order_no ORDER BY id), 헤더→아이템 순서, GRANT 포함, legacy_purchases 무손상(SELECT 만 — ALTER/UPDATE/DROP 없음).
- **빈/실패 케이스**: legacy_order_no IS NULL 행은 WHERE 가드로 제외 — UNIQUE NOT NULL 위반 방지. 멱등 재실행 시 ON CONFLICT DO NOTHING 으로 중복 0.
- **빌드**: `npm run build` 통과. schema.ts 추가분에 backtick/`${` 없음 → 템플릿 리터럴 무손상.

## Open Questions
- 없음. Acceptance 검증(rowcount 47,268 / 66,090, SUM 일치, line_seq NULL=0, 고아 item=0)은 Arch 가 psycopg 적용 후 수행.

## Out of Scope (logged in BUILD-LOG)
- 앱 read 정규화본 전환(고객 상세 과거구매 탭, /customers/analytics RFM).
- legacy_purchases DROP, 임포터 재작성, phone2 백필, 복사/매핑 UI.
