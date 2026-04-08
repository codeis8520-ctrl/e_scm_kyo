# AI 에이전트 도구 점검 리포트

점검 대상: `src/lib/ai/tools.ts` (2,164줄 / 41개 도구) · `src/app/api/agent/route.ts` (376줄)
점검 일자: 2026-04-08
점검 목적: 현재 도구들이 실제 직원이 불편함 없이 업무에 활용할 수준인지 평가

---

## 1. 도구 카테고리별 요약

| 영역 | 도구 수 | 주요 도구 |
|------|--------|---------|
| **조회(READ)** | 15 | get_inventory, get_low_stock, get_products, get_branches, get_customer, get_customer_grades, get_point_history, get_orders, get_sales_summary, get_suppliers, get_purchase_orders, get_production_orders, get_top_products, compare_sales, get_customer_consultations |
| **재고 관리** | 4 | adjust_inventory, bulk_adjust_inventory, transfer_inventory, replenish_low_stock |
| **고객 관리** | 6 | create_customer, update_customer, update_customer_grade, upgrade_customer_grades, adjust_points, add_customer_consultation |
| **발주/입고** | 4 | create_purchase_order, confirm_purchase_order, receive_purchase_order, create_and_confirm_purchase_order |
| **생산 관리** | 3 | create_production_order, start_production_order, complete_production_order |
| **마스터 관리** | 5 | create_branch, update_branch, create_product, update_product, bulk_update_product_costs |
| **커뮤니케이션** | 2 | send_sms, bulk_send_sms |
| **기타** | 1 | delete_record |
| **합계** | **약 41개** | |

---

## 2. 강점

### 2-1. 직관적 입력 파라미터 설계
- 대부분의 도구가 `branch_name`, `product_name`, `customer_name` 같은 **자연어 키워드** 기반이라 직원이 ID를 외울 필요 없음
- 예: `get_inventory(branch_name: "강남")` — "강남점 재고 얼마?"라는 질문이 자연스럽게 매핑

### 2-2. 워크플로우 명확성
- **발주**: create → confirm → receive (tools.ts:1503~1588)
- **생산**: create → start → complete (tools.ts:1592~1700)
- 상태 기반 순서 강제로 실수 방지

### 2-3. 사용자 친화적 응답 포맷
- JSON 응답이 한글 키로 자동 변환됨: 지점, 제품, 수량, 금액
- 금액은 `.toLocaleString()`으로 천단위 표시 (tools.ts:879~890)
- 직원이 추가 가공 없이 바로 보고에 사용 가능

### 2-4. 쓰기 작업 확인 단계 (Confirm)
- route.ts:124~132에서 위험 작업 전 사용자 승인 요구
- 대량 재고 조정, 발주, 생산 완료 같은 작업에서 실수 방지

### 2-5. 복합 업무 처리 능력
- `complete_production_order`: BOM 검증 → 원재료 차감 → 완제품 증가 일괄 (tools.ts:1639~1700)
- `receive_purchase_order`: 입고 전표 + 재고 증가 + 이동 기록 동시 처리

---

## 3. 개선 필요 사항 (심각도 순)

### 3-1. [치명] RBAC(권한) 검증 부재
**파일**: `src/lib/ai/tools.ts` 전체, `src/app/api/agent/route.ts` 컨텍스트 전달

**문제**:
- PHARMACY_STAFF / BRANCH_STAFF가 다른 지점 재고·고객을 조회/수정 가능
- `upgrade_customer_grades`, `bulk_adjust_inventory` 등 본사 전용 작업이 모든 역할에 개방
- route.ts에는 `context: { userId?, userRole?, branchId? }`가 정의되어 있으나 tools.ts 내부에서 **활용되지 않음**

**예시 취약점**:
```ts
// tools.ts:1210 — adjust_inventory
async function execAdjustInventory(sb: any, args: { branch_name: string; ... }) {
  const branch = await findBranch(sb, args.branch_name); // 지점 이름만으로 찾음
  // BRANCH_STAFF가 다른 지점 선택 가능 → 보안 위반
}
```

**해결**: 모든 쓰기 도구의 executor에 `context`를 전달하고, 쓰기 대상 branch_id가 context.branchId와 일치하는지 검증. 불일치 시 에러 반환.

### 3-2. [높음] 발주 생성 도구 2개의 모호성
**파일**: tools.ts:1454~1468

- `create_purchase_order`: DRAFT 상태 생성
- `create_and_confirm_purchase_order`: 즉시 CONFIRMED

LLM이 "발주해줘" 요청 시 어느 것을 선택할지 판단이 흔들림. schema.ts/도구 description에 선택 기준 명시 필요.

### 3-3. [높음] 오류 메시지의 사용자 친화성 부족
**파일**: tools.ts:1457, 1507, 1603 등

현재:
```ts
return JSON.stringify({ error: `공급업체 "${args.supplier_name}" 없음. get_suppliers로 목록 확인 후 정확한 이름 사용.` });
```

개선:
```json
{ "error": "공급업체를 찾을 수 없습니다.", "suggestions": ["한의약도매센터", "종로약재"] }
```

직원이 LLM과 반복 대화해야 하는 문제를 줄여야 함.

### 3-4. [중간] 재고 OUT 시 마이너스 방지는 있으나 "가능한 만큼만" 제안 없음
**파일**: tools.ts:1223~1224

재고 3개 상태에서 "5개 빼줘" 요청 시 단순 에러만 반환. "3개만 가능합니다, 진행할까요?" 같은 대안 제시가 없음. 에이전트의 본연의 가치 관점에서 아쉬운 지점.

### 3-5. [중간] 제품/지점 검색 시 다중 매칭 처리 부족
**파일**: tools.ts:703~710 `findBranch`

```ts
.ilike('name', `%${name}%`).limit(1).single();
```

"강남점"으로 검색했는데 "강남점A", "강남점B"가 있으면 `.single()`이 에러 → 도구 실패. 후보 목록 반환 + 재질의 패턴으로 개선 필요.

---

## 4. 미구현 갭 — 우선순위 TOP 5

| 순위 | 기능 | 업무 영향도 | 난이도 | 이유 |
|------|------|-----------|-------|------|
| **1** | **POS 환불/부분환불 도구** | 매우 높음 | 중간 | 조회는 있지만 환불 실행 도구가 전무. POS 자체에는 이미 `processRefund` 액션이 있으므로 에이전트에서도 즉시 호출 가능하도록 래핑 필요 |
| **2** | **매입 부분 입고** | 높음 | 중간 | `receive_purchase_order`는 전량 입고만. 실제로는 100개 중 50개만 받는 경우가 빈번 (DB에 `PARTIALLY_RECEIVED` 상태는 있음) |
| **3** | **배송 관리 도구 (조회/송장등록/상태동기화)** | 높음 | 중간 | 배송관리 메뉴는 있으나 에이전트에서 접근 불가. "오늘 미발송 건 알려줘", "송장번호 업데이트" 등 기본도 안 됨 |
| **4** | **카페24 매출 동기화 / 토큰 갱신 도구** | 중간 | 낮음 | 이미 server action(`refreshCafe24Token`, `syncCafe24PaidOrders`) 존재 → 에이전트에서 호출 가능하도록 래핑만 하면 됨 |
| **5** | **고객 세분화 분석 도구** | 중간 | 중간 | "VIP 고객별 매출 TOP 5", "최근 3개월 이탈 가능성 높은 고객" 등 크로스 분석. 본사 보고용으로 유용 |

**현재 커버리지 추정**: 일일 업무의 약 **60%**
- 가능: 조회(90%), 기본 발주/입고(80%), 재고 조정(85%), 고객 관리(85%)
- 불가능: 환불(0%), 배송(0%), 부분 입고(20%), 고급 분석(30%)

---

## 5. 구체적 치명 문제

### 5-1. SMS 미설정 시 "조용한 실패"
**파일**: tools.ts:1705~1741, 1782~1853

```ts
if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
  return JSON.stringify({
    결과: 'DB 기록 완료 (실제 발송 미설정)',  // ← 사용자는 '보냈다'고 인식
    안내: 'Solapi API 키가 설정되지 않아...',
  });
}
```

**문제**: 약국 점원이 "VIP 고객에게 문자 보내줘" 요청 → 응답은 "DB 기록 완료" → 고객은 못 받음 → 에이전트 신뢰도 붕괴.

**수정**: 미설정 시 명확한 에러로 리턴, 정상 성공과 구분.

### 5-2. BOM 없는 제품 생산 시 안내 부족
**파일**: tools.ts:1599~1603

```ts
if (!bom?.length) 
  return JSON.stringify({ error: `${product.name}의 BOM이 없습니다. 생산 메뉴에서 BOM을 먼저 등록하세요.` });
```

에이전트 문맥에서는 "생산 메뉴"에 접근할 수 없음. BOM 등록 도구가 없어서 여기서 플로우가 막힘.

### 5-3. 다중 지점 쓰기 작업에서 대상이 흐릿함
**파일**: tools.ts:1125~1208 `bulk_adjust_inventory`

"모든 지점 재고 정리해줘" 같은 요청이 들어오면 Confirm 단계에서 "대상 15개 지점 × 40개 제품"이라고만 표시되고 실제 지점/제품 리스트는 안 보임. Confirm 메시지에 상세 대상 목록 포함 필요.

---

## 6. 총평

### 학점: **C+ (실무 도입 주의 단계)**

### 평가 근거

**긍정**:
- 41개 도구로 기본 업무 프로세스 자동화 가능
- 한글 UX, 자연어 입력, 확인 단계 구현으로 사용자 실수 방지 수준 양호
- 발주 → 입고, 생산 워크플로우 완성도 높음

**부정**:
- **RBAC 부재**: 약국 점원이 전사 데이터를 수정 가능 → 보안·규정 위반 소지 (해결 시 학점 → B)
- **필수 기능 미지원**: 환불 처리, 부분 입고, 배송 관리 → 일일 업무 막힘
- **조용한 실패**: SMS 미설정 케이스 → 신뢰도 저하
- **검색 정확도**: 제품/지점 다중 매칭 시 모호성

### 실무 사용 시나리오

**잘 동작**:
```
"경옥고 강남점 재고 얼마?" → ✅ 정확 반환
"경옥고 50개 입고해줘" → ✅ 확인 후 처리
"지난주 vs 이번주 매출 비교" → ✅ 정확한 차이/%
```

**막힘**:
```
"VIP 20명에게 신제품 문자 보내줘" → ⚠️ 미설정 시 조용한 실패
"어제 100만원 주문 환불해줘" → ❌ 도구 없음
"경주점 재고만 정리해줘" → ⚠️ 다른 지점도 수정 가능 (권한 미체크)
```

---

## 7. 우선 개선 로드맵

### 즉시 (1주 내)
1. **executeTool에 context 주입** → BRANCH_STAFF/PHARMACY_STAFF 지점 검증 로직
2. **SMS 조용한 실패 수정** → API 미설정 시 에러 타입으로 리턴
3. **Confirm 메시지 상세화** → bulk 작업의 실제 대상 목록 노출

### 1개월 내
4. **POS 환불 도구** — `refund_sales_order(order_number, items?, reason)`
5. **부분 입고 도구** — `receive_purchase_order_partial(po_id, items[{quantity}])`
6. **배송 관리 도구 세트** — `get_shipments`, `update_shipment_tracking`, `sync_shipment_status`
7. **제품/지점 다중 매칭 처리** — 후보 목록 반환 + 에이전트 재질의 패턴
8. **카페24 동기화 도구** — 기존 server action 래핑

### 현재 상태 권고
- **본사 내부 테스트/데모 용도**: ✅ 가능
- **현장 직원 일일 사용**: ⚠️ 권한 문제 해결 후 가능
- **자율 운영(cron)**: ❌ 아직 위험

---

*작성일: 2026-04-08*
*관련 전략 문서: `doc/AI_AGENT_STRATEGY.md`*
