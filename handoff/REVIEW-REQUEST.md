# Review Request — #48 Phase 3 (택배 상태표시 + 오프라인 매장만 + 매출처 콤보 활성필터)
Date: 2026-06-19
Ready for Review: YES

> 표시/필터 레이어만. mutation·재무·재고·forward sync·기존 인라인 shipments update 0줄 변경.
> 모든 변경 단일 파일: `src/app/(dashboard)/pos/SalesListTab.tsx`

## Files Changed
- SalesListTab.tsx:115-141 — `SHIPMENT_STATUS_LABEL`/`SHIPMENT_STATUS_BADGE` 맵 신설(택배관리 page.tsx L109 라벨 일치) + 헬퍼 `displayStatusLabel(o)`(택배=shipment.status, NULL폴백 receiptStatusLabelFor) + `displayStatusBadge(o, receiptKey)`.
- SalesListTab.tsx:~191 — PersistedFilters 인터페이스에 `offlineOnly: boolean` 추가.
- SalesListTab.tsx:~252 — `offlineOnly` state(saved 복원) + '온라인몰 뷰와 반대방향' 주석.
- SalesListTab.tsx:~289 — 저장 payload + deps 배열에 `offlineOnly` 추가(localStorage 영속).
- SalesListTab.tsx:~589 — `filtered` memo 최상단 `offlineOnly && o.channel==='ONLINE' → 제외`(클라 필터) + memo deps에 offlineOnly.
- SalesListTab.tsx:~778 — 행 상태 표시를 `displayStatusBadge`/`displayStatusLabel`로 교체.
- SalesListTab.tsx:~948 — CSV 수령현황 열을 `displayStatusLabel`로 교체(행과 일관).
- SalesListTab.tsx:~1065 — 매출처 콤보 옵션 `is_active!==false || id===branchFilter`로 활성필터(선택된 비활성 지점 유지).
- SalesListTab.tsx:~1290 — '오프라인 매장만' 토글 버튼('미결 건만 보기' 옆, 동일 패턴).

(라인은 편집 누적으로 ±수 줄 이동 가능 — diff 기준 확인)

## 중점 점검 (브리프 Acceptance 대응)
- 택배 건: 행/CSV가 shipment.status 라벨로 표시되는가. shipment.status NULL인 택배 건 → 빈칸 없이 receipt 라벨 폴백되는가.
- 방문/퀵/직접(shipment 없음): 기존 수령상태 라벨 무변경인가.
- 행 라벨 vs CSV 라벨 일치(둘 다 displayStatusLabel).
- offlineOnly: channel='ONLINE' 숨김, 해제 시 전체, 새로고침 후 영속(payload+deps+복원 3곳 모두).
- 수령상태순 그룹/정렬(receiptGroups): 내부 receipt_status 버킷 그대로 — 표시 라벨 변경이 그룹핑 회귀 없음 확인.
- 매출처 콤보: 활성 지점만 노출 + 이미 선택된 비활성 지점은 누락 안 됨.

## Open Questions
- 택배 상태 배지 색: PENDING=강조(amber), PRINTED/SHIPPED=진행(blue), DELIVERED=회색(종결)로 단순 매핑. 과한 디자인 회피 의도 — 톤 적절성만 확인 부탁.

## Out of Scope (logged in BUILD-LOG)
- 역방향 sync 정식화(syncShipmentFromReceipt) — 방향 재정의로 비범위 확정.
- 부분환불 per-line 재고복원 — 데이터 부재(영구).
