# Architect Brief — 판매일보 Phase 2a (승인 → 재고·매출 연동 + 승인취소) [확정]

## Goal
관리자가 SUBMITTED 일보를 **승인(APPROVED)** 하면 라인수량→실재고 이동 + 현장/택배매출→매출분개. **승인취소(unpost)** 로 재고복원+역분개. 멱등(posting/unposting 각 1회). 🔴 실재고+회계 이동, 가장 민감.

## ✅ PO 결정 확정 (LOCKED — 더 이상 에스컬레이션 없음)
- **E1 차변 = 미수금/외상매출금(1115)**. 백화점 월정산 구조. 현장매출·택배매출 모두 1115 차변. 실제 입금회수는 후속(settle 패턴).
- **E2 승인취소 = Phase2a 포함**. unpostDailyReport: 재고 반대 movements 복원 + 역분개(음수/역 createSaleJournal) + posted=false·status 되돌림. 멱등(이미 unpost면 차단).
- **E3 승인 후 수정 잠금 = YES**. APPROVED·posted면 입력/저장 차단. 수정하려면 승인취소 선행.
- 시음/파손 GL 갭 수용(재고 OUT만, 분개 없음) — 기결정.

## 🔴 안전 원칙 (변경 없음)
- posting/unposting 각 정확히 1회. posted 플래그 조건부 update(`where posted=...`)로 동시성 멱등.
- 분개 먼저 검증 → 대차불일치/실패면 재고 미적용·전체 throw(best-effort 아님). unpost도 역분개 먼저.
- SUBMITTED→APPROVED만 posting. APPROVED→(되돌림)만 unposting.

## POS 경로 재사용 (grep 확정)
- `processPosCheckout`(actions.ts:2466): normal+팬텀분해 → inventories 감소 + `inventory_movements`(OUT, reference_id/type) + COGS=OUT product×`products.cost`.
- `createSaleJournal`(accounting-actions.ts:472): paymentMethod별 차변(→ **일보는 항상 1115/credit 경로**), 대변 매출4110+VAT2151, COGS 5110차/1130대. **음수 totalAmount=역분개**(unpost가 이걸 그대로 사용).
- `inventory_movements`(schema.sql:127): reference_id/reference_type/branch_id/product_id/movement_type/quantity(**마이그087로 NUMERIC** → 소수 OK)/created_by(마이그095). → unpost는 `reference_type='DAILY_REPORT' AND reference_id=report_id` 로 OUT/IN 전량 조회 후 반대 movement 적용 가능.

## 마이그103 점검 결과 — 역연동 지원 충족, 보강 불요
파일 `supabase/migrations/103_daily_report_approval.sql` 최종 컬럼:
- `status` CHECK = 'DRAFT','SUBMITTED','**APPROVED**' (인라인 무명 CHECK 동적제거 후 명명제약 재생성)
- `approved_by` UUID REF users / `approved_at` TIMESTAMPTZ
- `posted` BOOLEAN NOT NULL DEFAULT false / `posted_at` TIMESTAMPTZ
- `journal_entry_id` UUID — 승인 시 생성 매출분개 id 저장 → **unpost가 이 분개를 역분개·추적**
→ 재고 역연동은 inventory_movements reference로 추적(별도 컬럼 불요). **마이그103 보강 불필요. 적용 금지(PO 직접 승인 후 코디네이터).**

## Build Order

### 1) 마이그103 — 작성 완료(미적용). Bob은 컬럼명만 사용.

### 2) 액션 — `src/lib/daily-report-actions.ts`

**`approveDailyReport(reportId)`**
- requireSession + MANAGER_ROLES 아니면 throw. 헤더 로드: status==='SUBMITTED' 아니고/posted===true면 throw(멱등 1차).
- 라인 집계(POS 규칙): OUT=onsite_sold+sample_damage, IN=in_return (product별, 팬텀이면 BOM 분해). **COGS=onsite_sold분만**×cost(sample_damage 제외).
- **분개 먼저**: createSaleJournal({ orderId:reportId, orderNumber:`DR-{branchCode}-{date}`, orderDate:report_date, totalAmount:Σ(onsite_revenue+parcel_revenue), **paymentMethod:'credit'**(→1115), cogs, taxableAmount:전액, sourceType:'DAILY_REPORT', createdBy }). null/대차불일치 → 전체 throw.
- 분개 성공 → 재고 movements 적용(OUT/IN, reference_type='DAILY_REPORT', reference_id=reportId, created_by, memo) + inventories 갱신(음수 허용+경고).
- 헤더 조건부 update `where id=reportId AND posted=false`: status='APPROVED', approved_by/at, posted=true, posted_at, journal_entry_id=분개id. **update 영향행 0이면**(동시 승인) → 분개 롤백 시도/에러. revalidatePath + writeAuditLog.

**`unpostDailyReport(reportId)`** (E2)
- requireSession + MANAGER_ROLES. 헤더 로드: status==='APPROVED' AND posted===true 아니면 throw(멱등: 이미 unpost면 차단).
- **역분개 먼저**: 저장된 journal_entry_id 기준 역분개 생성 — createSaleJournal에 **음수 totalAmount/cogs + reversalOf:journal_entry_id + sourceType:'DAILY_REPORT_CANCEL'** (환불 패턴). 실패 시 전체 throw.
- 재고 복원: `inventory_movements` where reference_type='DAILY_REPORT' AND reference_id=reportId 조회 → 각 행 **반대 movement**(OUT→IN, IN→OUT) 신규 insert(reference_type='DAILY_REPORT_CANCEL', reference_id=reportId) + inventories 원복. (기존 movements는 감사이력으로 남김, 삭제 금지.)
- 헤더 조건부 update `where posted=true`: posted=false, posted_at=null, status='SUBMITTED'(되돌림), approved_by/at=null, journal_entry_id=null. revalidatePath + writeAuditLog.
- ⚠️ 멱등: reversal movements가 이미 있으면(reference_type='DAILY_REPORT_CANCEL') 재실행 차단(중복복원 방지) — posted=false 가드로 1차 커버.

**수정 잠금 (E3)**: `saveDailyReport`에 가드 추가 — 헤더 status==='APPROVED' OR posted===true면 throw('승인된 일보는 수정 불가. 승인취소 후 수정하세요.'). (이미 posted 일보 재저장이 재고 재계산 안 되게 방어.)

### 3) UI — `src/app/(dashboard)/daily-report/page.tsx`
- 관리자 SUBMITTED 상세: **[승인]** 버튼 + 확인 모달(재고/매출 반영 경고). → approveDailyReport.
- APPROVED 상세: 배지 '승인완료' + 폼 **읽기전용 잠금** + **[승인취소]** 버튼 + 확인 모달(재고복원/역분개 경고). → unpostDailyReport.
- 비관리자 승인/취소 UI 없음.

### 4) AI 스키마 — 필수
schema.ts DB_SCHEMA daily_sales_reports 에 APPROVED·approved_by/at·posted/posted_at·journal_entry_id 추가. BUSINESS_RULES: "일보 승인=재고이동(DAILY_REPORT)+매출분개(현장+택배, 차변 1115 미수금, sample_damage 재고만). 승인취소=역분개+반대movements(DAILY_REPORT_CANCEL). 멱등 posted." 한 줄.

## Out of Scope (→ Known Gaps)
- 시음/파손 비용분개(재고만 → GL 1130-실재고 갭, 수용).
- 면세 정밀안분(전액 과세 가정). sales_orders 행 미생성(분개+movements만).
- 1115 미수금 실입금 회수처리(후속 settle).
- RPC 단일트랜잭션 미사용 시 부분실패 가능성(분개검증 선행으로 최소화, 잔여는 Gap).

## Acceptance
- SUBMITTED→[승인]: status APPROVED·posted=true, movements(DAILY_REPORT OUT/IN), 매출분개(차변 1115, COGS 5110/1130, 대차일치). 재승인 차단.
- APPROVED→[승인취소]: 역분개(reversalOf, 음수)+반대movements(DAILY_REPORT_CANCEL)+posted=false·status SUBMITTED. 재취소 차단.
- APPROVED/posted 일보 saveDailyReport 호출 throw(수정잠금).
- sample_damage 재고 OUT만(분개 제외). 본사택배 재고/매출 무영향.
- 비관리자 approve/unpost throw. `npm run build` 통과. schema.ts 동기화.

## 에스컬레이션
**없음 — E1/E2/E3 모두 PO 확정.** 마이그103 적용만 PO 직접 승인 후 코디네이터 처리(Arch 미적용).
