# Review Request — Step 1: 사용유형 코드 테이블 + 코드 관리 UI
Date: 2026-06-12
Ready for Review: YES

## Files Changed

### src/lib/actions.ts
- L1474-1573 — Inventory Usage Types CRUD 4종 (createChannel/updateChannel/deleteChannel 패턴 미러링).
  - getInventoryUsageTypes (L1476-1484): 전체 select, order('sort_order'), 활성필터 없음.
  - createInventoryUsageType (L1486-1512): name 필수, code 정규화 slice(0,30), is_system=false·is_active=true 고정, revalidatePath.
  - updateInventoryUsageType (L1514-1535): name/sort_order/is_active만 수정 (code/is_system 불변).
  - deleteInventoryUsageType (L1537-1573): ① is_system=true 거부 ② inventory_movements.usage_type_id 참조 존재 시 거부 ③ 통과 시 delete.

### src/lib/ai/schema.ts (AI Sync — 필수)
- L26 — inventory_movements 라인에 usage_type_id 컬럼 추가 + reference_type 'USAGE' 주석(L27).
- L28-29 — inventory_usage_types 신규 테이블 라인 + 소모 기록 규약 주석.

### src/app/(dashboard)/system-codes/page.tsx
- L14 — import create/update/deleteInventoryUsageType (get은 클라이언트 직접 select 사용).
- L39-46 — InventoryUsageType 인터페이스.
- L172 — usageTypes state.
- L186-187 — showUsageTypeModal / editingUsageType state.
- L220-223 — fetchData usage_types 분기 ((supabase as any) 방어 패턴).
- L321-330 — handleDeleteUsageType (서버 거부 메시지 alert 노출).
- L410 — '사용유형' 탭 (채널 다음).
- L494-572 — 사용유형 목록 렌더 섹션 (채널 카드 동형, color 필드 없음, 시스템 행은 삭제 버튼 미노출·시스템 배지).
- L1300-1306 — UsageTypeModal 마운트.
- L1493-1607 — UsageTypeModal 컴포넌트 (ChannelModal 동형, color 제외).

## Self-Review
- Richard가 먼저 볼 곳: deleteInventoryUsageType 의 두 거부 분기 순서/메시지, 시스템 행 삭제버튼 숨김 처리. → 브리프 문구 그대로 구현, 시스템 행은 UI에서도 삭제 차단(이중 안전).
- 브리프 요구사항 전수 확인: CRUD 4종 / UI 탭(color 없음) / system 보호 / movements 참조검사 / schema.ts 3요소 / 마이그 미작성 / `as any` 방어 — 모두 충족.
- 데이터 빈/실패 시: 목록 비면 "등록된 사용유형이 없습니다" 표시. 삭제 거부 시 서버 한글 메시지 alert. 마이그 미적용 시 select 결과 null → 빈 목록(크래시 없음).
- `npm run build` ✓ Compiled successfully in 6.3s, 에러·경고 없음.

## Open Questions
- 없음. 브리프가 명확하여 추가 결정 없이 구현.

## Out of Scope (logged in BUILD-LOG)
- Step 2: 다건 소모 차감 화면 + consumeInventory 서버액션, inventory_movements.usage_type_id 쓰기/읽기, tools.ts WRITE_TOOLS 소모 도구.
