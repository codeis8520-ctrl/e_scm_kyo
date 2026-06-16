# Review Request — 판매상세 직접수정 (고객/수령일/받는분)
Date: 2026-06-16
Ready for Review: YES (재제출 — Must Fix 1건 반영)

## Re-submit — Must Fix 반영 (2026-06-16)
- **REVIEW-FEEDBACK Condition (L926)**: shipments.recipient_* 동기화 update가 결과를 버리던 문제 수정.
  src/lib/sales-revise-actions.ts:925~937 — update 결과 `{ error: shipErr }`를 받아 실패 시 `console.error` 후
  `{ error: '받는분 정보의 배송 동기화에 실패했습니다.' }` 반환. audit/revalidate 이전에 분기하므로
  shipment 동기화 실패가 audit에 성공으로 기록되지 않음 (형제 convertOrderToParcel L628~631 패턴 동일).
  `npm run build` ✓.

## Files Changed

### src/lib/sales-revise-actions.ts
- L795~1009 (append) — 신규 `updateSalesOrderDetails(input)` (L817) + 내부 `finishUpdateSalesOrderDetails`(L861). requireSession only, 상태 게이트(CANCELLED/REFUNDED/PARTIALLY_REFUNDED 차단), order_number 미포함, 부분 diff 업데이트, 받는분 양쪽(sales_orders 항상 + shipment 존재 시) 동기화, 변경필드만 audit 1건(한글라벨+사유+old/new), 083 미적용 42703 폴백(조회·update 양쪽). 라벨맵 DETAIL_FIELD_LABELS·RECIPIENT_FIELDS는 액션 직전.

### src/app/(dashboard)/pos/SalesListTab.tsx
- L11 — import에 `updateSalesOrderDetails` 추가.
- L1794 — loadDetail 1차 order select에 recipient_* 5컬럼 추가(shipment 없는 전표 받는분 prefill용). 폴백 분기 미변경(42703 흡수).
- 신규 state(convert state 직후) — editingDetails/savingDetails + 편집 필드 + 인라인 고객검색 state.
- L1879 `detailEditable` 플래그 / L1882 `openEditDetails`(받는분 prefill = shipment 우선→order.recipient_*) / 고객검색 디바운스 useEffect / L1918 `saveDetails` → updateSalesOrderDetails → loadDetail(true) + onChanged().
- L2053~ 기본정보 헤더에 ✏️ 수정 토글(취소/환불 전표 비활성+안내문).
- L2133~ 전표 상세 수정 인라인 폼(고객 변경/연결해제 + 표시명/연락처, 수령일자 date, 받는분 5필드, 사유, 저장/취소). convert 폼 input 스타일 재사용.

### src/lib/ai/schema.ts
- L204 — BUSINESS_RULES 전표 상세 직접수정 1줄 추가. tools.ts 미변경(신규 호출 불필요).

## Self-Review
- **Richard가 먼저 볼 것**: customer_id null 처리 — `''→null` 정규화 + before/after 동일 시 스킵. 편집모드 진입만 하고 안 건드리면 diff 0건 → audit/update 스킵하고 success.
- **요구사항**: 서버액션·RBAC·상태게이트·order_number불변·부분업데이트·받는분양쪽+shipment동기화·audit1건(한글라벨/사유/전후값)·42703폴백·드로어편집UI·고객검색차용(신규모달X)·5필드·취소환불비활성·schema줄 전부 구현. tools.ts/마이그 변경 없음.
- **실패 UX**: 에러 시 한글 alert, 검색 실패 시 빈 결과, raw 에러 노출 없음.
- `npm run build` ✓ 에러/경고 0.

## Open Questions
- 없음. 브리프 Locked Decisions 전부 반영.
- (참고) 브리프는 "신규 파일 생성"이라 했으나 src/lib/sales-revise-actions.ts 가 이미 존재(형제 액션 포함) → 동일 import·helper 재사용 위해 같은 파일에 append. 드로어 import도 이미 이 파일 사용 중.

## Out of Scope (logged in BUILD-LOG)
- 수령방법(방문↔택배/퀵) 전환 — 기존 존재, 확인만.
- 품목/금액/결제 수정, legacy/카페24 역동기화, 고객 신규생성 — 범위 밖.
