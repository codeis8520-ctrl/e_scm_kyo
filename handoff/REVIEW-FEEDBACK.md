# Review Feedback — Step 1: 사용유형 코드 테이블 + 코드 관리 UI
Date: 2026-06-12
Status: APPROVED WITH CONDITIONS

## Conditions
- supabase/migrations/079_inventory_usage_types.sql (RLS 블록, L72-77) —
  RLS 정책만 있고 `GRANT` 가 누락됨. 앱은 ANON key 로 접속하므로 Postgres `anon`
  롤로 동작한다(src/lib/supabase/server.ts L10). 브리프가 지정한 "064 패턴"의
  064 마이그(legacy_purchases L49-50)는 명시적 주석 — "RLS 정책이 있어도 GRANT 가
  없으면 anon/authenticated 모두 접근 거부" — 과 함께 `GRANT SELECT, INSERT,
  UPDATE, DELETE ... TO anon, authenticated` 를 포함한다. 079 는 064 의 RLS 정책
  라인만 복사하고 이 GRANT 를 빠뜨렸다.
  결과: 079 적용 후 anon 롤이 inventory_usage_types 에 접근 거부 → 모든
  SELECT/CRUD 가 권한오류. 게다가 모든 호출부가 `(supabase as any)` 방어패턴으로
  error → 빈 배열 매핑(actions.ts L1479-1483, page.tsx L222)이라 UI 는 "등록된
  사용유형이 없습니다" 만 조용히 표시하고 기능이 깨진 것을 숨긴다.
  → 수정: 079 의 RLS 정책 바로 뒤에 064 와 동일하게
    `GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_usage_types TO anon, authenticated;`
    추가. (movements 테이블은 기존 테이블이므로 GRANT 불필요.)

## Escalate to Arch
- 없음. 위 Condition 은 064 마이그의 load-bearing 주석으로 코드 레벨에서 확정
  가능한 사안이라 에스컬레이션 불필요.

## Cleared
다음 항목은 검증 통과:
- CRUD 4종(actions.ts L1476-1573) createChannel/updateChannel/deleteChannel 패턴
  정확히 미러링. code 정규화 slice(0,30), is_system=false·is_active=true 고정,
  update 시 code/is_system 불변.
- deleteInventoryUsageType 두 거부 가드 모두 정상: ① is_system=true 거부
  (L1547-1549) ② inventory_movements.usage_type_id 참조 검사 — 실제로
  inventory_movements 테이블을 .eq('usage_type_id', id).limit(1) 로 조회(L1552-1560).
- 마이그 미적용 시 (supabase as any) 방어로 SELECT/CRUD graceful degrade,
  하드크래시 없음.
- 마이그 079 테이블 정의·시드(로스/자가사용/시음용=FALSE, 기타=TRUE is_system)·
  movements.usage_type_id FK·인덱스·updated_at 트리거 정상, IF NOT EXISTS /
  ON CONFLICT DO NOTHING 으로 멱등.
- AI Sync: schema.ts DB_SCHEMA L26-29 — inventory_movements.usage_type_id 컬럼 +
  reference_type 'USAGE' 주석 + inventory_usage_types 신규 테이블 라인 모두 반영.
- UI: '사용유형' 탭(L410), is_system 행 삭제버튼 미노출(L539-546)·시스템 배지
  (L524) — 서버 가드와 일치(이중 안전). color 필드 없음. 권한/RBAC 회귀 없음.
- Step 2 스코프 비유입: consumeInventory/소모 차감 액션 없음. 기존 차감 참조는
  모두 POS createSalesOrder 흐름(변경 없음).
