# Architect Brief — Step: 판매상세 직접 수정 (고객/수령일/받는분)

## Goal
SalesDetailDrawer에서 고객(재연결+표시명)·수령일자·받는분(이름/전화/우편/주소/상세)을 판매번호 유지한 채 수정하고 audit_logs에 변경이력을 남긴다.

## Locked Decisions (변경 금지)
- **신규 서버액션 파일**: `src/lib/sales-revise-actions.ts` 에 `updateSalesOrderDetails`. (sales-cancel-actions.ts 와 동일 import 스타일: `requireSession`, `writeAuditLog` from `@/lib/session`, `createClient` from `@/lib/supabase/server`, `revalidatePath`.)
- **RBAC = `requireSession()` 만** (역할 게이트 없음). 근거: 같은 드로어의 형제 액션(convertOrderToParcel/convertOrderToPickup/addSalesOrderItem/cancelSale)이 전부 requireSession only. 일관성. 목록은 상위에서 이미 지점 필터됨. 추가 지점 스코프 넣지 말 것.
- **상태 게이트**: 수정 허용은 `status NOT IN ('CANCELLED','REFUNDED','PARTIALLY_REFUNDED')` 일 때만. 위반 시 `{ error: '취소/환불된 전표는 수정할 수 없습니다.' }` 반환. (cancelSale 의 status 분기 패턴 참고.)
- **order_number 절대 불변** — payload 에 포함 금지, update 대상 아님.
- **부분 업데이트**: payload 에 전달된(undefined 아닌) 필드만 sales_orders update 객체에 포함. 전달 안 된 필드는 건드리지 않음.
- **받는분 양쪽 업데이트(결정)**: recipient_* 변경 시 `sales_orders.recipient_*` 항상 update + shipment 레코드가 존재하면 `shipments.recipient_*` 도 같이 update. (드로어 표시는 shipment 우선이므로 동기화 필수. shipment 없으면 sales_orders 만.) shipment 존재 여부는 `shipments` 에서 `sales_order_id=orderId` maybeSingle 로 판단.
- **고객 재연결**: `customer_id` 가 payload 에 있으면(빈 문자열→null 허용) sales_orders.customer_id 업데이트. `buyer_name`/`buyer_phone` 텍스트도 별도 필드로 부분 업데이트(둘 다 가능 — 정책: 재연결 + 텍스트 둘 다).
- **audit 형식(결정)**: 변경된 필드만 모아 **1건** writeAuditLog 기록. `action:'UPDATE'`, `tableName:'sales_orders'`, `recordId: orderId`, `description: \`판매상세 수정: ${order_number}, 변경: [필드라벨 목록], 사유: ${reason||'-'}\``, `oldData`/`newData` 에 변경된 필드의 전/후 값만 객체로. 한글 필드라벨 매핑(customer_id='고객연결', buyer_name='표시명', receipt_date='수령일', recipient_name='받는분', recipient_phone='연락처', recipient_zipcode='우편', recipient_address='주소', recipient_address_detail='상세주소'). 변경 0건이면 update/audit 스킵하고 success 반환.
- **반환**: `{ success: true }` 또는 `{ error: string }`. try/catch 로 감싸 `{ error: \`수정 실패: ${err.message}\` }`.
- **DB/마이그레이션 변경 없음**: recipient_* 는 마이그 083(적용 대기), audit_logs 기존. 새 컬럼 추가 금지. (단 083 미적용 환경 방어: sales_orders 의 recipient_* update 가 42703 나면 그 5필드만 빼고 재시도 — webhook.ts 의 083 폴백 패턴과 동일. shipments recipient_* 는 046부터 존재하므로 폴백 불필요.)

## payload 시그니처
```ts
updateSalesOrderDetails(input: {
  orderId: string;
  customer_id?: string | null;   // null = 연결 해제
  buyer_name?: string | null;
  buyer_phone?: string | null;
  receipt_date?: string | null;  // 'YYYY-MM-DD'
  recipient_name?: string | null;
  recipient_phone?: string | null;
  recipient_zipcode?: string | null;
  recipient_address?: string | null;
  recipient_address_detail?: string | null;
  reason?: string;
}): Promise<{ success: true } | { error: string }>
```
서버에서 order 현재값 select(`order_number, status, customer_id, buyer_name, buyer_phone, receipt_date, recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail`) → status 게이트 → diff 계산.

## Build Order
1. `src/lib/sales-revise-actions.ts` 생성 — `'use server'`, 위 액션. revalidatePath('/pos').
2. `src/app/(dashboard)/pos/SalesListTab.tsx` SalesDetailDrawer 편집 UI:
   - 신규 state: `editing`(boolean), 편집용 필드 state(고객 검색/선택 + buyer_name 텍스트, receipt_date, recipient 5필드), `savingDetails`(boolean).
   - 게이트 플래그: `const detailEditable = order && !['CANCELLED','REFUNDED','PARTIALLY_REFUNDED'].includes(order.status);`
   - "기본 정보" 그리드(L1969~) 의 **고객**(L1983~), **수령** 근처에 연필 토글 버튼. editing=true 시 인라인 편집 폼 표시:
     - 고객: 현재 표시 + '고객 변경' 버튼 → 기존 `/api/customers/search` 호출 인라인 검색 드롭다운(CustomerLookupModal L1286 의 fetch 패턴 재사용, 단 onSelect 로 customer_id+표시 세팅). + 표시명(buyer_name) 텍스트 input + '연결 해제' 옵션.
     - 수령일자: `<input type="date">` (receipt_date).
     - 받는분: 이름/전화/우편/주소/상세 5 input — convert 폼(L2419~)의 input 스타일 재사용.
   - 저장 버튼 → `updateSalesOrderDetails(payload)` → 결과 error면 alert, 성공이면 `editing=false` + `await loadDetail(true)` + `onChanged()`.
   - 취소/환불 전표: 편집 버튼 비활성 + 안내문(`취소/환불 전표는 수정할 수 없습니다`).
   - 고객 검색 결과 타입은 기존 CustomerLookupModal 응답(`{ customers: [{id,name,phone,...}] }`) 그대로.
3. `npm run build` 통과.

## Flags (Bob: 추측 금지)
- 고객 검색 인라인 드롭다운은 **신규 모달 만들지 말고** CustomerLookupModal 의 fetch(`/api/customers/search?q=...`) 로직만 차용해 드로어 내부 인라인으로. 모달 띄워도 되지만 onSelect 콜백이 customer_id 를 드로어 편집 state 로 넘겨야 함(현 CustomerLookupModal 은 onClose 만 받음 → 그대로 못 씀, 차용/확장 필요).
- shipment recipient update 시 `delivery_message`/sender_* 등 다른 필드 건드리지 말 것.
- buyer_phone 도 편집 가능하게(표시명 옆). 정책상 텍스트 스냅샷.

## Out of Scope (BUILD-LOG Known Gaps 행)
- 수령방법(방문↔택배/퀵) 전환 — 이미 드로어에 존재(convertOrderToParcel/Pickup·changeDeliveryType). 신규 추가 없음. 확인만.
- 품목/금액/결제 수정 — 별도 기존 흐름.
- legacy_orders / 카페24 원천 역동기화 — 안 함. ERP 전표만 수정.
- 고객 신규 생성 — 재연결만. 신규 고객 등록은 기존 별도 버튼.

## Acceptance
- 취소·환불 전표: 편집 버튼 비활성 + 안내.
- 정상 전표: 고객 재연결 후 드로어 '고객'에 새 고객명/전화 표시(loadDetail 재조회 반영), 목록(onChanged)도 갱신.
- buyer_name 텍스트 수정 시 customer 미연결 표시명 갱신.
- 수령일자 변경 → order.receipt_date 반영(수령일자별 그룹 재배치는 onChanged 로).
- 받는분 변경 → shipment 있으면 배송 정보 받는분/주소도 같이 바뀜.
- audit_logs 에 1건(변경 필드·전후값·order_number·사유) 기록.
- order_number 불변.
- `npm run build` 에러/경고 0.
