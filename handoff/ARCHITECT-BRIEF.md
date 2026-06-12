# Architect Brief — 재고 소모(사용유형) · Step 1: 코드 테이블 + 코드 관리 UI

## Goal
관리자가 재고 "사용유형"(로스/자가사용/시음용/기타) 코드를 추가·수정·비활성·삭제할 수 있게 된다. 실제 소모 차감(다건 OUT) 화면은 Step 2(다음 스프린트). 이 단계만으로 독립 배포·검증 가능(시드 4종 + CRUD).

## 데이터 모델 (Arch 확정 — 변경 금지)
- 마이그 **079_inventory_usage_types.sql 는 Arch 가 이미 작성**(`supabase/migrations/079_...`). Bob 은 수정/추가 마이그 만들지 말 것. Supabase 적용은 Project Owner 후속(apply_one_sql.py).
- 신규 테이블 `inventory_usage_types(id, code UNIQUE, name, sort_order, is_system, is_active, created_at, updated_at)`. 시드: LOSS/로스, SELF_USE/자가사용, SAMPLE/시음용, ETC/기타(is_system=true).
- `inventory_movements.usage_type_id UUID` 컬럼 추가됨(NULL 허용). **Step 2 에서만 사용** — 이 단계에서는 건드리지 않음.
- 소모 기록 규약(Step 2 참고용, 지금 구현 X): movement_type='OUT', reference_type='USAGE', usage_type_id=선택값.

## Build Order
- `src/lib/actions.ts`: CRUD 4종 추가. **createChannel/updateChannel/deleteChannel(L1403~1471) 패턴을 그대로 미러링**.
  - `getInventoryUsageTypes()`: 전체 select, `.order('sort_order')`. (활성 필터 없이 전체 — 관리 화면용)
  - `createInventoryUsageType(formData)`: name 필수. code 는 createChannel 의 정규화 방식(영문 대문자/`_`, slice) 사용하되 `inventory_usage_types` 는 code VARCHAR(30) → slice(0,30). 한글이면 원문. is_system=false 고정. is_active=true. `revalidatePath('/system-codes')`.
  - `updateInventoryUsageType(id, formData)`: name/sort_order/is_active 수정. code/is_system 은 수정 불가(불변). 
  - `deleteInventoryUsageType(id)`: **is_system=true 면 거부**('시스템 기본 유형은 삭제할 수 없습니다. 비활성만 가능합니다.'). 또한 **usage_type_id 로 참조 중인 inventory_movements 가 있으면 거부**(deleteChannel 의 참조검사 패턴: `inventory_movements` 에서 `.eq('usage_type_id', id)` count>0 → '소모 이력이 있어 삭제할 수 없습니다. 비활성 처리하세요.'). 둘 다 통과 시 delete.
- `src/app/(dashboard)/system-codes/page.tsx`: **채널(Channel) 탭 UI 를 템플릿으로** "사용유형" 관리 섹션 추가(같은 페이지의 새 탭 또는 채널 섹션과 동형 카드). 목록(이름/코드/정렬/활성·시스템배지) + 추가폼 + 행 수정/삭제. import 에 4 액션 추가. 채널 탭의 색상(color) 필드는 **불필요 — 넣지 말 것**(usage_type 에 color 컬럼 없음).
- **AI Sync (CLAUDE.md 필수, 같은 PR)**: `src/lib/ai/schema.ts`
  - DB_SCHEMA 에 `inventory_usage_types: id, code, name, sort_order, is_system, is_active` 한 줄 추가.
  - `inventory_movements` 라인(L26)에 `usage_type_id(소모 사용유형 FK, reference_type=USAGE 일 때만)` 추가 + reference_type enum 목록에 'USAGE' 표기.
  - tools.ts WRITE_TOOLS 는 **이 단계에서 추가하지 않음**(에이전트 소모 호출은 Step 2 의 consume 액션이 생긴 뒤 검토). 단 analyze_data 가 새 테이블을 읽을 수 있도록 schema.ts 반영은 위에서 완료.

## Flags (추측 금지)
- code 정규화: createChannel 방식 재사용하되 length 30. UNIQUE 충돌 시 DB error.message 그대로 반환(createChannel 동일).
- RBAC: 코드 관리는 system-codes 페이지 접근 권한(screen_permissions)에 종속 — **별도 역할 체크 코드 추가 불필요**. 페이지가 이미 권한 게이트됨.
- 마이그 미적용 상태에서 빌드/타입은 통과해야 함(supabase 클라이언트는 `as any` 패턴, 기존 코드와 동일). 런타임은 적용 후 동작.

## Out of Scope (→ BUILD-LOG Known Gaps if surfaces)
- 다건 소모 차감 화면 + consumeInventory 서버액션 (Step 2, 별도 스프린트).
- inventory_movements.usage_type_id 쓰기/읽기 (Step 2).
- 재고 페이지(inventory/page.tsx) 변경 일체.
- 소모 이력 보고/필터 화면.
- tools.ts WRITE_TOOLS 소모 도구.

## Acceptance
- `npm run build` 통과.
- system-codes 페이지에 사용유형 목록(시드 4종)·추가·수정·삭제 UI 노출.
- deleteInventoryUsageType: is_system 거부 + movements 참조 거부 분기 존재.
- schema.ts 에 신규 테이블 + usage_type_id + 'USAGE' reference_type 반영.
- Bob 은 마이그 파일을 새로 만들지 않음(079 Arch 작성분 사용).
