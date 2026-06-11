# Build Log

*공유 기록. Arch가 소유.*

---

## ACTIVE SPRINT — 수령 전 전표 품목 추가/삭제 + 방문↔택배 전환 (2026-06-11)

전체 3스텝. ARCHITECT-BRIEF.md는 **현재 스텝만** 담는다.
- Step 1 (브리핑 완료): 품목 추가/삭제 서버액션 + 공용 재계산 헬퍼 + 드로어 UI. shipments 미접촉.
- Step 2 (대기): 품목 delivery_type 전환 + order receipt_status 재집계.
- Step 3 (대기): 방문↔택배 양방향 = shipment 생성/void + 수령자·주소 입력.

### Step 1 — 잠긴 결정 (Locked)
- 수정 허용 조건: `status==='COMPLETED' && receipt_status NOT IN (RECEIVED, null)`. receipt_status 없음=수정불가(레거시 안전).
- 재계산 범위: total_amount(할인전 총액)·과세/면세/VAT 스냅샷·적립포인트(차액 adjust)·재고(OUT/IN, phantom 분해 포함).
- 결제 차액: sales_order_payments 1행(+추가결제/−부분환불). **PG/카드 단말기 연동 없음** — DB기록+수기안내만.
- 매출 분개: 역분개+재분개가 아니라 **차액분만 추가 분개**(sourceType 'SALE_REVISE', 미지원 시 'SALE' 폴백, 부호로 흡수). 분개 실패는 경고만.
- 재고 지점: shipment.branch_id 있으면 그 값, 없으면 order.branch_id.
- 삭제 가드: 수령된 품목 삭제 거부, 마지막 1품목 삭제 거부(→판매취소 유도).
- 신규 reference_type: SALE_REVISE_ADD / SALE_REVISE_REMOVE. 신규 journal sourceType: SALE_REVISE. → ai/schema.ts BUSINESS_RULES 동기화 필수(CLAUDE.md 절대규칙).

### Step 1 — 리뷰 Round 1 Must Fix 대응 (Arch 결정, 2026-06-11)
- **결제 차액 표현 = Option B(제약 완화, 음수=환불).** 근거: `SalesListTab.tsx:1513-1514`가 `totalPaid=Σ amount`로 외상 잔액(`total - discount - Σ`)을 계산하는 유일한 합산 소비자다. abs 저장은 환불 시 totalPaid를 부풀려 잔액을 왜곡 → 음수 부호 보존이 정답. abs 옵션 기각.
- **마이그 078 작성(Arch 소유)**: `supabase/migrations/078_sales_payments_allow_refund.sql` — (1) `amount>=0` CHECK 제거(음수 허용), (2) child `payment_method` CHECK에 'mixed' 추가(045 누락분 — mixed 원주문 대표결제수단 insert 통과). Arch가 Supabase 적용 책임.
- **Bob 코드 수정 지시(브리프 amendment 작성됨)**: recordPaymentDelta는 amount 부호 보존(abs 금지) + insert 실패를 호출자로 전파(조용한 `console.error` 삼킴 제거 — Must Fix 본질). isMissingColumnError(42703) 폴백만 유지.
- Open Question 2(mixed/null→cash 분개 귀속): 분개 수금계정은 현금 단순화 유지, 이번 범위 밖 — 아래 Known Gaps + Project Owner 회계정책 확인 대상.

### Step 1 — Known Gaps (범위 밖, 추후)
- 주문 할인(discount_amount) 재배분 없음 — 기존값 유지.
- 동시 편집 락 없음(단일 사용자 가정).
- 실제 카드 취소/추가승인 자동화 없음.
- 에이전트 tools.ts 신규 도구 미추가(화면 전용 액션).
- shipments·delivery_type 전환은 Step 2/3.

### Step 1 — 빌드 완료 (Bob, 2026-06-11)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, `npm run build` ✅ Compiled successfully, error/warning 0)

**변경 파일 (3개, DB/마이그 변경 없음 — 기존 테이블만 사용)**:
- 신규 `src/lib/sales-revise-actions.ts` — `addSalesOrderItem`/`removeSalesOrderItem` 2개 서버액션 + 공용 헬퍼(loadEditableOrder 가드, resolveStockBranchId, loadProductMeta·loadPhantomBom 폴백, adjustStock/applyStockForItem 재고증감+phantom분해, recalcSalesOrderTotals 핵심 재계산, recordPaymentDelta, recordJournalDelta). processPosCheckout/cancelSalesOrder의 컬럼-누락 방어(42703→optional 제거 재시도) 패턴 동일 적용.
- `src/app/(dashboard)/pos/SalesListTab.tsx` — import 2개; useEffect loadDetail을 useCallback(showSpinner)로 추출(추가/삭제 후 재조회용); editable/deletableCount 계산; 품목 행에 '🗑 삭제' 버튼(미수령행만, 마지막1행 비활성); 품목 테이블 하단 '+ 품목 추가' 인라인 폼(활성제품 셀렉트+수량/단가/배송/옵션); 차액 alert 안내. 기존 markReceiptCompleted/revert/changeDeliveryType/markItemReceived 미접촉.
- `src/lib/ai/schema.ts` — BUSINESS_RULES sales_orders 섹션에 "전표 수정(수령 전 품목 추가/삭제)" 1줄 + 신규 reference_type(SALE_REVISE_ADD/REMOVE)·sourceType(SALE_REVISE)·point_history adjust 사유 명시. DB_SCHEMA 컬럼 변경 없음.

**주요 결정**:
- 매출 분개: `createSaleJournal` sourceType는 free-text column(source_type)에 그대로 기록되고 분기 의존 없음을 grep 확인 → 'SALE_REVISE' 직접 사용(폴백 불필요). 차액분만 추가 분개, delta=0 skip, try/catch 경고만.
- 재고 지점: shipments.branch_id가 order.branch_id와 다르면 우선, 없으면 order.branch_id(processPosCheckout stockBranchId 의미 일치).
- 결제 차액: 대표결제수단(mixed/null→cash 폴백)으로 sales_order_payments 1행. delta=0이면 결제·분개 모두 skip(Acceptance #5).
- 적립포인트: order.point_rate_applied(없으면 1.0) 기준 newEarned 재산정 후 (newEarned − 기존 points_earned) 차액만 point_history adjust.
- removeSalesOrderItem: 제품 메타 조회 실패해도 track=true 기본값으로 복원 진행(재고 누락 방지).

**Known Gaps (이번 스코프 밖)**: 위 [Step 1 — Known Gaps] 동일 — discount_amount 재배분 없음, 동시편집 락 없음, 실제 카드취소 자동화 없음, 에이전트 tools.ts 도구 없음, shipments/delivery_type 전환은 Step 2/3.
- (Open Question 2, Richard·Arch 확인) 분할결제('mixed') 전표 차액의 **분개 수금계정**은 현금(1110) 단순화 유지 — `representativePaymentMethod`는 분개용으로 mixed→cash. 회계정책 판단은 범위 밖. 단 `sales_order_payments.payment_method`는 'mixed' 보존(078).

### Step 1 — AMENDMENT 빌드 완료 (Bob, 2026-06-11) — Must Fix 1건 대응

**상태**: 🔵 재리뷰 대기 (REVIEW-REQUEST 갱신, `npm run build` ✅ Compiled successfully)

Arch 결정 Option B(부호 보존). 마이그 078(`amount≥0` 제약 제거 + child CHECK 'mixed' 추가)은 Arch 소유 — Bob 미접촉.

**변경 파일 (2개)**:
- `src/lib/sales-revise-actions.ts` — `recordPaymentDelta`: ① amount 부호 보존(음수=부분환불, abs 미사용) ② 조용한 실패 제거 → insert 실패 시 `{ error }` 전파(42703 폴백만 유지, 23514 등은 삼키지 않음) ③ `paymentRecordMethod` 신규(child CHECK 허용목록 검증, 'mixed' 보존·null/목록밖만 'cash'). 두 호출부(addSalesOrderItem/removeSalesOrderItem)에서 `payRes.error` 시 즉시 `{ error }` 반환 → 재고·분개 조정 후 결제장부 누락 정합성 깨짐 차단.
- `src/lib/ai/schema.ts` — sales_order_payments 주석에 amount 음수=환불·Σ=순수금액·payment_method enum('mixed' 포함) 1줄 추가.

---

## Completed Steps

### 대시보드 헤더/탭 통일 — 배치 B (PageTabs 채택 6페이지)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, npm run build ✅ error/warning 0, 2026-06-03)

**Goal**: 배치 A 신설 PageTabs를 나머지 6페이지에 채택. 순수 프레젠테이션 — 동작 회귀 0.

**변경 파일 (6개, 서버액션/DB/schema.ts 변경 없음)**:
- `customers/page.tsx` — import + list/campaign 탭 → PageTabs. onChange=setActiveTab만. URL ?tab= 동기화·listQs 미접촉.
- `accounting/page.tsx` — import + 기존 TABS(6탭) 그대로 PageTabs. overflow 래퍼 제거(nav가 내장).
- `trade/page.tsx` — import + credit/b2b_sales/b2b_partners 3탭 → PageTabs. actions 없음.
- `notifications/page.tsx` — import + kakao/sms/templates 3탭 → PageTabs(onChange=handleTabChange 유지). 우측 배치버튼(생일/휴면/발송, activeTab!=='templates') → actions 슬롯(삼항 보존).
- `reports/page.tsx` — import + REPORT_TABS 그대로 PageTabs. 우측 기간/날짜/채널/지점·조회·CSV·PDF → actions 슬롯.
- `pos/page.tsx` — import + **최상단** checkout/list(MainTab) 탭만 PageTabs. 우측 임시저장/불러오기(mainTab==='checkout') → actions 슬롯. **내부 서브탭 미접촉**.

**탭 key ↔ 패널 분기 (실제 코드 복사, 1:1 일치)**:
- customers list/campaign · accounting pl/journal/ledger/vat/gl_balance/manual · trade credit/b2b_sales/b2b_partners · notifications kakao/sms/templates · reports sales/purchase/pl/trend/margin · pos checkout/list.

**주요 결정**:
- accounting/reports는 기존 TABS/REPORT_TABS 배열을 직접 전달(키 string 유니온 → PageTab[] 구조 호환).
- 조건부 우측 액션(notifications/pos)은 삼항(false→undefined)로 슬롯 조건부 렌더 보존.
- 시각 통일(의도): accounting/reports active 색 blue-500→blue-600, 패딩 표준화. 동작 무관.

**Known Gaps**: 없음. (pos 내부 서브탭·customers URL 동기화 로직·서브/상세·schema.ts 스코프 외 미접촉.)

---

### 대시보드 헤더/탭 통일 — 배치 A

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, npm run build ✅ Compiled successfully in 5.7s, 2026-06-03)

**Goal**: 공용 PageTabs(프레젠테이션 전용) 신설 + 5페이지 헤더 표준화. 순수 시각/구조만 — 동작 회귀 0.

**변경 파일 (6개, 서버액션/DB/schema.ts 변경 없음)**:
- `src/components/PageTabs.tsx` (신설) — tabs/activeKey/onChange/actions. role=tablist/tab, aria-selected. 브리프 구조·스타일·a11y 그대로.
- `src/app/(dashboard)/production/page.tsx` — import 추가, h1+부제+우측액션+인라인탭(L316~358) → PageTabs로 교체. 우측 액션 3개(지점 select/BOM 조립/+생산 지시)를 actions 슬롯으로 이동. onChange={k=>setTab(k as 'orders'|'bom'|'factories')} — 기존 state/타입 그대로.
- `src/app/(dashboard)/shipping/page.tsx` — import 추가, h1+부제+탭(L910~929) → PageTabs. onChange={k=>setActiveTab(k as TabType)}. actions 없음.
- `src/app/(dashboard)/system-codes/page.tsx` — import 추가, h1+9버튼 탭(L379~474) → PageTabs(9탭). onChange={k=>setActiveTab(k as typeof activeTab)} — 긴 유니온 직접 캐스팅 대신 typeof 사용(동일 타입, 동작 변화 없음).
- `src/app/(dashboard)/agent-memory/page.tsx` — h1(L89) className → sr-only. 부제·버튼 유지.
- `src/app/(dashboard)/agent-conversations/page.tsx` — h1(L261) className → sr-only. 부제 유지.

**브리프 라인 vs 실제 코드 대조 (전부 일치)**:
- production: tab state `'orders'|'bom'|'factories'`(L159), 헤더 L316~343/탭 L345~358 — 일치.
- shipping: `type TabType='cafe24'|'manual'|'list'`(L72), activeTab(L117), 헤더 L910~913/탭 L915~929 — 일치. 기존 active색 blue-500→통일 표준 blue-600.
- system-codes: activeTab 9-유니온(L162), 헤더 L379~381/탭 L383~474 — 일치. 기존 active색 blue-500→blue-600 통일, px-3→px-4(표준).
- agent-memory h1 L89 / agent-conversations h1 L261 — 일치.

**주요 결정**:
- system-codes onChange 캐스팅은 9개 유니온을 다시 적는 대신 `as typeof activeTab` 사용 — 동일 타입, 유지보수 안전. (브리프 "as ..." 허용 범위 내)
- 패널 렌더 분기(`tab===`/`activeTab===`) 전부 미접촉. URL 동기화·state·set함수 전부 그대로.

**Known Gaps**: 없음. (배치 B 6페이지·URL 동기화 일반화·pos 서브탭은 스코프 외 — 미접촉 확인.)

---

### Batch 2b — AI 에이전트 배송 + B2B 도구 4종

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, npm run build ✅ Compiled successfully, 2026-06-03)

**Goal**: 에이전트가 (1) 배송 레코드 생성(create_shipment, DANGEROUS), (2) B2B 납품 등록(create_b2b_sales_order, DANGEROUS), (3) B2B 수금(settle_b2b_order, WRITE), (4) B2B 납품 취소(cancel_b2b_order, DANGEROUS). send_kakao 제외. DB 변경/신규 서버액션 없음 — 전부 기존 액션 래핑.

**변경 파일 (3개, DB 변경 없음)**:
- `src/lib/ai/tools.ts`
  - AGENT_TOOLS: 4개 도구 정의(analyze_data 정의 앞). create_shipment는 sender_*/source 비노출.
  - WRITE_TOOLS +4, DANGEROUS_TOOLS +3(create_shipment / create_b2b_sales_order / cancel_b2b_order — settle 제외).
  - executeTool switch +4 case.
  - exec 핸들러 4종(파일 끝, execSetSafetyStock 직후): execCreateShipment / execCreateB2bSalesOrder / execSettleB2bOrder / execCancelB2bOrder.
- `src/app/api/agent/route.ts` — buildConfirmDescription +4 case(send_campaign 직후, default 앞). DANGEROUS 2차경고는 L292 기존 분기 자동(구조 미변경).
- `src/lib/ai/schema.ts` — [자주 쓰는 패턴] +5줄(배송 1 + B2B 4), B2B 룰 +6줄(상태흐름/납품/수금/취소), 배송 룰 +1줄. DB_SCHEMA 변경 없음.

**확인된 시그니처 (실제 파일 재확인 완료, 브리프와 일치)**:
- createShipment(data: ShipmentInput)→{success}|{success:false,error} (shipping-actions.ts:49). 단순 insert.
- createB2bSalesOrder({partnerId,branchId?,items:[{productId,quantity,unitPrice}],memo?,deliveredAt?})→{error}|{success,orderNumber} (b2b-actions.ts:150).
- settleB2bOrder(orderId,amount,method?)→{error}|{success,newStatus} (b2b-actions.ts:311). orderId=UUID.
- cancelB2bOrder(orderId,reason?)→{error}|{success} (b2b-actions.ts:376). UUID, settled_amount>0 거부.
- findProduct/resolveBranchForWrite/isStaffRole 재사용. findPartner 없음 → execCreateB2bSalesOrder 인라인(b2b_partners name ilike / code eq).

**구현 결정**:
- 액션 import는 핸들러 내부 동적 import() — 파일 전반 기존 컨벤션(execCreateCampaign·execSettleCreditOrder 등과 동일). 정적 top import 미사용.
- settle/cancel은 order_number→UUID 선조회 후 UUID 전달(액션에 order_number 직접 전달 안 함). 핸들러에서 SETTLED/CANCELLED·settled>0 친절 차단(액션도 동일 방어 — 이중 방어).
- create_shipment sender: 출고지점 name/phone 자동(지점 phone 없으면 '') / source='STORE' 고정 / created_by=ctx.userId.
- B2B 단가: unit_price 미지정 시 products.price(거래처 단가표 미연동, 스코프 밖).
- staff RBAC: resolveBranchForWrite로 본인 지점 강제(create_shipment·create_b2b_sales_order). settle/cancel은 전표 단위라 지점 강제 미적용(액션의 requireSession 의존).

**Known Gaps (스코프 밖, 브리프 명시)**:
- send_kakao: 제외(Solapi templateId/variableKeys를 LLM이 안전히 못 채움. 대량은 send_campaign 정식경로).
- B2B 거래처 단가표(getPartnerPrices) 연동, shipment 송장/SHIPPED 전환, deliveredAt 지정 — 전부 미접촉.

### Batch 2a — AI 에이전트 판매등록 + 캠페인 도구 4종

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, npm run build ✅, 2026-06-03)

**Goal**: 에이전트가 (1) 단순 POS 판매 등록(create_sales_order, DANGEROUS), (2) 알림톡 캠페인 생성·활성화·발송(create/activate/send_campaign). send_campaign은 대상수 사전집계.

**변경 파일 (4개, DB 변경 없음)**:
- `src/lib/actions.ts` — 신규 `createSimpleSalesOrder`(processPosCheckout 직후). CheckoutPayload 조립 후 기존 processPosCheckout 위임만. 기존 함수·POS 호출부 diff 0.
- `src/lib/ai/tools.ts`
  - AGENT_TOOLS: 4개 도구 정의(analyze_data 정의 앞).
  - WRITE_TOOLS +4, DANGEROUS_TOOLS +2(create_sales_order, send_campaign).
  - executeTool switch +4 case.
  - exec 핸들러 4종 + 헬퍼 resolveCampaign 1개(execCancelCreditOrder 직후): execCreateSalesOrder / execCreateCampaign / execActivateCampaign / execSendCampaign.
- `src/app/api/agent/route.ts` — buildConfirmDescription +4 case(sync_cafe24_paid_orders 직후, default 앞).
- `src/lib/ai/schema.ts` — [자주 쓰는 패턴] +4줄, 판매(POS)·캠페인 룰 2섹션(Phantom BOM 앞). DB_SCHEMA 변경 없음.

**확인된 시그니처 (실제 파일 재확인 완료, 브리프와 일치)**:
- processPosCheckout(payload: CheckoutPayload)→{orderNumber,pointsEarned,stockUpdates}|{error} (actions.ts:1956). CartItem(1892).
- createCampaign(params)→{success,data:Campaign}|{error} DRAFT, requireHQ (campaign-actions.ts:80). Campaign.id/name/target_grade 존재(campaign-types.ts:59,60,74).
- activateCampaign(id)→{success}|{error} DRAFT→ACTIVE (200). sendCampaign(id)→{success,successCount,failCount}|{error} requireHQ (259).
- sendCampaignCore 대상조건: customers is_active=true, phone NOT LIKE 'cafe24_%', target_grade≠ALL→grade eq, target_branch_id→branch_id eq (campaign-send-core.ts:45-56) — exec 사전집계가 동일 조건 복제.
- findBranch/findProduct/findCustomer/getPoints(tools.ts:1035-1057), requireHq/resolveBranchForWrite/assertBranchAccess(1078-1125) 재사용.

**주요 결정**:
- branch.code/channel: resolveBranchForWrite 시그니처 미변경, execCreateSalesOrder에서 `branches.select('code, channel')` 1회 보강 조회.
- 캠페인 식별자(campaign_id|name) 해결을 resolveCampaign 헬퍼로 추출(activate=DRAFT, send=ACTIVE 상태 필터).
- send_campaign 대상수: getPoints식 단건이 아닌 `count:'exact', head:true`로 집계(실데이터 전송 없음).

**Known Gaps**: 없음.

---

### Batch 1 — AI 에이전트 mutating 도구 5종 + DANGEROUS_TOOLS 인프라

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, npm run build ✅, 2026-06-03)

**Goal**: 에이전트가 외상 수금/취소·발주취소·생산취소·안전재고 설정을 수행. cancel_credit_order는 DANGEROUS_TOOLS로 2차 경고.

**변경 파일 (3개, DB 변경 없음)**:
- `src/lib/ai/tools.ts`
  - AGENT_TOOLS: 5개 도구 정의 추가(cancel_sales_order 정의 직후).
  - WRITE_TOOLS Set: 5개 등록.
  - `export const DANGEROUS_TOOLS = new Set(['cancel_credit_order'])` 신설(WRITE_TOOLS 직후).
  - executeTool switch: 5개 case.
  - exec 핸들러 5종(파일 말미): execSettleCreditOrder / execCancelCreditOrder / execCancelPurchaseOrder / execCancelProductionOrder / execSetSafetyStock.
- `src/app/api/agent/route.ts`
  - import에 DANGEROUS_TOOLS 추가.
  - confirm 분기: `description`을 const→let, DANGEROUS면 경고 라인 append(구조·executeTool 호출부 미변경).
  - buildConfirmDescription: 5개 case(delete_record 직후, Phase B 앞).
- `src/lib/ai/schema.ts`
  - BUSINESS_RULES [자주 쓰는 패턴]에 5개 매핑 추가. DB_SCHEMA 변경 없음(새 테이블/enum 없음).

**확인된 시그니처 (실제 파일 재확인 완료, 브리프와 일치)**:
- settleCreditOrder({orderId, settledMethod})→{success,error} (accounting-actions.ts:721)
- cancelCreditOrder({orderId, reason?, userId?})→{error}|성공 (credit-actions.ts:19, 내부 requireSession)
- cancelPurchaseOrder(id) bare→{error}|{success} DRAFT/CONFIRMED (purchase-actions.ts:297)
- cancelProductionOrder(id) bare→{error}|{success} PENDING/IN_PROGRESS (production-actions.ts:599)
- updateSafetyStock(inventoryId, val) / bulkUpdateSafetyStock(productId, val) (inventory-actions.ts:7/28)

**주요 결정**:
- set_safety_stock: branch_name 지정 OR staff면 단건(inventories 행 id 조회 후 updateSafetyStock). HQ+미지정이면 bulkUpdateSafetyStock + count 별도 조회로 영향행수 표기.
- 핸들러 선조회로 친절 에러(상태/식별자) 후 액션 호출 — 액션 자체 가드와 이중 방어.
- cancel_production_order는 requireHq 가드(브리프 #4).

**Known Gaps**: 없음 (스코프 내 모두 구현).

---

### Step — 고객 검색 개선 (Enter 검색 + 콤마 AND + 안내문구)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, build ✅ / lint exit 0, 2026-06-02)

**Goal**: 타이핑 중 조회 금지(디바운스 완전 제거) → Enter/🔍/필터변경에만 fetch. 콤마(,) 다중 토큰은 fallbackSearch에서 교집합(AND). 단일어는 회귀 0.

**변경 파일 (2개, DB 변경 없음 — RPC 073은 Arch 담당)**:
- `src/app/(dashboard)/customers/page.tsx`
  - 신규 state `searchInput`(초기 q) — 텍스트박스 값. `search`(초기 q)는 커밋된 검색어로 유지.
  - `debounceRef` 제거. 검색 useEffect에서 setTimeout 완전 제거 — `[search, gradeFilter, hasConsult, sortKey]` 변경 시 즉시 fetch.
  - input: `value=searchInput` / `onChange=setSearchInput` / `onKeyDown` Enter→`setSearch(searchInput)`.
  - 돋보기 svg → `<button onClick={()=>setSearch(searchInput)} aria-label="검색">`.
  - X 클리어: 표시조건 `searchInput`, onClick `setSearchInput('')+setSearch('')`.
  - 검색 div를 `flex-1 max-w-lg` wrapper로 감싸 input(`div.relative`) + 안내 `<p>` 세로 배치. placeholder/안내문구 브리프 그대로. 셀렉트/체크박스 행 정렬 유지.
  - URL 동기화(L182~)/listQs(L195~): `search` 사용 — 수정 없음(검증만).
- `src/app/api/customers/search/route.ts` — `fallbackSearch`만 수정.
  - 진입부 `q.split(',').map(trim).filter(Boolean)` → 토큰 ≥2면 `fallbackSearchMultiToken`로 분기. 0/1개는 기존 단일어 로직 그대로(코드 미변경, 분기만 추가).
  - 신규 `matchOneToken(token)→Set<id>`: 기존 direct ilike(name/email/address/phone/phone2 + phone 정규화 패턴) + 제품명 매칭을 id만 select하여 Set 반환. grade/branch는 호출부 일괄 적용.
  - 신규 `findProductCustomerIds(token)`: 기존 제품→주문→customer 매핑 로직 추출(단일/다중 공용).
  - 신규 `fallbackSearchMultiToken`: 토큰별 Set 교집합(작은 집합 우선) → 교집합 id로 customers select + grade/branch 필터 → attachPoints/attachHistory/postFilterAndSort/페이징 기존 흐름. match_reasons는 `검색: <토큰들>` 한 줄.

**주요 결정**:
- 단일 토큰 경로의 기존 코드 블록은 손대지 않음(분기 가드만 앞에 추가) → 회귀 0.
- 다중 토큰은 매칭 필드별 reason 대신 검색어 묶음 한 줄로 표기(교집합이라 필드 귀속이 모호). 정렬/페이징/포인트/이력은 단일과 동일 흐름.
- 교집합 id는 `.in('id', ids.slice(0,1000))` 상한(기존 폴백 관행과 일치).

**라인 어긋남**: 앞선 state/useEffect 편집으로 L번호 약간 이동했으나 모든 앵커 고유 텍스트로 정확 적용. 기능 영향 없음.

**검증**: `npm run lint` exit 0(코드베이스 기존 no-explicit-any 다수 — 신규 파일 무관, 비차단). `npm run build` ✓ — /customers static, /api/customers/search 정상 컴파일, 에러 0.

**Known Gaps**: 없음 (Out of Scope — RPC 073/legacy/포장/병합/POS/schema.ts/검색랭킹 전부 미접촉).

---

### Step — POS 큐 #1: 과거구매(legacy) 복사 → 새 판매 등록 (Phase 1 MVP)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, build ✅, 2026-06-02)

**Goal**: 과거 주문(legacy) 1건 "📋 복사"로 POS 새 판매에 반영 — 발송정보 자동 prefill + 이름 정확매칭 품목만 자동 장바구니 + 미매칭은 참고 패널(수동).

**변경 파일 (2개, DB 변경 없음)**:
- `src/app/(dashboard)/pos/page.tsx` — legacyCopyId, unmatchedLegacyItems state, applyLegacyCopy(신설, applyCopy 미수정), `?legacyCopy=` useEffect, resetCheckoutForm 리셋, 참고 패널, POS 내부 legacy 카드 "📋 이 주문 복사" footer.
- `src/app/(dashboard)/customers/[id]/page.tsx` — legacy 카드 footer 좌(📋 복사)·우(order_no), router.push('/pos?legacyCopy=').

**주요 결정**:
- 매칭 키 = `String(p.name).trim() === String(it.item_text ?? '').trim()` 단일. item_code/유사도/정규화 미사용.
- 매칭가 = 현재 products.price. 원본 단가는 참고 패널에만.
- 발송정보 PARCEL(recipient 있을 때), legacy엔 zipcode/detail 없어 ''. address 통째로.
- confirm은 버튼 onClick에서만. 참고 패널 복사 후 유지(자동 제거 없음, ✕ 버튼만). clearCustomer 미접촉.
- processPosCheckout/checkout/applyCopy/재사용 함수 전부 미변경.
- build: ✓ Compiled successfully in 8.6s (에러/경고 0).

**라인 어긋남**: 브리프 L487/L582 등 applyCopy 앵커는 일치. 참고 패널·legacy 카드는 브리프 라인이 함수 삽입(+~115줄)으로 이동했으나 고유 앵커 텍스트로 정확 적용(기능 동일). 별도 이슈 없음.

**Known Gaps**: 없음 (Out of Scope 항목 — 별칭맵/유사도/포장/legacy_purchases/자동제거/schema.ts/마이그 전부 미접촉).

### Step — phone2 (전화번호2) 추가 — 프론트 + 액션 (마이그 072 는 Arch)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, build ✅, 2026-06-02)

**Goal**: 고객 등록/수정 폼에 두 번째 전화번호(phone2) 입력·저장 + 검색에서 phone/phone2 둘 다 매칭(폴백 경로).

**변경 파일 (4개, DB 변경 없음 — RPC 072 는 Arch 직접)**:
- `src/app/(dashboard)/customers/CustomerModal.tsx` — interface phone2 추가, formData prefill, "연락처" 아래 "전화번호2" 입력(formatPhone, 검증 없음), form.append('phone2').
- `src/lib/actions.ts` — createCustomer/updateCustomer customerData 에 `phone2: (formData.get('phone2') as string)?.trim() || null` (빈문자→NULL). 폴백 retry 미추가(070 적용 전제).
- `src/app/api/customers/search/route.ts` — **fallbackSearch 폴백 경로만**: orFilters·phonePatterns 에 phone2.ilike 추가, select 3곳 phone2 포함, reasons phone2 매칭 push(field 'phone' 재사용). RPC 호출부 미변경.
- `src/app/(dashboard)/customers/[id]/page.tsx` — interface CustomerDetail phone2 추가, 헤더 보조 표기 `{customer.phone2 && ...}`(formatPhone). select 는 `*`(L209)라 변경 불필요.

**주요 결정**:
- 상세 헤더 포함(스킵 안 함) — customer select 가 `*` 라 phone2 자동 노출, formatPhone import 기존 존재.
- reasons 는 field 'phone' 재사용(FIELD_LABELS '연락처' 그대로).
- build: ✓ Compiled successfully in 6.1s.

**Known Gaps**: 없음 (Out of Scope 항목 미접촉 — schema.ts/RPC/마이그/병합/백필/legacy/POS 전부 미접촉).

### Step — 고객 상세 UX 2건 (인라인 수정 + 목록 복원)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, 2026-06-02)

**변경 파일 (2개, 순수 프론트, DB 변경 없음)**:

`src/app/(dashboard)/customers/[id]/page.tsx`
- import 추가: `CustomerModal` (`../CustomerModal`).
- state 추가: `showEditModal`.
- `backHref` 도출(검색 키 q/grade/hasConsult/sort/page 만 추림, 없으면 `/customers`) → "← 목록" Link href 교체.
- "기본 정보" 카드 헤더에 "수정" 버튼 + info 탭 안내문을 "기본 정보 수정" 버튼으로 교체. 둘 다 `setShowEditModal(true)`.
- 컴포넌트 말미 `CustomerModal` 렌더(props 3개: customer/onClose/onSuccess). onSuccess 시 기존 `fetchData()` 재호출로 리로드.

`src/app/(dashboard)/customers/page.tsx`
- `useMemo` import 추가(기존 미import 이었음).
- `listQs` useMemo(검색 동기화 키와 동일, tab 제외).
- 이름 링크(L405)·"상담 기록 없음" 링크(L472)에 `listQs` 부착.

**주요 결정**:
- CustomerModal props 시그니처 실제 확인(CustomerModal.tsx L26-30): `{ customer?, onClose, onSuccess }` — 브리프와 정확히 일치. 불일치 없음.
- 상세의 `customer`는 `CustomerDetail`(모달 `Customer`의 슈퍼셋) → 구조적 호환, 그대로 전달. 새 매핑/권한 분기/fetch 함수 없음. 저장 경로는 모달 내부 `updateCustomer` 액션(목록과 동일 RBAC).
- 탭-동기화 코드(L624-626)는 미변경.

**Known Gaps**: 없음.

### Step — POS 큐 #1: 판매등록 고객패널 과거구매(legacy) 표시

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, 2026-06-02)

**변경 파일 (1개)**: `src/app/(dashboard)/pos/page.tsx` (표시 전용, DB 변경 없음)
- 타입 추가: `LegacyOrderItem` / `LegacyOrder` (interface Customer 위).
- history state 에 `legacyOrders: LegacyOrder[]` 추가, 초깃값 `[]`.
- historyTab union 에 `'legacy'` 추가.
- `expandedLegacy: Set<string>` state + `toggleLegacy` 헬퍼 추가.
- loadCustomerHistory: 진입부 `setExpandedLegacy(new Set())` 초기화, Promise.all 에 legacy_orders 3번째 쿼리(.limit(50)) 추가, setHistory 에 legacyOrders 세팅. 기존 try/catch 재사용(신규 X).
- setHistory 전체 리셋 4곳 모두 `legacyOrders: []` 동기화(L710 성공·L717 catch·clearCustomer·resetForm). 후자 2곳은 `setExpandedLegacy(new Set())`도 동반.
- 탭 버튼 "과거 구매 (N)" 추가(항상 노출).
- 본문: historyTab 3분기 ternary(`consult ? : orders ? : legacy`). legacy 컴팩트 카드(일자·지점·합계·품목수 + 발송지 줄 + 클릭 펼침 line_seq 순 품목).

**주요 결정**:
- 패널 폭에 맞춰 customers/[id] 대비 컴팩트(text-[10px]/[11px], p-1.5, w-8/w-20). 검색필터·item_code·payment_status 배지·source_file 생략(범위 밖/좁은 패널).
- limit 50 (브리프 락). 고객상세 9999 무손상.
- build: ✓ Compiled successfully in 6.9s (TS 에러 0).

**Known Gaps**: 없음 (범위 밖 항목 미접촉 — 복사버튼/포장옵션/임포터/schema.ts/검색필터/페이징 전부 미접촉).


### Step — POS 판매등록 위젯 표시 속성 (pos_widget)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, 2026-06-02)

**변경 파일 (5개)**:
- 신규: `supabase/migrations/071_products_pos_widget.sql` — pos_widget boolean NOT NULL DEFAULT false + 백필(FINISHED & 비-phantom) + COMMENT. 인덱스 없음. **DB 적용은 Arch(psycopg)**.
- 수정: `src/app/(dashboard)/products/ProductModal.tsx` — interface 에 pos_widget, formData 초기값(편집=기존값 / 신규=완제품&비세트→true), track_inventory 옆 "판매등록 위젯 표시" 체크박스(모든 유형 노출). 직렬화는 기존 formData 루프(L312)가 자동 처리.
- 수정: `src/lib/actions.ts` — createProduct/updateProduct 에 pos_widget 폼값 우선 + 규칙(FINISHED&비phantom) 폴백 + 마이그 071 미적용 delete-retry 폴백.
- 수정: `src/app/(dashboard)/pos/page.tsx` — loadTier1 select 에 pos_widget 추가(071/042 2단 폴백), filteredProducts 분기(검색어 없으면 pos_widget===true만, 검색 중이면 전체). 컬럼 부재(undefined)=전부 노출.
- 수정: `src/lib/ai/schema.ts` — products 라인에 pos_widget 추가.

**주요 결정**:
- updateProduct 폴백: pos_widget 폼값 부재 시 product_type 명시되면 규칙 폴백, 아니면 undefined(미변경). 기존 conditional-spread 패턴 준수.
- pos select 폴백을 2단계로 분리(071→042) — 컬럼 부재시 product_type 보존하면서도 안전 재시도.
- build: ✓ Compiled successfully in 7.5s.

**Known Gaps**: 없음 (범위 밖 항목 미접촉).


### Step — 레거시 판매데이터 정규화 1단계 (데이터층)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, 2026-06-02)

**변경 파일 (2개)**:
- 신규: `supabase/migrations/070_legacy_orders_normalize.sql` — customers.phone2 컬럼 추가, legacy_orders/legacy_order_items 테이블 생성(064 패턴 RLS+GRANT), legacy_purchases 에서 멱등 분리적재(헤더→아이템).
- 수정: `src/lib/ai/schema.ts` — DB_SCHEMA 에 customers.phone2, legacy_orders, legacy_order_items 추가 + legacy_purchases 정규화 예정 주석.

**주요 결정**:
- 헤더 대표값은 MIN(col). UUID 컬럼(customer_id, branch_id)은 MIN(::text)::uuid 로 캐스팅(uuid 타입에 직접 min 집계 없음).
- line_seq = ROW_NUMBER() OVER (PARTITION BY legacy_order_no ORDER BY lp.id), ::smallint 캐스팅.
- 멱등: 두 INSERT 모두 ON CONFLICT DO NOTHING (legacy_order_no / (order_id,line_seq)).
- 적재 소스에서 legacy_order_no IS NULL 행은 제외(WHERE 가드) — UNIQUE NOT NULL 위반 및 무키 주문 방지.
- legacy_purchases 무손상: SELECT 만, ALTER/UPDATE/DROP 없음.

**검증**: `npm run build` 통과 (schema.ts 타입/문법). .sql 적용·검증은 Arch 가 psycopg 로.

**Known Gaps (스코프 밖)**:
- 앱 read 정규화본 전환(고객 상세 과거구매 탭, /customers/analytics RFM) — 후속 단계.
- legacy_purchases DROP, 임포터 재작성, phone2 백필, 복사/매핑 UI — 후속 단계.



### Step 2 — KST 타임존 Phase A (표시 레이어 표준화)

**상태**: ✅ 배포 완료 (commit `2a8e8a2`, 2026-04-22)

**변경 파일 (12개)**:
- 신규: `src/lib/date.ts` — `Intl.DateTimeFormat({ timeZone: 'Asia/Seoul' })` 기반 포맷터 7종 (Brief 스펙 5종 + 한글 스타일 2종)
- 수정 (UI 표시 경로만):
  - `src/app/api/agent/route.ts` — 에이전트 컨텍스트 "오늘" 표기
  - `src/app/(dashboard)/agent-memory/page.tsx` — 메모리 최근 사용일
  - `src/app/(dashboard)/agent-conversations/page.tsx` — 대화 로그 타임스탬프
  - `src/app/(dashboard)/customers/[id]/page.tsx` — 등록일 + 상담/주문 타임스탬프 + 월 그룹 헤더
  - `src/app/(dashboard)/customers/CampaignTab.tsx` — 캠페인 예약시각 표시 (`fmtScheduled`만, `toDTLocal`은 미해결)
  - `src/app/(dashboard)/DashboardClient.tsx` — 대시보드 주문 타임스탬프
  - `src/app/(dashboard)/inventory/MovementHistoryModal.tsx` — 재고 이동 이력
  - `src/app/(dashboard)/notifications/page.tsx` — 알림 발송 시각
  - `src/app/(dashboard)/pos/ReceiptModal.tsx` — 영수증 날짜/시간 (프린트 포함)
  - `src/app/(dashboard)/production/page.tsx` — 생산 지시 created/produced_at
  - `src/app/(dashboard)/reports/page.tsx` — PDF generatedAt

**주요 결정**:
1. 포맷 로케일은 `sv-SE` 사용 — `ko-KR`은 "2026. 04. 22." 형태로 구분자가 점이라 가독성 떨어짐. `sv-SE`는 "2026-04-22 14:30"의 ISO 유사 출력.
2. Brief 스펙 5종(`fmtDateTimeKST`, `fmtDateKST`, `fmtTimeKST`, `fmtMonthKST`, `fmtDateTimeKSTWithSeconds`) + **추가 2종** (`fmtKoreanDayKST`, `fmtKoreanMonthKST`) — 기존 한글 스타일 유지용(체크리스트 #7 충족). 불필요하면 축소 가능.
3. `Intl.DateTimeFormat` 인스턴스는 모듈 상수로 7개 캐싱 — 매 호출마다 생성하지 않음.
4. 쿼리 경계(`fmtDate` 기반 `todayStr`/`daysAgo`, `toISOString().slice(0,10)`)는 **전부 미변경** — Step 3 영역.
5. 외부 API 경로(`cafe24`/`solapi`), DB insert/update, datetime-local input(`CampaignTab.toDTLocal`)은 미변경.

**빌드**: `npm run build` ✅ 통과 (46 static pages, TypeScript 14.8s).

## Deferred / Known Gaps

### Step 1 — POS 매출처 기본값 개선 (보류)

- 2026-04-22 Brief까지 작성 후 새 우선순위(타임존)로 보류
- 스코프: HQ 역할(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE)은 매출처 자동 선택 제거, BRANCH 역할은 기존 유지
- 건드릴 파일: `src/app/(dashboard)/pos/page.tsx` (약 10줄 내외)
- 재개 조건: Step 2·3 (타임존) 완료 후

### Step 2 — 미해결 건 (Richard 리뷰 대상)

1. `CampaignTab.toDTLocal` (datetime-local input value) — 브라우저 로컬 TZ 의존. KST 고정은 input onChange 쪽도 함께 재설계 필요. 현재 KR 사용자 환경에서는 버그 없음.
2. 추가 formatter(`fmtKoreanDayKST`, `fmtKoreanMonthKST`)의 포함 여부 — Brief 스펙 범위 판단 필요.

### Step 3 — KST 타임존 Phase B (쿼리 경계) 예정

- 미변경 callsite: `pos/SalesListTab.tsx` / `agent-conversations/page.tsx` / `customers/[id]/page.tsx`의 `fmtDate`/`todayStr`/`daysAgo`
- `ai/tools.ts`, `api/dashboard/route.ts`, `api/cafe24/members/route.ts`, `b2b-actions.ts`, `campaign-actions.ts` 등 서버 날짜 계산 경로

### Step 3 — KST 타임존 Phase B (쿼리 경계 표준화)

**상태**: 🔄 Conditions 수정, 재리뷰 대기 (Round 2, 2026-04-22)

**신규 유틸 (`src/lib/date.ts` 확장, 7함수)**:
- `kstDayStart(date?)` — KST 자정 → UTC ISO
- `kstDayEnd(date?)` — KST 23:59:59.999 → UTC ISO
- `kstMonthStart(date?)` — 월초 KST → UTC ISO
- `kstMonthEnd(date?)` — 월말 KST 마지막 ms → UTC ISO
- `kstTodayString()` — KST 오늘 "YYYY-MM-DD"
- `kstYearMonth(date?)` — KST "YYYY-MM"
- `kstDaysAgoStart(n)` — KST 기준 N일 전 자정 → UTC ISO

**구현 방식**: `new Date(isoLikeString + '+09:00')` (Brief 권장안) — Date 객체/문자열 입력을 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })`로 KST 달력 parts 추출 후 `YYYY-MM-DDTHH:MM:SS.sss+09:00` 형태로 재조립.

**변경 파일 (32개)**:
- 신규 유틸 추가: `src/lib/date.ts` (+7 함수, 약 130줄)
- 대시보드·보고: `src/app/api/dashboard/route.ts`, `src/app/api/dashboard/details/route.ts`, `src/app/(dashboard)/DashboardClient.tsx`, `src/app/(dashboard)/reports/page.tsx`
- 회계: `src/lib/accounting-actions.ts`, `src/app/(dashboard)/accounting/page.tsx`
- POS/환불: `src/app/(dashboard)/pos/page.tsx`, `src/app/(dashboard)/pos/SalesListTab.tsx`, `src/app/(dashboard)/pos/RefundModal.tsx`, `src/lib/return-actions.ts`
- 매입: `src/lib/purchase-actions.ts`, `src/app/(dashboard)/purchases/page.tsx`, `src/app/(dashboard)/purchases/prices/page.tsx`
- 고객/캠페인: `src/app/(dashboard)/customers/[id]/page.tsx`, `src/app/(dashboard)/customers/CampaignTab.tsx`, `src/lib/campaign-actions.ts`, `src/lib/customer-analytics-actions.ts`
- 외상/B2B: `src/app/(dashboard)/credit/page.tsx`, `src/lib/credit-actions.ts`, `src/app/(dashboard)/trade/CreditTab.tsx`, `src/app/(dashboard)/trade/B2bSalesTab.tsx`, `src/lib/b2b-actions.ts`
- 알림/배치: `src/app/(dashboard)/notifications/page.tsx`, `src/lib/notification-actions.ts`, `src/app/api/notifications/batch/dormant/route.ts`, `src/app/api/notifications/batch/birthday/route.ts`
- Cafe24 연동: `src/app/api/cafe24/sync-orders/route.ts`, `src/app/api/cafe24/members/route.ts` (디폴트값만), `src/app/api/cafe24/orders/route.ts`, `src/app/api/cafe24/debug/route.ts`, `src/lib/cafe24/webhook.ts`
- 에이전트/기타: `src/lib/ai/tools.ts`, `src/app/(dashboard)/agent-conversations/page.tsx`, `src/lib/production-actions.ts`, `src/lib/actions.ts` (POS 주문번호), `src/app/(dashboard)/inventory/count/page.tsx`, `src/app/(dashboard)/shipping/page.tsx`, `src/app/join/[branch]/JoinForm.tsx`

**주요 결정**:
1. **치환 판단 기준**: 사용자 "오늘/이번 달/최근 N일" 의미 → 치환. 세션/토큰/감사/외부 API payload/경과시간 → 스킵. 문서번호 prefix(PO/GR/WO/RC/JE/RT/B2B-YYYYMMDD)는 사용자 대면 날짜 → KST로 치환.
2. **`exportSalesCSV`의 `const date` 데드 코드**(reports/page.tsx:401): 선언만 하고 미사용. 스코프 외로 판단하여 유지.
3. **`new Date(baseDate + 'T00:00:00')` 패턴 (dashboard 주 단위 계산)**: `getPeriodRange`의 weekday 계산은 calendar date 대상 pure 연산이라 UTC 해석과 KST 해석 결과가 동일 → 경계 인자(`.gte/.lte`)만 `kstDayStart/End`로 치환.
4. **date-only 컬럼 내 날짜 이동** (campaign-actions.ts nextStart/nextEnd의 `setFullYear(+1)`): UTC midnight 기반 calendar date 연산으로 TZ 영향 없음 → 미변경.
5. **`new Date().toISOString()`가 `created_at/updated_at/sent_at/processed_at` 같은 audit timestamp 필드에 들어가는 경우**: 모두 미변경 (Brief §6.2).
6. **Cafe24 API calendar date 파라미터**: `startDate`/`endDate`는 YYYY-MM-DD 포맷이므로 KST-today 기준 `fmtDateKST`/`kstTodayString` 사용이 안전 (API 스펙 위반 없음).

**빌드**: `npm run build` ✅ 통과 (46 pages, TypeScript 14.4s, 0 errors).

**Round 2 수정 (2026-04-22)** — Richard Conditions 4건:
- `src/lib/ai/tools.ts:1246-1247` (execGetOrders) — `${date}T...` → `kstDayStart/kstDayEnd`
- `src/lib/ai/tools.ts:2357-2358` (execCompareSales periodSummary) — 동일 패턴 치환
- `src/app/(dashboard)/pos/SalesListTab.tsx:9,192-193` — import에 `kstDayStart/End` 추가 + 쿼리 경계 치환
- `src/lib/b2b-actions.ts:173-189` (MONTHLY 정산예정일) — `getFullYear/getMonth` 제거, `kstTodayString()` 파싱 기반 다음 달 조립 (12월→1월 wrap 포함)
- `npm run build` ✅ 재통과 (46 pages, 0 errors).

**Round 2 Richard 리뷰**: ✅ APPROVED (드리프트 없음, 3 파일 한정)

**배포**: ✅ commit `db58077` (2026-04-22)

### Step 4 — POS 판매 등록: 완제품만 노출

**상태**: ✅ 배포 완료 (commit `cd75a6d`, 2026-04-22)

**변경 파일 (2개)**:
- `src/app/(dashboard)/pos/page.tsx` (L274 주변, 초기 데이터 로드) — 제품 로드 쿼리에 `product_type` 추가 + 마이그 042 미적용 폴백. 이후 `p.product_type !== 'RAW' && p.product_type !== 'SUB'` in-memory 필터를 setProducts/productMap 양쪽 앞단에 배치.
- `src/lib/actions.ts` (L1111 주변, `processPosCheckout`) — 재고 확인 직전에 RAW/SUB 서버 방어 블록 신설. cart productId들을 `products.in('id', [...])`로 한 번에 조회 후 RAW/SUB 있으면 한글 에러 반환. 폴백: 쿼리 에러 시 검증 스킵.

**주요 결정**:
1. 클라이언트 필터링은 `products` state 한 경로에서만 이루어지고, `filteredProducts`·`productMap`은 파생 객체라 자동 반영 — 수정 최소화.
2. 서버 방어는 `sales_order_items` insert 이전(재고 확인 이전)에 실행하여 DB 어떤 변경도 발생시키지 않고 즉시 중단.
3. 주석 넘버링은 기존 ①∼⑥을 유지하기 위해 새 가드 블록에 `⓪`을 부여하여 후속 번호 시프트 최소화.
4. 마이그 042 미적용 DB에서는 필터·서버 검증 모두 스킵(운영 차단 방지). 실제 운영 DB에는 042가 이미 적용되어 있어 차단이 유효.
5. `isMaterialType` 등 헬퍼 재정의 없이 인라인 조건으로 스코프 최소화 (Brief §Flag).

**빌드**: `npm run build` 통과 (46 pages, 0 errors).
**Richard 리뷰**: ✅ APPROVED (드리프트 없음, 2 파일 한정). Escalate: B2B 경로 → Step 5.

### Step 5 — B2B 납품 등록: 완제품만 노출

**상태**: Bob 빌드 완료, Richard APPROVED (2026-04-22)

**변경 파일 (2개)**:
- `src/app/(dashboard)/trade/B2bSalesTab.tsx` (L37-64 `fetchData`) — 제품 로드를 `Promise.all`에서 분리, `product_type` 포함 1차 select + 마이그 042 폴백. `productsData = filter(p.product_type !== 'RAW' && !== 'SUB')` 후 `setProducts`. `B2bSalesForm` 드롭다운이 `products` state 기반이라 RAW/SUB 자동 제외.
- `src/lib/b2b-actions.ts` (L160-172 `createB2bSalesOrder`) — `sb` 생성 직후, partner 조회·총액 계산·전표번호 조립·`b2b_sales_orders` insert·`b2b_sales_order_items` insert·재고 차감·분개 생성 모두 이전에 `⓪` RAW/SUB 서버 방어 블록. cart productId 중복 제거 후 `products.in('id', [...])`로 일괄 조회. 폴백: 쿼리 에러 시 검증 스킵.

**주요 결정**:
1. Step 4 POS 패턴을 그대로 복사 (구조·주석 넘버링·한글 에러 문구 일치).
2. 단가표(`getPartnerPrices`, `bulkUpsertPartnerPrices`) 경로는 스코프 외 — BOM 원가 관리용 가능성. 필요 시 후속 Step.
3. 수금·취소(`settleB2bOrder`, `cancelB2bOrder`)는 이미 존재 주문 기반이라 새 insert 없음 → 스코프 외.

**빌드**: `npm run build` 통과 (46 pages, 5.3s compile, 0 errors).

## Current Status

Step 5 Richard APPROVED, 배포 대기.

---

## In Progress

### Step (신규) — 레거시 판매데이터 정규화 1단계 (데이터층)

**상태**: 🔨 Brief 작성 완료, Bob 빌드 대기 (2026-06-02)

**Goal**: flat legacy_purchases -> legacy_orders(헤더) + legacy_order_items(품목) 정규화 + customers.phone2. 순수 추가형.

**Locked Decisions (Arch)**:
- 헤더 컬럼 대표값 = MIN(col). 근거: 주문내 값갈림 0%(phone 만 5건 0.01%) DB 검증 완료 -> MIN 으로 결정성 확보.
- line_seq = row_number() over (partition by legacy_order_no order by lp.id). (legacy_purchases.line_seq 전부 NULL)
- RLS/GRANT 064 패턴 그대로(anon+authenticated FOR ALL USING true + 명시 GRANT). 시스템 custom session auth -> client ANON role.
- 멱등 적재(ON CONFLICT DO NOTHING / NOT EXISTS) — 재실행 안전.
- DB 적용은 Arch 가 psycopg 로 직접(.env.local DATABASE_URL, PYTHONIOENCODING=utf-8 PYTHONUTF8=1). Bob 는 .sql + schema.ts 만.
- legacy_purchases 무손상(이번 스프린트). DROP 은 후속 단계.

**Known Gaps (이번 스코프 밖, 후속 단계)**:
- 앱 read 정규화본 이전(고객 상세 과거구매 탭, /customers/analytics RFM).
- legacy_purchases DROP / 임포터 재작성(legacy-import-v2 직접 정규화 적재) / phone2 백필 / 복사·매핑 UI.

**Acceptance**: legacy_orders=47,268 · legacy_order_items=66,090 · SUM(total_amount) 일치 · line_seq NULL=0 · 고아 item=0 · build 통과.

---

## In Progress (갱신 2026-06-02)

> 1단계(데이터층, 마이그 070)은 적용+커밋(`4c524fe`) 완료. 위 "In Progress" 의 1단계 블록은 종료로 간주.

### Step — 레거시 판매데이터 정규화 2단계 (앱 read 리팩터)

**상태**: 🔵 리뷰 대기 (REVIEW-REQUEST 제출, build ✅, 2026-06-02)

**Goal**: 앱 read 경로를 `legacy_purchases`(라인) → `legacy_orders`(헤더)+`legacy_order_items`(품목) 로 전환. RFM 빈도(F)·재구매·"과거 N건" 뱃지가 주문수 기준으로 정확해짐(버그픽스). 고객 상세 과거구매 탭 = 주문 카드 + 품목 나열 + **발송지(recipient_*) 노출**.

**대상 파일 (5)**:
- `src/lib/customer-analytics-actions.ts` — getRfmAnalysis/getRepurchaseCycles/getChurnRiskCustomers 의 legacy fetch 테이블명만 `legacy_orders` 로. count=주문수 자동 보정.
- `src/app/api/customers/search/route.ts` — legacy fetch → legacy_orders, legacyCount=주문수. 반환 필드명 `legacy_purchase_count` 유지.
- `src/app/(dashboard)/customers/page.tsx` — 진입 카운트 head count → legacy_orders.
- `src/app/(dashboard)/pos/SalesListTab.tsx` — 변경 0(값 의미만 주문수), 검토만.
- `src/app/(dashboard)/customers/[id]/page.tsx` — 과거구매 탭 재구조화(주문 카드+품목+발송지). 중첩 select.

**Locked Decisions (Arch)**:
- 읽기 경로만. legacy_purchases ALTER/UPDATE/DROP 절대 금지(DROP=다음 스텝).
- 고객 상세: 중첩 select 1회(`legacy_orders` + `legacy_order_items(*)` + `branch:branches(name)`). 별도 IN 페치 금지(FK 존재로 가능, 고객당 주문 수백 이내).
- 발송지 = recipient_name/phone/address 헤더 1곳. **값 정제 금지**(카드/계좌 메모도 그대로), 빈값만 '-'.
- 출고처 = branch.name, 없으면 branch_code_raw, 둘 다 없으면 '-'.
- "과거 구매 N건" 의미 = 라인수→**주문수**(F 부풀림 버그픽스). 라벨 그대로 일관.
- search route 반환 필드 `legacy_purchase_count` 리네이밍 안 함(churn 최소화).
- M(Monetary) 값 보존: 라인 total 합 = 주문 헤더 total(070 SUM 일치 검증).
- schema.ts(AI 스키마)는 070 에서 이미 동기화됨 → 이번 미변경.

**Known Gaps (스코프 밖, 후속)**:
- legacy_purchases DROP — 다음 별도 스텝.
- 임포터 재작성 / phone2 백필 / 복사재판매 UI / POS prefill / item_code→products 매핑.
- 발송지 값 정제(카드·계좌 메모 분리).

**Acceptance**: build 통과 · 앱 read 의 `.from('legacy_purchases')` 잔존 0(grep) · 고객상세 주문카드+발송지 노출 · 뱃지 N=주문수 · M 값 보존.
