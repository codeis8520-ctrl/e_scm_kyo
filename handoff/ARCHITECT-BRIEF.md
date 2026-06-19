# Architect Brief — #48 Phase 3 (재정의: 택배 상태표시 + 오프라인 매장만 필터)

> 방향 수정(Project Owner 정본). 기존 "역방향 sync 정식화" 브리프는 **폐기/강등**.
> 새 원칙: receipt_status를 양방향 sync로 억지로 맞추지 않는다. **택배 건은 판매현황 표시를
> 연결 shipment.status 기준으로 보여주기만** 한다(단일원천 = shipment.status, 1:1 링크는 2a로 완료).
> 오프라인(방문/매장, shipment 없음)은 해당없음 — 기존 수령상태 라벨 유지.

## Goal
판매현황에서 (A) 택배 건은 연결 shipment.status를 그대로 표시하고, (B) "오프라인 매장만" 체크 시
온라인몰(channel='ONLINE') 매출을 숨긴다. 표시/필터 변경뿐 — mutation·재무·재고·sync 영향 없음.

## 폐기/강등된 기존 빌드범위 (Bob: 빌드하지 말 것)
- ❌ 역방향 헬퍼 `syncShipmentFromReceipt` 신설 — **불요. 만들지 않는다.**
- ❌ `reaggregateOrderReceiptStatus` 갭 봉합(서버 역방향 호출 추가) — **불요.**
- ❌ 드로어 인라인 → 헬퍼 통일(C) — **불요.**
- ⚠️ **단, 이미 존재하는 forward 및 기존 인라인 동작은 무손상 유지(제거 금지)**:
  - forward: receipt-sync.ts `syncReceiptStatusFromShipment` (DELIVERED→RECEIVED) — 그대로 둔다.
  - SalesListTab 기존 인라인 shipments update(markItemReceived L1794·markReceiptCompleted
    L1834/1839·revert L1900/1952·delivery_type L1970) — **건드리지 않는다.**
  - bulkUpdateReceiptStatus / AI 일괄 역방향 — 그대로 둔다.
  → 이번 스텝은 **표시 레이어만** 추가. 데이터 흐름·mutation 코드는 0줄 변경.

## 사전 코드조사 결과 (확정 — Bob 재조사 불필요)
파일: `src/app/(dashboard)/pos/SalesListTab.tsx`

**A 관련:**
- shipments는 메인 select 조인 아님. 별도 fetch(L365-388) `.select('... , status')` 로 이미
  `shipments.status` 가져와 각 order에 `r.shipments[]`로 매핑. → **추가 쿼리비용 0.**
- `STATUS_LABEL`(L85): COMPLETED/CANCELLED/... — 이건 sales_orders.status용. **shipment.status용 아님.**
  → shipment.status enum 라벨은 별도 맵 필요. 값: PENDING=대기중, PRINTED=출력완료,
    SHIPPED=발송완료, DELIVERED=배송완료. (택배관리 page.tsx의 라벨과 일치시킬 것 — Bob이 거기 STATUS_LABEL 확인.)
- 현재 표시: `receiptStatusLabelFor(o.receipt_status, hasShipment)` (L750 행, L919 CSV).
  - 택배 건(shipment 존재) RECEIVED → '배송완료', 미완 → RECEIPT_STATUS_LABEL(택배예정 등).
- `ShipmentRow.status: string|null`(L47) 이미 타입에 있음.
- **수령상태순 그룹/정렬(L618 receiptGroups)은 내부 `receipt_status` 값으로 버킷팅** —
  표시 라벨만 바꾸면 그룹/정렬 무영향(충돌 없음). 버킷 키 로직 변경 금지.

**B 관련:**
- 패턴 정본 = `hideReceived`: state(L232) + PersistedFilters 인터페이스(L176) + 저장 payload(L266-272)
  + 복원(saved.hideReceived) + 토글 UI(L1248-1261) + 필터 적용.
- `channel`은 OrderRow.channel(L54)에 select됨(L310). client에서 읽기 가능.
- 메인 쿼리에서 `.neq('channel','ONLINE')` 가능하나, ONLINE이 아닌 NULL/STORE 등 혼재 →
  **클라이언트 필터 권장**: `o.channel !== 'ONLINE'`. (서버 .neq는 NULL 제외 위험 — 클라가 안전.)

## Build Order

### A. 택배 건 상태표시를 shipment.status로
1. shipment.status 라벨 맵 신설(상단, STATUS_LABEL과 별개):
   `const SHIPMENT_STATUS_LABEL = { PENDING:'대기중', PRINTED:'출력완료', SHIPPED:'발송완료', DELIVERED:'배송완료' }`
   - **택배관리 page.tsx의 동일 enum 라벨을 먼저 grep해 문구 일치** 확인 후 채택(불일치 시 택배관리 기준).
2. 표시 결정 — **병기(권장)**: 택배 건은 기존 수령상태 라벨 위/아래(또는 옆)에 shipment.status 라벨을 함께.
   - **결정: shipment.status 라벨을 주(主) 표시로, 기존 receipt 라벨은 보조 또는 생략.**
     화면에서 어느 쪽이 자연스러운지 Bob이 1차 판단하되, 기본 방향 = **택배 건은 shipment.status 라벨로 표시**
     (대체), 방문/퀵(shipment 없음)은 기존 `receiptStatusLabelFor` 유지.
   - 구현: 헬퍼 하나 추가 — `displayStatusLabel(o)`:
     - `const ship = o.shipments?.[0]` (1:1)
     - ship && ship.status 있으면 → `SHIPMENT_STATUS_LABEL[ship.status] ?? receiptStatusLabelFor(...)`
     - else → `receiptStatusLabelFor(o.receipt_status, false)` (방문/퀵/직접)
   - L750(행 표시)·L919(CSV) 둘 다 이 헬퍼로 교체. **두 곳 일관.**
3. 배지 색상: 기존 RECEIPT_STATUS_BADGE 재사용 가능하면 재사용. shipment 상태별 색이 필요하면
   간단한 맵 추가(과한 디자인 금지 — 완료=회색, 진행=강조 톤 정도).
4. Flag: shipment.status가 NULL/미지정 택배 건 → 라벨 맵 미스 시 기존 receiptStatusLabelFor로 폴백(빈칸 금지).
5. Flag: 정렬·필터(수령상태순 그룹)는 **내부 receipt_status 기준 유지** — 표시 라벨 변경이
   그룹핑을 바꾸지 않음을 확인하고, 그룹 헤더 문구(L620 LABEL '수령·배송완료')는 현행 유지.

### B. "오프라인 매장만" 체크박스
1. PersistedFilters에 `offlineOnly: boolean` 추가(L155-177).
2. state: `const [offlineOnly, setOfflineOnly] = useState(() => saved.offlineOnly ?? false)`.
3. 저장 payload(L266-272)에 `offlineOnly` 추가, 의존성 배열(L274-276)에도 추가.
4. 필터 적용: 렌더용 filtered 산출 지점에서 `offlineOnly ? rows.filter(o => o.channel !== 'ONLINE') : rows`.
   - 클라이언트 필터. 검색/날짜/기타 필터 뒤 단계에 합류.
5. UI: hideReceived 토글(L1248-1261) **바로 옆에 동일 패턴** 버튼 추가. 라벨 "오프라인 매장만".
   - title: "체크 시 온라인몰(자사몰) 주문을 숨기고 오프라인 매장 매출만 표시합니다".
6. Flag — '온라인몰' 탭과 의미 구분: 이 필터는 **숨김 토글**(현재 통합 리스트에서 ONLINE 제외).
   별도 '온라인몰' 탭/뷰가 있다면 그건 ONLINE만 보는 뷰 — 본 토글과 반대 방향. 혼동 주석 1줄 남길 것.

### C. AI Sync — 점검만
- 표시/필터 변경 = DB 스키마·enum·비즈룰·도구 변경 없음 → `schema.ts`/`tools.ts` **무변경**.
- shipment.status enum 값은 이미 DB_SCHEMA에 존재(신규 아님). 추가 동기화 불요. (커밋 전 매트릭스 대입 결과: 해당없음.)

## Out of Scope
- 역방향 sync 정식화/갭봉합 일체(상단 폐기 목록) → 이번 스텝 비범위. 필요 시 별도 결정.
- 분할배송(1전표 N배송) — 2a에서 1:1 확정. `shipments[0]` 단건 전제.
- shipment.status 자체 변경 UX(판매현황에서 상태를 바꾸는 기능) → 표시 전용. 변경은 택배관리.

## Acceptance
- 택배 건(연결 shipment 존재): 행/CSV 상태가 shipment.status 라벨(대기중/출력완료/발송완료/배송완료)로 표시.
- 방문/퀵/직접(shipment 없음): 기존 수령상태 라벨(방문예정/수령완료 등) 무변경.
- shipment.status NULL인 택배 건: 빈칸 없이 기존 receipt 라벨로 폴백.
- "오프라인 매장만" 체크 → channel='ONLINE' 행 숨김. 해제 → 전체. 새로고침 후 상태 유지(localStorage).
- 수령상태순 정렬·그룹: 표시 라벨 변경에도 그룹핑/순서 동일(회귀 없음).
- 기존 forward sync·인라인 shipments update 코드 0줄 변경(제거·수정 없음).
- `npm run build` 0 error.
- Richard 리뷰: 표시 폴백 누락·CSV/행 라벨 불일치·offlineOnly 영속 누락·그룹핑 회귀 점검.
