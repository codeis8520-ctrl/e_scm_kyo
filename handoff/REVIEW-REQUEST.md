# Review Request — 판매일보 Phase 2a (승인→재고·매출 연동 + 승인취소)
Date: 2026-06-26
Ready for Review: YES
🔴 실재고+회계 이동 — Richard 보안리뷰 필수.

마이그103(status APPROVED+approved/posted/journal_entry_id) 적용 완료. schema.ts 동기화 포함. build ✓ (compile, 에러·경고 0).

## Files Changed
### 액션 (daily-report-actions.ts)
- import: createSaleJournal, writeAuditLog 추가.
- saveDailyReport(E3 잠금): 기존 헤더 status==='APPROVED' || posted===true 면 `{error}` 반환(승인취소 선행 안내). upsert 전 가드.
- computeStockDeltas(헬퍼): 라인→outMap/inMap(product_id→qty)+cogs. **팬텀=BOM 분해**(POS 규칙), 자재 cost 보강. OUT=onsite_sold+sample_damage, IN=in_return, **COGS=onsite_sold분만**×cost(sample_damage 제외). 부작용 없음(계산만).
- applyMovement(헬퍼): inventories 증감(음수 허용·행 없으면 insert) + inventory_movements 1건(reference_type/reference_id/created_by).
- approveDailyReport(reportId): requireSession+MANAGER_ROLES. 헤더 status==='SUBMITTED' && posted!==true 아니면 차단. ①computeStockDeltas ②**매출분개 먼저** createSaleJournal(paymentMethod:'credit'→1115, cogs, sourceType:'DAILY_REPORT') 실패→`{error}`(재고 미적용) ③재고 OUT/IN 적용(실패 시 분개 삭제 롤백) ④헤더 **조건부 update where posted=false**(status=APPROVED,approved_by/at,posted=true,posted_at,journal_entry_id). 영향행 0=동시승인→분개·movements 정리+에러. writeAuditLog.
- unpostDailyReport(reportId): MANAGER_ROLES. status==='APPROVED'&&posted 아니면 차단 + CANCEL movements 존재 시 차단(멱등2차). ①**역분개 먼저** createSaleJournal(음수 totalAmount + reversalOf=journal_entry_id, sourceType='DAILY_REPORT_CANCEL') 실패→`{error}` ②원본 DAILY_REPORT movements 조회→반대 movement(DAILY_REPORT_CANCEL) 신규 insert(원본 삭제 안 함) ③헤더 조건부 update where posted=true(posted=false,status=SUBMITTED,approved/journal null). writeAuditLog.
- listDailyReports: status 'APPROVED' 포함, summary.approved 추가, rank 보정.

### UI (page.tsx)
- status 상태 'APPROVED' 추가, reportId·confirmAction 상태. load 시 reportId 세팅.
- doApprove/doUnpost(확인모달 경유, 후 load 재조회). isApproved=잠금 기준.
- 입력 본문 `<fieldset disabled={isApproved}>` 로 감쌈(매장/날짜 선택은 밖 — 탐색 가능). 승인 잠금 안내 배너.
- 하단 footer 분기: APPROVED→[승인취소](관리자, fieldset 밖) / 그 외→[임시저장]/[제출] + (관리자&&SUBMITTED&&reportId→[승인]). 비관리자 approve/unpost 버튼 없음.
- 확인 모달(재고/매출 반영·역연동 경고). 제출현황 StatusBadge·summary에 승인완료(blue) 반영.

### schema.ts
- DB_SCHEMA daily_sales_reports: 마이그103 컬럼 + 승인/취소 규약(차변 1115·COGS·시음파손 재고만·역분개·멱등) 주석.

## approve 순서·멱등
분개 먼저 생성·검증(null=대차불일치/실패 → 재고 미적용·error 반환, **best-effort 아님**) → 재고 OUT/IN → 헤더 posted 조건부 update(where posted=false). 동시 승인 시 영향행 0 → 본 호출 생성 분개/movements 정리. SUBMITTED→APPROVED만.

## unpost 순서·역연동·멱등
역분개 먼저(음수+reversalOf, 실패 시 재고 미복원·error) → 원본 movements 반대로 신규 insert(DAILY_REPORT_CANCEL, 원본 보존) → 헤더 posted 조건부 update(where posted=true). 멱등: posted!==APPROVED 차단 + CANCEL movements 존재 시 차단(중복복원 방지).

## 차변 1115 / COGS
- createSaleJournal paymentMethod:'credit' → receivableCode '1115'(미수금) 차변(검증: accounting-actions.ts:497). 대변 매출4110+VAT2151.
- COGS=Σ(onsite_sold×products.cost), 팬텀은 BOM 분해 자재 cost(POS Step2 동일). sample_damage 제외. createSaleJournal COGS 5110차/1130대.

## 수정 잠금(E3)
saveDailyReport 가 기존 헤더 APPROVED/posted 면 throw. 승인 후 재저장이 재고 재계산 못 하게 방어.

## 무회귀
- 기존 getDailyReport/getReportTemplate/getDailyReportBranches/resolveBranchId·Phase1.1 콤보/그리드·Phase1.2 현황 무변경(추가만).
- POS processPosCheckout·createSaleJournal 무수정(재사용만).

## Open Questions / 에스컬레이션
- 없음(E1 1115/E2 unpost/E3 잠금 PO 확정). 마이그103 적용 완료.
- (수용된 Gap) RPC 단일트랜잭션 미사용 → 분개검증 선행 + 조건부 update로 부분실패 최소화, 잔여(분개 성공 후 재고 적용 중 크래시)는 분개 롤백 best-effort. sales_orders 행 미생성(분개+movements만).

## Out of Scope (Known Gaps)
- 시음/파손 비용분개(재고만, GL 1130 갭 수용).
- 면세 정밀안분(전액 과세 가정).
- 1115 미수금 실입금 회수(후속 settle).
- RPC 트랜잭션화.
