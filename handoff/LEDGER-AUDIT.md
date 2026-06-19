# LEDGER-AUDIT — 판매전표(sales_orders) 중심 1:1 연동 전수 감사 (#48)

> 작성 2026-06-19 · Arch. **코드 미수정 / 감사·갭·계획만.**
> 단일원장 전제(스펙 §0): `sales_orders` + `sales_order_items` = 진실원장. DB 재구축 불필요. 문제는 **연동 누락·역방향 부재·NULL 링크**.

---

## (A) 7요청 현황표

| # | 요청 | 현황 | 근거 (file:line) | 갭 | 제안 수정 | 위험도 |
|---|---|---|---|---|---|---|
| 1 | 전표 1 ↔ 택배 1 명확 연결 | ⚠️ 부분 | `012_shipments.sql:7` (`sales_order_id UUID REFERENCES sales_orders(id)`, ON DELETE 없음) · `092_shipments_cafe24_unique.sql` (cafe24_order_id 부분 UNIQUE) · `staged_posting` 메모(과거 카페24 배송 86건 sales_order_id=NULL) | **STORE 전표는 1:1이나 보장 제약 없음**(sales_order_id 비-UNIQUE → 1전표 다중 shipment 가능). **카페24 과거건은 sales_order_id=NULL**, cafe24_order_id로만 간접연결 → JOIN 단절 | (a) STORE: 전진형은 createShipment가 1전표 1배송 보장하나 **부분 UNIQUE(sales_order_id WHERE source='STORE') 신설**로 DB 강제. (b) 카페24: 092 confirm forward는 연결됨. **과거 NULL건 backfill**(cafe24_order_id→sales_orders.cafe24_order_id 매칭 UPDATE) | 중 |
| 2 | 전표 삭제/취소 → 택배 함께 삭제/취소 | ❌ 없음 | `sales-cancel-actions.ts` 전체 (shipment 참조 0건) · `credit-actions.ts:134` · `webhook.ts:774`(cancel=status만) · `012:7`(ON DELETE 미지정=RESTRICT) | **취소 시 연결 shipment 무처리** → 배송목록에 취소건 배송 잔존(유령 출고). 물리삭제 경로 시도 시 FK RESTRICT로 차단됨(삭제 자체가 막힘) | cancelSalesOrder/cancelCreditOrder 끝에 **연결 shipment void**: PENDING이면 삭제, 발송됨(PRINTED+)이면 취소금지 또는 경고. (전표는 물리삭제 안 함=status변경이 정책이므로 FK ON DELETE보다 **앱레벨 void**가 정답) | 높음 |
| 3 | 전표 취소 → 매출제외 + 재고원복 | ⚠️ 부분 | `sales-cancel-actions.ts:71-187`(재고복원 SALE_CANCEL·포인트환원·역분개 ✅) · `081/084_branch_sales_summary.sql:66/57`(status NOT IN CANCELLED/REFUNDED ✅) · `online-inventory.ts:18,34`(취소복원 Known Gap) · `webhook.ts:774,810`(cafe24 cancel/refund=status만, **재고복원·역분개 없음**) | **STORE 취소는 완전**(재고·매출·포인트·분개 모두). **카페24 취소/환불(webhook)은 status만 변경** → ONLINE_SALE 차감재고 미복원 + 매출분개 미역분개 | webhook handleOrderCancelled/Refunded에 **ONLINE_SALE 재고 IN 복원** + **createSaleJournal 역분개**(STORE 패턴 재사용). 단 cafe24 차감은 2026-06-17 컷오프 이후만 존재 → 영향 한정 | 높음 |
| 4 | 송장입력/발송 → 판매현황 즉시 반영 | ✅ 완료(설계의도대로) | `receipt-sync.ts:20`(DELIVERED만 RECEIVED, SHIPPED 수령불변=#43) · `shipping-actions.ts:190`(updateShipment→sync) · `SalesListTab.tsx:103,593`(📦 아이콘·tracking 표시) | (의도) SHIPPED는 수령상태 불변 — 발송사실은 shipment.status + 📦로만. **단 #1 NULL링크 탓에 카페24 발송이 SalesListTab shipments JOIN(L366, sales_order_id 기준)에 안 잡혀 아이콘/송장 누락 가능** | #43 라벨/아이콘은 channel='ONLINE' 폴백으로 보강됨(메모). **잔여는 #1 backfill로 해소** | 중 |
| 5 | 판매현황 수령변경 → 택배 반영(역방향) | ⚠️ 부분 | `shipping-actions.ts:247 bulkUpdateReceiptStatus`(연결 shipment DELIVERED 갱신 ✅, L279-285) · `updateSalesOrderItem`(역방향 shipment 갱신 미확인) · 드로어 수령처리 | **bulkUpdateReceiptStatus는 역방향 있음**(전표 RECEIVED→shipment DELIVERED). 단 **단건 품목수정·드로어 개별 수령처리의 역방향은 미보장**. 또 cafe24 NULL링크는 maybeSingle 조회 실패로 역방향 누락 | 단건 수령처리도 동일 역방향 헬퍼 적용. **단일 `syncShipmentFromReceipt` 헬퍼 신설**(역방향 정식화). cafe24는 cafe24_order_id 폴백 | 중 |
| 6 | 수령·송장·출고처·품목·금액·고객 1전표 공유 | ⚠️ 부분 | 스펙 §1 매핑표 · `shipping-actions.ts:35`(출고처=shipments.branch_id, 매출처=sales_orders.branch_id 주석분리) · `SalesListTab.tsx:366`(shipments JOIN) | 단일원천 매핑은 스펙상 확립. **불일치 지점**: recipient_*가 shipments·sales_orders 양쪽 스냅샷(드리프트 여지) · 출고처 파생(#35 채택, 명시컬럼 미신설) · cafe24 NULL링크로 일부 화면 조인단절 | recipient 단일원천 규칙 명문화(shipments 우선, 없으면 sales_orders). #1 해소 시 조인 일관. 출고처는 현행 파생 유지(스펙 §6-1 확정) | 낮음 |
| 7 | 전표=원장 원칙(표시용 아님) | ⚠️ 부분 | 스펙 §0·§1 · 위 #1·#2·#3·#5 갭 | **위배 사례**: (i) 카페24 과거배송 NULL링크=원장 단절, (ii) 취소 시 shipment 유령잔존=배송원장 불일치, (iii) cafe24 취소/환불 재고·분개 미반영=재무원장 불일치 | Phase 1·2로 (i)(ii)(iii) 순차 봉합 | 높음 |

---

## (B) 핵심 갭 우선순위

| 순위 | 갭 | 영향 | 되돌릴수없음 |
|---|---|---|---|
| **P0-1** | **#2 전표 취소 → 연결 shipment 무처리** | 취소건이 택배관리에 유령 출고로 잔존, 실제 발송 위험 | 앱레벨 void(데이터 안전). 발송완료건 취소가드 필요 |
| **P0-2** | **#3 카페24 취소/환불 webhook 재고·역분개 누락** | ONLINE_SALE 차감재고 미복원·매출분개 잔존 → 재고/손익 왜곡 | 역분개=추가분개(원장보존). 멱등 가드 필수 |
| **P1-1** | **#1 카페24 과거 shipment.sales_order_id=NULL** | 판매현황 JOIN 단절(송장·아이콘·역방향 모두 영향) | backfill UPDATE는 cafe24_order_id 정확매칭만(staged_posting 교훈: 조인키 오인 시 대량오염) |
| **P1-2** | **#5 단건 수령처리 역방향 미보장** | 전표 수령완료해도 shipment PENDING 잔존(부분) | 헬퍼화로 안전 |

---

## (C) 단계별 실행계획

### Phase 1 — 취소·환불 연동 봉합 (재무·재고 정합 최우선)
- **코드**:
  - `sales-cancel-actions.ts` / `credit-actions.ts`: 취소 끝단에 연결 shipment void(PENDING→삭제, PRINTED+→취소금지 또는 경고+상태표시). sales_order_id 우선, cafe24_order_id 폴백.
  - `cafe24/webhook.ts` handleOrderCancelled(L772)/handleOrderRefunded(L810): ONLINE_SALE 재고 IN 복원 + createSaleJournal 역분개(STORE 패턴 차용). 멱등 가드(이미 복원/역분개 시 skip).
- **DB 마이그**: 없음(앱레벨). 단 inventory_movements.reference_type에 ONLINE_SALE_CANCEL 추가 시 schema.ts 동기화.
- **AI 동기화**: `schema.ts` BUSINESS_RULES에 "카페24 취소/환불도 재고·분개 복원" 한 줄 + reference_type 신값. (현 schema.ts:66은 STORE만 명시)
- Richard 리뷰 **필수**(재무·재고 변경).

### Phase 2 — 1:1 링크 강제 + 과거 backfill
- **DB 마이그(094)**: (a) STORE shipments `sales_order_id` 부분 UNIQUE(WHERE source='STORE' AND sales_order_id NOT NULL). (b) 과거 카페24 shipment.sales_order_id backfill UPDATE = cafe24_order_id로 sales_orders 정확매칭(staged_posting 조인키 교훈 적용, 1건씩 검증). (c) 중복 STORE shipment 사전 정리(있으면).
- **코드**: createShipment STORE 경로에 1전표중복 가드(092의 cafe24 패턴 대칭).
- **AI 동기화**: 불요(스키마 의미 불변).
- Arch가 마이그 직접 실행 + 실데이터 조인키·대상수 재검증.

### Phase 3 — 역방향 정식화 + 원장 드리프트 제거
- **코드**: `syncShipmentFromReceipt(supabase, salesOrderId, receiptStatus)` 신설(역방향 공용헬퍼). 단건 품목수정·드로어 수령처리·bulkUpdateReceiptStatus 모두 경유. recipient 단일원천 규칙 명문화.
- **DB 마이그**: 없음.
- **AI 동기화**: BUSINESS_RULES 역방향 규칙 한 줄.
- Richard 리뷰 권장(상태연동 변경).

---

## (D) 위험 · 되돌릴 수 없는 작업
- **카페24 backfill UPDATE(Phase 2b)**: staged_posting 치명버그 교훈 — 조인키를 sales_order_id로 오인하면 대량 오염. **반드시 cafe24_order_id 기준 + 매칭수 사전검증 + Arch 직접 실행**. 1전표 다중 cafe24_order_id 충돌 시 092 부분UNIQUE와 경합 가능 → 사전 중복정리.
- **취소 시 발송완료(PRINTED/SHIPPED/DELIVERED) shipment**: 물리삭제 금지. 취소가드(이미 발송=취소불가, 환불유도) 정책 사인오프 필요.
- **카페24 역분개(Phase 1)**: 멱등 깨지면 이중 역분개로 매출 음수. reference 멱등키 필수. accounting_period_closes 마감가드 확인.
- 전표 자체는 물리삭제 정책 아님(status변경) → FK ON DELETE 변경은 불요·위험(앱레벨 void가 정답).

## (E) 사인오프 필요 결정사항
1. **취소 시 발송완료 shipment 처리 정책**: (A) 발송완료건은 취소금지·환불유도 / (B) 취소허용+shipment 경고표시 잔존. → 권장 (A).
2. **카페24 취소/환불 재고복원 소급범위**: ONLINE_DEDUCT_CUTOFF(2026-06-17) 이후 차감분만 복원 대상 확인 — 그 이전 취소는 차감자체 없어 무대상. 소급 backfill 필요여부.
3. **STORE 1전표=1배송 강제**: 분할배송(1전표 다배송) 업무상 발생 가능성? 없으면 부분UNIQUE, 있으면 강제 보류.
4. **과거 카페24 NULL링크 backfill 범위**: 전체 소급 vs forward만(092 confirm 이후). 권장 전체 소급(원장 일관).
