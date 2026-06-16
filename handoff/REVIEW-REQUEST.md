# Review Request — Feature D: 재고 조정 권한 정리 (입고/출고 제거 · 본사만 조정)
Date: 2026-06-16
Ready for Review: YES

## Files Changed

- src/lib/actions.ts:1007-1010 — adjustInventory 맨 앞에 `requireSession()` + role 화이트리스트(SUPER_ADMIN/HQ_OPERATOR) 서버 가드. 비권한자 `{ error: '재고 조정은 본사 권한만 가능합니다.' }`. transfer 패턴 미러. 이하 RAW/SUB 본사 제한·계산 로직 무변경.
- src/app/(dashboard)/inventory/InventoryModal.tsx:45 — formData.movement_type 기본값 'IN'→'ADJUST'.
- src/app/(dashboard)/inventory/InventoryModal.tsx:260-268 — IN/OUT/ADJUST 3버튼 토글 전체 삭제 → 정적 안내 "조정: 현재고를 입력한 수량으로 맞춥니다 (실사 반영)" 1줄. 수량 라벨 '변경 후 수량 *' 고정(조건분기 제거).
- src/app/(dashboard)/inventory/InventoryModal.tsx:307 — memo placeholder '입출고 사유...'→'조정 사유...'.
- src/app/(dashboard)/inventory/page.tsx:116 — isHQUser 추가(userRole SUPER_ADMIN/HQ_OPERATOR, 쿠키 기반 isBranchUser와 동일 방식).
- src/app/(dashboard)/inventory/page.tsx:513-525 — 헤더 버튼 `{isHQUser && (...)}` 래핑, 라벨 '+ 입출고'→'+ 재고 조정'.
- src/app/(dashboard)/inventory/page.tsx:771-797 — 그리드 셀: `adjustBlocked = materialBlocked || !isHQUser`. onClick/disabled/스타일/↓배지 모두 adjustBlocked 기준. title: 비본사='재고 조정은 본사 권한만 가능', RAW/SUB='원자재·부자재는 본사에서만 조정 가능'. 조회 자체는 유지.
- src/app/(dashboard)/inventory/page.tsx:812 — 그리드 하단 안내 문구 '입출고'→'재고 조정(본사 권한)'·'조정'.
- src/app/(dashboard)/inventory/page.tsx:894-902 — 플랫 테이블 조정 버튼 `{isHQUser && (...)}` 래핑, 라벨 '입출고'→'조정', title 문구 정리.
- src/lib/ai/schema.ts:159 — BUSINESS_RULES [재고 처리 판단]에 "재고 조정(adjust)은 본사 역할만 / 수동 입고·출고 제거 — 입고=매입, 출고=판매·이동" 1줄.

## Self-Review
- Richard 첫 지적 후보: 비본사 그리드 셀이 disabled여도 시각적으로 active처럼 보이는지 → adjustBlocked가 스타일·↓배지까지 일괄 적용해 greyed/cursor-not-allowed로 통일 확인.
- Brief 요구사항 전부 구현: 서버가드·모달 토글삭제·라벨·placeholder·isHQUser 3개 진입점 게이트·AI Sync 1줄. 확인 완료.
- 데이터/실패 시 사용자: 비본사가 서버 직접 호출해도 친화적 한글 에러 반환. 모달은 본사에게만 노출되나 가드가 최종 방어선.
- AI 에이전트 경로: tools.ts execAdjustInventory 미사용 경로 — diff 0 (건드리지 않음).
- npm run build ✓ Compiled successfully in 6.8s (에러/경고 0).

## Open Questions
- 없음.

## Out of Scope (logged in BUILD-LOG)
- bulk_adjust_inventory / 에이전트 도구 description 문구 (이번 단계 아님).
- inventory_movements 과거 'IN'/'OUT' 데이터 그대로.
- TransferModal/TransferBatchPanel(창고이동) 무변경.
