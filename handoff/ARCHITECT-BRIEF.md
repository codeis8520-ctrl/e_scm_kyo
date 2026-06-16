# Architect Brief — 재고 조정 권한 정리 (입고/출고 제거 · 본사만 조정)

## Goal
재고현황 InventoryModal에서 입고(IN)/출고(OUT) 버튼을 전면 제거하고 조정(ADJUST)만 남긴다. 조정 진입(모달·서버)을 본사 역할(SUPER_ADMIN/HQ_OPERATOR)에게만 허용한다. 비권한자는 재고 조회만 가능.

## Locked Decisions
- IN/OUT 전면 삭제. ADJUST 단일 고정. movement_type 항상 'ADJUST'.
- 조정 권한 화이트리스트 = ['SUPER_ADMIN','HQ_OPERATOR']. 그 외(BRANCH_STAFF/PHARMACY_STAFF/EXECUTIVE)는 조정 불가.
- 서버 가드는 `requireSession()` + role 화이트리스트. transfer 액션 패턴(actions.ts L1207 `const session = await requireSession()` → 거부 시 `{ error }`) 미러.
- **AI 에이전트 무관 — 건드리지 말 것.** `adjust_inventory` 도구는 자체 executor `execAdjustInventory`(tools.ts L1846, ToolContext RBAC) 사용, `adjustInventory` 액션을 호출하지 않음. requireSession 추가는 에이전트 경로에 영향 없음. 액션 분리 불필요.
- RAW/SUB→본사 제한(기존 로직) 그대로 유지.
- 마이그/DB 변경 없음.

## Build Order

### 1. src/lib/actions.ts — adjustInventory (L1006~)
- 함수 맨 앞(L1007 `createClient` 위)에 서버 RBAC 추가:
  - `const session = await requireSession();`
  - `if (session.role !== 'SUPER_ADMIN' && session.role !== 'HQ_OPERATOR') return { error: '재고 조정은 본사 권한만 가능합니다.' };`
- `requireSession`은 이미 import 됨(L9). 기존 RAW/SUB 본사 제한·이하 로직 변경 금지.

### 2. src/app/(dashboard)/inventory/InventoryModal.tsx
- formData.movement_type 기본값 L45: `'IN'` → `'ADJUST'`.
- 조정 유형 토글 3버튼(L260-302) 전체 삭제. 대신 정적 안내 한 줄만: "조정: 현재고를 입력한 수량으로 맞춥니다 (실사 반영)". movement_type은 항상 'ADJUST'로 고정(state 유지하되 변경 UI 없음).
- 수량 라벨(L305-307): 조건 분기 제거하고 '변경 후 수량 *' 고정.
- 힌트/placeholder 문구 '입출고' → '조정'로 정리: memo placeholder(L345) '조정 사유...'.
- 제목(L153) '재고 조정' 유지. RAW/SUB 본사 안내(L212-214, L235-237) 유지.

### 3. src/app/(dashboard)/inventory/page.tsx
- L115 아래 추가: `const isHQUser = userRole === 'SUPER_ADMIN' || userRole === 'HQ_OPERATOR';`
- 헤더 '+ 입출고' 버튼(L514-517): `{isHQUser && (...)}`로 감싸 본사만 노출. 라벨 '+ 입출고' → '+ 재고 조정'.
- 그리드 셀 조정 진입(L770 onClick `handleAdjust`): 비본사면 진입 막기 — `materialBlocked` 인근 조건에 `!isHQUser`도 막힘으로 합류. 비본사일 때 onClick no-op + disabled. title은 비본사면 '재고 조정은 본사 권한만 가능'.
- 플랫 테이블 '입출고' 버튼(L888-893): `{isHQUser && (...)}`로 감싸 비본사에게 숨김(또는 disabled+title). 라벨 '입출고' → '조정'.
- 하단 안내 문구(L805) '입출고' 표현을 '조정'으로 정리. 본사 전용 의미 반영.

## Out of Scope
- bulk_adjust_inventory / 에이전트 도구 description 문구 — 손대지 않음(Known Gap 후보, 이번 단계 아님).
- TransferModal/TransferBatchPanel(창고이동) — 변경 없음.
- inventory_movements 'IN'/'OUT' 과거 데이터 — 그대로.

## AI Sync (필수 검토)
- src/lib/ai/schema.ts BUSINESS_RULES에 한 줄 추가: "재고 조정(adjust)은 본사 역할(SUPER_ADMIN/HQ_OPERATOR)만. UI에서 수동 입고/출고 제거 — 입고=매입(purchase), 출고=판매/창고이동으로만 발생." (에이전트 자체 RBAC는 ToolContext가 별도 처리하나 정책 일치를 위해 명시.)
- DB_SCHEMA 변경 없음(컬럼/enum 불변).

## Acceptance
- npm run build 성공(에러/경고 0).
- 모달에 IN/OUT 버튼 없음. ADJUST 단일.
- 본사 계정: 조정 진입·제출 정상. 비본사 계정: 조정 버튼 미노출/비활성 + 서버 호출 시 거부 메시지.
- 에이전트 adjust_inventory 경로 무변경(코드 diff 없음 확인).
