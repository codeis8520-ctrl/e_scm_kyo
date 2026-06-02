# Review Feedback — Step: 레거시 판매데이터 정규화 1단계 (데이터층)
Date: 2026-06-02
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
없음 (블로킹 아님 — 참고용 메모만):
- `070...sql:133-169` (e-2) — `numbered` CTE 가 재실행마다 legacy_purchases 66,090행 전체를 다시 스캔·번호매김한다. ON CONFLICT(order_id,line_seq) 가 중복을 막고 `ORDER BY lp.id` 가 결정적이라 멱등성·정합성에는 문제 없음. 1회성 정규화라 성능도 무관. 조치 불필요, 인지만.

## Escalate to Architect
없음.

## Cleared
070 마이그(신규 legacy_orders/legacy_order_items + customers.phone2)와 schema.ts DB_SCHEMA 동기화를 리뷰했고 통과.

검증 항목:
- 멱등: 두 INSERT 모두 UNIQUE 키에 ON CONFLICT DO NOTHING, 헤더는 legacy_order_no IS NOT NULL 가드. 재실행 안전.
- 헤더 대표값 MIN(col) / total_amount=SUM(lp.total_amount) — Brief 일치.
- line_seq = ROW_NUMBER() OVER(PARTITION BY legacy_order_no ORDER BY lp.id)::smallint — Brief 일치.
- order_id 매칭: 헤더 먼저 적재(동일 NOT NULL 소스) → JOIN on legacy_order_no. 고아 아이템 발생 불가.
- legacy_purchases 무손상: SELECT 만. ALTER/UPDATE/DROP 없음 — 절대 경계 준수.
- RLS/GRANT: 064 패턴과 글자단위 동일. 두 테이블 각각 GRANT SELECT,INSERT,UPDATE,DELETE TO anon,authenticated 포함 — anon 경로 전면거부 위험 없음.
- FK/제약: customer_id ON DELETE SET NULL, order_id ON DELETE CASCADE, UNIQUE(legacy_order_no), UNIQUE(order_id,line_seq) 전부 Brief 일치. gen_random_uuid() 는 064 에서 이미 동일 DB 에서 동작 확인됨(적용 시 깨질 위험 없음).
- UUID 캐스팅: MIN(lp.customer_id::text)::uuid / MIN(lp.branch_id::text)::uuid. 소스 타입은 064 기준 UUID. 주문내 값갈림 0%(Arch 검증) 전제에서 text 사전식 MIN 은 결정적 대표값 — 정합성 안전.
- 소스 컬럼 존재 확인: legacy_order_no·staff_code·recipient_*·received_at·note·item_code·option_text·unit_price_vat·supply_amount·vat_amount·discount_amount 전부 069 에서 ADD 됨. 누락 컬럼 참조 없음 → 적용 시 문법/존재 오류 없음.
- AI Sync: customers 라인 phone2 추가, legacy_purchases 070 정규화 예정 주석 1줄, legacy_orders/legacy_order_items 2개 항목 추가 — CLAUDE.md AI Agent Sync 규칙 충족.
- 범위: 변경 2파일뿐(schema.ts 6 insertions/1 deletion). 임포터·앱 read·복사UI 변경 없음. legacy_purchases 손대지 않음.
