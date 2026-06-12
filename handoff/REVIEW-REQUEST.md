# Review Request — Step 2 (병합): 방문(PICKUP) ↔ 택배(PARCEL) 양방향 전환
Date: 2026-06-12
Ready for Review: YES

`npm run build` ✅ Compiled successfully in 6.9s — error/warning 0. DB/마이그 변경 없음(기존 테이블만).

## Files Changed

### src/lib/sales-revise-actions.ts (신규 헬퍼 2 + export 2)
- `sales-revise-actions.ts:463-475` — `deriveOrderReceiptStatus(items)`: 주문 receipt_status 도출 헬퍼. 우선순위 PARCEL_PLANNED>QUICK_PLANNED>PICKUP_PLANNED>(전부 RECEIVED→RECEIVED), receiptDate는 RECEIVED일 때만 오늘.
- `sales-revise-actions.ts:477-496` — `reaggregateOrderReceiptStatus(db, orderId)`: 품목 재조회→도출→sales_orders update. 052/051 미적용 시 isMissingColumnError 폴백으로 조용히 skip.
- `sales-revise-actions.ts:500-657` — `convertOrderToParcel({orderId, recipient})`: 방문→택배. loadEditableOrder 가드 + recipient name/phone/address 필수검증 + 미수령 품목 PARCEL_PLANNED(.neq RECEIVED) + shipment upsert(있으면 update, 없으면 processPosCheckout ②-b 폴백 복제 insert) + 재집계 + revalidate(/pos,/shipping) + audit. recalc/payment/journal 미호출.
- `sales-revise-actions.ts:659-727` — `convertOrderToPickup({orderId})`: 택배→방문. shipment.status≠PENDING 거부 / PENDING이면 DELETE + 미수령 품목 PICKUP/RECEIVED/오늘 + 재집계 + revalidate + audit.

### src/app/(dashboard)/pos/SalesListTab.tsx (드로어 UI)
- `SalesListTab.tsx:11` — import convertOrderToParcel, convertOrderToPickup.
- `SalesListTab.tsx:1069-1078` — convert 상태 8개(converting, showConvertForm, cvName/Phone/Zipcode/Address/AddressDetail/Message).
- `SalesListTab.tsx:1338-1403` — openConvertForm(고객 name/phone prefill + customers.address lazy fetch) + handleConvertToParcel + handleConvertToPickup.
- `SalesListTab.tsx:1980-1991` — shipment 헤더에 '🏠 방문 수령으로 전환' 버튼(editable 게이트). 서버 가드 거부 에러를 alert 그대로 노출.
- `SalesListTab.tsx:2038-2105` — shipment 없고 editable이면 '📦 택배로 전환' 버튼 + 인라인 폼(수령자 6필드, Step1 add-form 스타일).

### src/lib/ai/schema.ts (AI Sync)
- `schema.ts:195` — BUSINESS_RULES에 전표 배송전환(방문↔택배) 규칙 1줄. DB_SCHEMA 컬럼 변경 없음(신규 마이그 없음).

## Self-Review

**Richard가 가장 먼저 볼 것 — shipment insert 폴백 정합성**: payloadFull(delivery_type 포함) → 42703 시 delivery_type 제거 → 여전히 42703 시 created_by 제거. processPosCheckout ②-b는 sender_* 확장컬럼(046)도 폴백했으나 본 액션은 그 확장 sender 컬럼을 payload에 넣지 않으므로(sender_name/phone만 = base 컬럼) 제거 대상 없음 — 의도적 단순화, 동등 안전.

**브리프 모든 요구 구현 확인**:
- Acceptance 1 (build 0): ✅
- Acceptance 2 (게이트): editable UI 게이트 + 양 액션 loadEditableOrder 서버 거부. ✅
- Acceptance 3 (방문→택배): shipment insert(PENDING/PARCEL), 품목 PARCEL_PLANNED, 재집계 PARCEL_PLANNED, 금액 미변동(recalc 미호출). ✅
- Acceptance 4 (택배→방문 PENDING): shipment DELETE, 품목 RECEIVED/오늘, 재집계. ✅
- Acceptance 5 (PRINTED/SHIPPED/DELIVERED 거부): `status !== 'PENDING'` → 브리프 지정 에러 반환. ✅
- Acceptance 6 (혼합 재집계·RECEIVED 보존): `.neq('receipt_status','RECEIVED')` + deriveOrderReceiptStatus 우선순위. ✅
- Acceptance 7 (050/052/046 미적용 폴백): isMissingColumnError 폴백 (품목 update, shipment insert/update, 재집계 전부). ✅
- Acceptance 8 (수령자 필수 누락 거부): 클라+서버 양쪽 검증. ✅

**데이터 비어있거나 실패 시 사용자**: 모든 실패는 한글 친화 메시지 alert. 택배→방문 서버 가드 에러는 그대로 alert 노출(브리프 지정). raw DB 에러는 console.error만, 사용자엔 일반 메시지.

## Open Questions
- `handleConvertToParcel/Pickup`는 `loadDetail`(useCallback, 선언 후행)을 참조하나 이벤트 시점 호출이라 TDZ 무관 — 빌드 통과 확인. 패턴 우려 시 확인 바람.
- 신규 shipment insert의 `created_by` 컬럼이 shipments에 실재하는지 미검증(폴백으로 안전 제거하나 첫 시도에 포함). 42703 폴백이 흡수.

## Out of Scope (logged in BUILD-LOG)
- 품목 단건 delivery_type 토글 UI, 배송비 과금, shipments CANCELLED soft-cancel, PRINTED/SHIPPED 송장 회수 워크플로, changeDeliveryType(PARCEL↔QUICK) 통합, 에이전트 tools.ts 도구.
