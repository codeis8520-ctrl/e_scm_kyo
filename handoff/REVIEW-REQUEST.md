# Review Request — 재사용 토대 2개 (택배 프리미티브 + batch_execute 팬아웃)
Date: 2026-06-20
Ready for Review: YES

빌드는 ARCHITECT-BRIEF.md를 그대로 따랐습니다. 신규 회계/재고 로직 0, 마이그 0, `npm run build` 0 error.

## Files Changed

### 토대 A — create_sales_order 택배 확장
- src/lib/actions.ts:2978-2988 — createSimpleSalesOrder input에 optional ship_from_branch_id + shipping{recipient_*, delivery_message, delivery_type} 타입 추가(하위호환).
- src/lib/actions.ts:3037-3046 — payload 조립부: input.shipping 있으면 payload.shipping(delivery_type 기본 PARCEL) + payload.shipFromBranchId(미지정 시 branch_id). sender_* 미설정(CJ 폴백 정책 보존).
- src/lib/ai/tools.ts:1109-1113 — create_sales_order description: "미지원: 택배" 삭제 + 택배(PENDING 1:1, update_shipment_tracking 별도) 문구.
- src/lib/ai/tools.ts:1134-1139 — 도구 파라미터에 recipient_name/phone/address/zipcode/address_detail/delivery_message 추가.
- src/lib/ai/tools.ts:3999-4004 — execCreateSalesOrder args에 택배 6필드.
- src/lib/ai/tools.ts:4011-4016 — 택배 모드 판정(하나라도 있으면) + 셋 다 필수 검증.
- src/lib/ai/tools.ts:4063-4075 — createSimpleSalesOrder 호출에 ship_from_branch_id=branch.id + shipping 객체 spread(택배일 때만).
- src/lib/ai/tools.ts:4089 — 반환에 택배 시 `배송:` 라인 추가.

### 토대 B — batch_execute 팬아웃
- src/lib/ai/tools.ts:1145-1175 — batch_execute 도구 정의(AGENT_TOOLS, create_sales_order 정의 뒤).
- src/lib/ai/tools.ts:1415-1416 — WRITE_TOOLS에 'batch_execute'.
- src/lib/ai/tools.ts:1435-1447 — DANGEROUS_TOOLS에 'batch_execute' + 신규 export const FANOUT_TOOLS(3멤버).
- src/lib/ai/tools.ts:1627-1628 — executeTool switch에 case 'batch_execute'.
- src/lib/ai/tools.ts:3907-3990 — execBatchExecute 구현(가드1 재귀차단·가드2 화이트리스트·1~50 상한·item별 executeTool 정식경로·독립 try/catch·결과압축).

### route.ts
- src/app/api/agent/route.ts:230 — rounds < 8 → < 12.
- src/app/api/agent/route.ts:483-489 — buildSuccessDetail에 batch_execute case(성공/실패 요약 + 실패 5건).
- src/app/api/agent/route.ts:752-755 — create_sales_order confirm에 택배 받는분/주소 라인.
- src/app/api/agent/route.ts:809-821 — buildConfirmDescription에 batch_execute case.

### AI Sync
- src/lib/ai/schema.ts:241-242 — BUSINESS_RULES [자주 쓰는 패턴]: create_sales_order 택배 갱신 + batch_execute 팬아웃 1줄.

## 중점 검토 요청
- **재진입 안전**: execBatchExecute 가드 순서(self → 非FANOUT) + batch_execute가 FANOUT_TOOLS에 없음(이중방어). item별 executeTool이 RBAC를 상속하는지(대상 도구 ctx 그대로 전달).
- **하위호환**: create_sales_order recipient_* 미지정 시 기존 방문판매 경로 무회귀(shipping/shipFromBranchId 모두 미설정).
- **택배 필수검증**: recipient 3필드 중 하나만 채워졌을 때 에러 반환 정확성.
- **결과 식별자 추출**: 성공샘플 식별자(주문번호/전표번호/수령인/고객) 키 매칭 — create_sales_order/create_customer/create_b2b_sales_order 각 반환 형태와 일치하는지.
- **confirm 1회**: batch_execute가 WRITE라 route confirm-gate 1회만, 승인 후 내부 item은 재확인 없음(L155-156 직접 executeTool).

## Out of Scope (logged in BUILD-LOG)
- 송장 자동발행·택배사 연동(PENDING 생성만).
- 전역 트랜잭션 롤백 미제공(건별 독립 commit = 설계).
- sanitizeToolArgs가 items 배열 내부로 재귀 안 함(다운스트림 Number() 처리로 무해, 추적 기록만).
