# BUILD-LOG — 경옥채 시스템

## Phase 0 — 회계 정합성 토대 (4 스텝)
세무사 전달용 자료 생성이 최종 목표. 과세·면세 겸영. 마이그는 Arch 직접.

### Step 1 — 환불 역분개 보강  ← ✅ DEPLOYED (76793cd)
Date: 2026-06-24
Status: ✅ COMPLETE — Richard 재리뷰 clean(Must Fix 0) → 커밋/푸시 76793cd (master). 우선순위 다음: Step 2(매출 실원가 기록 — Known Gaps, Step1 직후 우선 결정됨) → 이후 큐 순서.
Goal: processRefund 시 매출·부가세·재고원가 역분개 생성(현재 분개 완전 누락, 최우선 버그).
Rev2 수정:
- MF#1 멱등성: createSaleJournal이 분개 id 반환(실패 null) → 호출부가 이번 호출 id로 검증(과거 RETURN 분개 오판 제거). 타 호출부 6곳 반환값 미사용 무영향.
- MF#2 롤백: 역분개를 step7/8/9 이전(step6 직후 6.5)으로 이동 → 실패 시 재고·포인트·상태 미변경, return_orders 삭제만으로 완전 롤백.
- MF#4 균형: createSaleJournal RETURN 케이스 헤더에 COGS 포함(headerTotal=absTotal+cogs) → 라인합=헤더합. 정상매출 헤더 불변(Step3 범위). lines insert 실패 시 고아 헤더 삭제+null.
- SF#3: schema.ts 문구를 실제(헤더 균형+완전 롤백)와 일치 정정.
구현(Rev1 기준, Rev2에서 위치/검증방식 변경됨):
- createSaleJournal(accounting-actions.ts:478~492): COGS 분기를 isRefund/정상 양쪽으로 확장. 환불 시 재고자산(1130) 차변 / 매출원가(5110) 대변 = cogs(정상매출의 반대방향). 정상매출 분기 금액·동작 불변.
- processRefund(return-actions.ts): import createSaleJournal 추가. step9 상태전환 직후·알림톡 전(try 내부)에 역분개 호출 추가(9.5 블록). COGS=Σ(qty×products.cost) 단일 in() 조회 맵핑. totalAmount=-refundAmount, sourceType='RETURN'. createSaleJournal이 silent return 구조라 호출 후 journal_entries(source_id=원본, source_type='RETURN') 존재 1회 검증 → 없으면 throw → 기존 step10 catch가 returnOrder 삭제(전체 롤백).
- AI schema.ts: [반품] 섹션에 환불 역분개 규약 1줄 추가(source_type='RETURN', COGS=products.cost, 전액과세 가정, 실패시 롤백).
결정/가정:
- COGS=실원가(products.cost) 기준(브리프 locked).
- 과세분: 원본 과세금액 컬럼 부재 → taxableAmount 미전달(전액 과세 가정). 면세 정밀안분은 후속.
- createSaleJournal 시그니처/throw 동작 미변경(다른 호출부 영향 회피) — 검증은 호출부에서.

### Step 2 — 매출 시 실원가 COGS 기록 + POS 매출분개 신설  ← ✅ DEPLOYED (512a247)
Date: 2026-06-24
Status: ✅ COMPLETE — Richard clean(Must Fix 0) → 커밋/푸시 512a247 (master). 다음: Step3 GL 단일원천 재배선.
구현:
- POS(actions.ts processPosCheckout): import createSaleJournal. ⓪ products 조회+팬텀자재 조회에 cost 추가→costByProduct. ④ 차감 큐에서 실제 OUT(일반+팬텀분해자재)×cost를 posCogs 누적(1130 감소와 일치). ⑤-b best-effort 분개 호출(totalAmount=finalAmount net, cogs=posCogs, taxableAmount, sourceType='SALE'). 분개 실패해도 결제 성공.
- cafe24(webhook.ts handleOrderPaid): 매핑된(product_id 있는) 품목만 Σ(qty×products.cost)→cogs, 미매핑 0. cogs:0→cogs 교체.
- AI schema.ts [회계]: POS 분개 신설+표준매출 COGS+cafe24 매핑분만+집계는 운영테이블 유지 명시.
cafe24 매핑 결론: 매핑 인프라(cafe24_product_map→sales_order_items.product_id) 실재 → 부분 COGS 인식(매핑분만, 미매핑 0). "현행 cogs:0 유지" 아님. 상세 REVIEW-REQUEST 참조.
결정/가정: POS COGS=재고 OUT 실차감분 기준(팬텀=분해자재 cost). track_inventory=false 미차감품=COGS 0. createSaleJournal 헬퍼 무수정.

### Step 3 — 손익(P&L)을 GL 단일원천으로 재배선 (1차: 전사 + 병행검증)  ← ✅ DEPLOYED (77957d4)
Date: 2026-06-25
Status: ✅ COMPLETE — Richard Must Fix 3건(①페이지네이션 부재 ②③안정정렬 부재) 순차 해결 → clean → 커밋/푸시 77957d4 (master). PO 결정: 컷오프=병행표시(diff)로 판단, 지점별=전사 충분(Step3b 후순위). ⚠️배포후 diff 배너 라이브 확인 권장.
Rev2 수정:
- MF: GL 라인 스캔 1000행 무음절단 → .range() 페이지네이션 루프. account_id in (4110,5110)로 행수 축소. 커서 전진=실제 rows.length, 종료=빈 페이지만 → 서버 max-rows(1000 or 그 이하)에 무관하게 누락 0. page 에러 시 throw(부분합 미게시). DB측 RPC집계는 마이그 동반이라 본 스텝(코드 전용) 블로킹 회피 위해 미선택.
- Arch 보고: getVatReport·getGlBalances도 동일 무페이지네이션 잠재버그(범위 밖, 별도 스텝 권고).
구현(Rev1):
- accounting-actions.ts: 기존 운영집계를 computeOperatingProfitLoss 헬퍼로 추출. getProfitLoss = branchId 있으면 운영경로(source:'OPERATING_BY_BRANCH', 숫자불변) / 없으면 GL 경로(4110 Σ대−차=매출, 5110 Σ차−대=원가, grossProfit=차감). 환불역분개 자동반영(이중차감 방지). totalPurchases는 운영값 유지. 반환 기존 키 전부 보존(GL미지원 분해/건수는 0) + source:'GL' + verify{operating,gl,diff}.
- accounting/page.tsx: 손익카드 헤더 source 배지(GL기반/지점별 운영테이블) + verify.diff≠0 시 amber 차이 배너.
- schema.ts [회계]: getProfitLoss 전사=GL 진실원천, 지점별=운영, verify 병행, productMargins/monthlyTrend 운영유지, 과거기간 과소 명시.
diff 검증 결론(예상): Step1/2 이후 신규기간 GL≈운영(미세 diff), 과거기간 GL 과소(diff 큼)→배너로 가시화, PO가 컷오프 판단(하드코딩 안 함).
소비처 확인: getProfitLoss는 accounting/page.tsx 1곳만(reports는 별도 salesData). 키 보존으로 렌더 불변.
헬퍼/시그니처: getProfitLoss 입력 시그니처 불변. createSaleJournal·getVatReport·getGlBalances·getMonthlyTrend·getProductMargins 미수정.

### Step 3.5 — getVatReport/getGlBalances 페이지네이션 버그  ← ✅ REVIEW CLEAN (APPROVED) → Deploy
Date: 2026-06-26
Status: ✅ COMPLETE — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시(아래 push 후 해시 기입). build ✓. 마이그/schema 무변경(read-only 집계).
구현(accounting-actions.ts 단일):
- getVatReport: 2151/1150 `.in()` 필터 + .range() 페이지네이션 루프(.order('id') 안정정렬, 빈 페이지 종료, from += rows.length). 원본 두 독립 if→if/else if(account_id 상호배타라 동작 동일). 집계 산식·반환 불변.
- getGlBalances: 전 계정 집계라 account 필터 불가 → 기간 내 전 라인 페이지네이션 누적. balances Map·정상잔액 부호·result 필터 불변.
- 부수 개선: 원본 `const {data}` 에러 무시(무음 과소집계 은폐) → pageErr throw(은폐 방지, getProfitLoss 동형).
효과: 분개 라인 1000건 초과 기간에서 부가세·계정잔액 과소집계 해소. getProfitLoss(Step3 77957d4)와 동일 패턴.

### Step 4 (큐) — DB 무결성
journal_entries total_debit=total_credit CHECK 제약 + accounting_period_closes 마감기간 분개차단 트리거. 마이그 Arch 직접.

### Step 5 (큐) — 총계정원장 정상잔액 부호 버그 + 시산표 탭
자산·비용=차변/부채·자본·수익=대변 부호 구분(getLedger/getGlBalances). 시산표 탭 신설(전계정 차변합/대변합 + 일치검증).

## Known Gaps (Phase 0)
- 정상 매출(create_sale/cafe24/cancel)이 cogs=0 기록 → 환불 실원가 역분개와 1130/5110 비대칭. **후속 스텝: 매출 시 실원가 기록** (Step1에서 노출됨, Step1 범위 아님).
- 면세 정밀 안분 미구현 — 환불 분개 전액 과세 가정.
- 과거 매출 분개 백필 미실행 — Step2는 신규거래부터. 별도 1회성 스크립트 스텝 필요.
- sales-cancel COGS 역분개 미보강 — 취소 시 재고 복원하나 COGS 환원 없음(환불 Step1과 동일 갭, 별도 후속).
- cafe24 매핑 불가 품목 cogs (Step2 Flag 결과에 따라).
- journal_entries.branch_id 부재 → 지점별 GL 손익 불가. Step3b: 마이그 branch_id 추가 + 전 매출분개 writer 지점기록 + getMonthlyTrend GL화.
- getProductMargins GL 재배선 영구 불가(라인 product_id 없음) — 운영테이블 유지 확정.
- 과거 분개 백필(Step1/2 이전 POS·COGS·환불) 미실행 → 과거기간 GL손익 과소. 별도 1회성 스크립트 스텝.
- GL 컷오프 날짜 정책 = Project Owner 결정 대기(에스컬레이션됨).

## 판매일보 Phase 2a — 승인→재고·매출 연동 + 승인취소 (🔴 실재고+회계)
Date: 2026-06-26
Status: ✅ REVIEW CLEAN (APPROVED, Must Fix 0) — Deploy Gate 대기. build ✓. 마이그103 적용 완료, schema.ts 동기화 포함.
리뷰 경과: Richard 1차 APPROVED WITH CONDITIONS(Condition 1=동시성 멱등 차단) → Bob Rev2(슬롯 선점 approve/unpost 대칭) → Richard 재리뷰 CLEAN. Arch 추가 하드닝(Should Fix=예외 경로 이중차감):
- 슬롯 선점(MF#1 해소): approve=computeStockDeltas(계산만) 후 분개·재고 **이전에** `update({posted:true}).eq('posted',false).eq('status','SUBMITTED')` 조건부 점유, 영향행 0→부작용 0으로 중단. unpost 대칭(posted true→false). 동시/더블서밋 패배자 깨끗(승자 movements/inventories 무손상).
- 예외 경로 safe-limbo 통일: approve 재고적용 catch 에서 releaseSlot 제거 → posted=true 유지(분개만 롤백). 예외=크래시 동일 limbo(재승인 posted=true 차단·승인취소 status≠APPROVED 차단)로 재시도 이중차감 0, 운영 수동개입 복구. 분개 실패(부작용 0) 경로는 releaseSlot 유지(안전 재시도).
파일: daily-report-actions.ts(approve/unpost/computeStockDeltas/applyMovement + E3 잠금), page.tsx(승인 UI·잠금·모달·현황 승인반영), ai/schema.ts.
PO 확정(LOCKED): E1 차변 미수금 1115(백화점 월정산), E2 승인취소 포함, E3 승인후 수정잠금, 시음/파손 재고만(분개 없음).
approve: ①매출분개 먼저(createSaleJournal credit→1115, COGS=Σ onsite_sold×cost 팬텀BOM분해, sample_damage 제외) 실패/대차불일치→전체 throw(재고 미적용, best-effort 아님) ②재고 OUT(onsite_sold+sample_damage)/IN(in_return) movements(ref_type='DAILY_REPORT' ref_id=report_id, 음수허용 NUMERIC) ③헤더 posted 조건부 update(where posted=false 동시성멱등, 영향행0→분개·movements 정리). SUBMITTED→APPROVED만.
unpost: ①역분개 먼저(음수 totalAmount+reversalOf, sourceType='DAILY_REPORT_CANCEL') ②원본 DAILY_REPORT movements 반대로 신규 insert(DAILY_REPORT_CANCEL, 원본 보존) ③posted=false·status=SUBMITTED. 멱등(posted!==APPROVED 차단 + CANCEL movements 존재 차단).
E3: saveDailyReport 가 APPROVED/posted 면 throw.
UI: fieldset disabled 잠금(매장/날짜 밖), 승인/취소 확인모달, footer 분기, 현황 StatusBadge 승인완료(blue)+summary.approved. 비관리자 approve/unpost 미노출.
무회귀: 기존 액션·Phase1/1.1/1.2·POS createSaleJournal/processPosCheckout 무수정(재사용만).
Known Gaps(수용): 시음/파손 비용분개 없음(GL 1130 갭)·면세 전액과세·1115 실입금 회수 후속·RPC 트랜잭션 미사용(분개검증 선행+조건부update로 최소화)·sales_orders 행 미생성.

## (배포완료) 판매일보 Phase 1.2 — 본사 제출 현황 (읽기 전용)
Date: 2026-06-26
Status: ✅ DEPLOYED (14bf0d9) — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시. 읽기 전용, 마이그/schema 무변경. listDailyReports(MANAGER_ROLES 차단)+관리자 [제출현황] 탭(미제출 강조·행클릭 상세). 제출대상=활성+DEPT_STORE(getTargetBranches 헬퍼). 무회귀.
파일: daily-report-actions.ts(신규 액션 2개 추가만), app/(dashboard)/daily-report/page.tsx(관리자 탭+현황뷰).
구현:
- getTargetBranches 헬퍼(분모=활성+channel='DEPT_STORE', PO 결정 A. B/C 전환 1곳). listDailyReports(date): MANAGER_ROLES 차단 + 대상매장 좌측기준 헤더 머지(없으면 MISSING) + summary, 정렬 MISSING→DRAFT→SUBMITTED. 헤더 SELECT만(읽기전용).
- page.tsx: 관리자 탭 [일보 입력]/[제출 현황](비관리자 미노출). 입력본문 {(!isManager||mgrTab==='input')} 게이트. 현황뷰=날짜+요약4스탯(미제출 red ring)+모바일카드/데스크탑표(매장·작성자·상태배지·당일매출·제출시각). 행클릭 openDetail→input 탭+branch 세팅→기존 getDailyReport 그리드. StatusBadge/SummaryStat 컴포넌트.
RBAC: listDailyReports requireSession+MANAGER_ROLES, UI 탭 {isManager} 게이트+loadStatus isManager 가드. 비관리자 콤보 입력만.
무회귀: actions diff 제거라인 0(추가만), Phase1/1.1 입력·저장·RBAC·이월 무변경(input 탭 게이트로 감쌈). 마이그/schema 무변경.
Known Gaps: 기간집계/CSV/인쇄·미제출 독촉·매출총합 대시보드·제출대상 B/C 전환.

## (배포완료) 판매일보 Phase 1.1 — 역할별 입력 UX (콤보/전체보기)
Date: 2026-06-26
Status: ✅ DEPLOYED (20115a6) — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시. 단일 파일 page.tsx만(액션/마이그/schema 무변경). 판매사원=검색콤보(editedIdx, 미편집 전량 이월저장)+[전체보기]토글, 관리자=전품목 그리드. 저장/RBAC 무변경.
파일: `src/app/(dashboard)/daily-report/page.tsx`.
구현:
- 상태 추가: comboSearch·editedIdx(Set)·showAll.
- 역할분기 showFullGrid=isManager||showAll. 관리자/전체보기=전 품목 그리드(fullGrid). 비관리자 기본=콤보(검색→후보→editedIdx 추가→편집중 카드).
- renderCard 추출(관리자/전체보기/콤보 공용). 콤보 후보=메모리 lines 검색필터(미편집만, 상위30, 추가 DB조회 0). addToEdited/removeFromEdited(라인은 lines 유지=이월저장).
- load(): 기존 일보의 움직인 라인 editedIdx 자동 노출. removeLine/addLine reindex(manualClosing+editedIdx 동기).
- [전체 보기] 토글(비관리자), [취급외 품목 직접 추가] 유지.
저장/RBAC 무변경: daily-report-actions.ts diff 0(git). save 항상 전 품목 lines 전달(L178) → 미선택 품목 이월값 백그라운드 저장. 당일매출=전 품목. 매장 드롭다운 {isManager} 게이트 유지.
Known Gaps: Phase2(재고/매출/회계)·콤보 서버검색·관리자 export.

## (배포완료) 판매일보 Phase 1 — 모바일 입력 (기록 전용)
Date: 2026-06-26
Status: ✅ DEPLOYED (a9a0980) — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시(코드+마이그101+102). 마이그101(테이블)+102(screen_permissions 시드, /daily-report 5역할) 라이브 적용·검증 완료(BRANCH_STAFF 등 view+edit·EXECUTIVE view). 시드 누락 진입로 이슈는 마이그102로 해소(코디네이터가 직접 작성·적용 — Arch 서브에이전트가 relay 승인 거부해 교착). 기록 전용(운영·회계 write 0).
파일: daily-report-actions.ts(신규 액션), app/(dashboard)/daily-report/page.tsx(신규 모바일 UI), layout.tsx(nav), ai/schema.ts(동기화).
액션: getDailyReport(조회)·getReportTemplate(취급완제품 prefill+전일마감 이월)·saveDailyReport(헤더 upsert+라인 delete/insert, daily_total 서버재계산, 비관리자 branch 세션강제)·getDailyReportBranches(관리자 드롭다운).
마감계산: closing = opening + in_return − onsite_sold − sample_damage. 클라 실시간 자동, [직접수정] 토글 시 직접입력+차이배지, closing_stock 최종값 저장(서버 강제계산 안 함=사원수정 존중). daily_total=Σ(onsite_revenue+parcel_revenue) 서버재계산.
이월: getReportTemplate 이 직전 일보(report_date< · 같은 branch) closing_stock→opening prefill, 없으면 0.
RBAC: requireSession + resolveBranchId(관리자=요청branch, 비관리자=세션branch 강제). UI 관리자만 매장 드롭다운.
무write: inventories는 read만(템플릿 품목소스), 쓰기는 daily_sales_reports/_lines 한정(grep 확인).
🔴 에스컬레이션(Arch·DB): screen_permissions 시드 누락 — nav가 screen_permissions로 필터돼 `/daily-report` 행 없으면 모든 역할 미노출. Arch가 089 패턴 INSERT 마이그 필요(BRANCH_STAFF/PHARMACY_STAFF/SUPER_ADMIN/HQ_OPERATOR can_view+edit, EXECUTIVE can_view). 적용돼야 탭 보임(코드는 권한만 들어오면 동작).
Known Gaps: 재고차감/매출분개/포인트(Phase2)·실재고 대사·마감잠금/승인·월간집계·hq_parcel 수량vs금액·과거 백필.

## (배포완료) #62 Phase2 — 송장→카페24 자동 역연동 (write_order)
Date: 2026-06-25
Status: ✅ DEPLOYED (1164ad1) — Richard 보안리뷰 clean(Must Fix 0, APPROVED) → 커밋/푸시. best-effort·멱등·실패격리. 마이그 없음(cafe24_sync_logs 재사용·shipments 컬럼 무추가). schema.ts 동기화 포함. 🔴운영전제: 개발자센터 mall.write_order+재인증, CAFE24_CJ_CARRIER_CODE env, shipment_status='shipping' 라이브 검증. 미충족이어도 best-effort라 우리흐름 정상(실패만 sync_logs).
파일: auth/route.ts(scope), cafe24/client.ts(write 메서드+setAccessToken), shipping-actions.ts(writeback 헬퍼+훅+실패조회), shipping/page.tsx(실패배너), ai/schema.ts(동기화).
훅: updateShipment 알림톡 블록 직후, `(becameShipped||gotTracking) && prev.cafe24_order_id && newTracking` → writebackTrackingToCafe24(best-effort). 송장저장·receipt-sync·알림톡·revalidate 이후 위치라 결과 무관 완료.
멱등: cafe24_sync_logs(sync_type='shipment_writeback', cafe24_order_id, status='success') 존재 시 skip + dup 에러(already/duplicate/exist/409)=success 취급. shipments 컬럼 무추가(sync_logs success 단일진실원).
실패격리: 헬퍼 전체 try/catch + createShipment success:false(throw 없음) + 호출부 추가 try/catch(이중). 모든 실패 cafe24_sync_logs(failed, error_message) 기록.
scope/env 게이트: auth scope에 mall.write_order. CAFE24_CJ_CARRIER_CODE(카페24 carriers 고유값, SweetTracker t_code 무관) 미설정→skip+failed(조용한 누락 금지). 토큰 없음/만료·env 미설정→failed+skip. write_order 재인증 전→createShipment 401→failed.
order_no: prev.cafe24_order_id(raw) = API {order_no}. C24-{mall}-{no}(분개 ref) 안 씀.
실패 UI: getShipmentWritebackFailures(본사 RBAC) + shipping/page.tsx amber 배너(실패건만, 주문번호+사유+시각+안내).
운영전제(코드외): 개발자센터 write_order + /api/cafe24/auth 재인증 + CAFE24_CJ_CARRIER_CODE env. 미충족이어도 best-effort라 우리 흐름 정상.
에스컬레이션: ①운영 재인증 필수 ②carriers에서 CJ코드 확인→env 주입 ③shipment_status='shipping' 정확값·createShipment body 구조는 라이브 토큰 부재로 미검증→재인증 후 응답 확정, 미전환 시 updateOrderStatus PUT 보강(메서드 추가됨).
Known Gaps: delivered/구매확정 역전송·다택배사·과거 소급·자동 재시도 배치(현재 수동 재저장).

## (배포완료) 레거시 조회 — 런타임 416/페치루프 수정 + 콤마-AND 검색 (Rev3)
Date: 2026-06-25
Status: ✅ DEPLOYED (4daa35b) — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시(SalesListTab+schema.ts+마이그100). 마이그100 라이브 적용·검증 완료(빈검색 47,268·단일 24·2토큰 AND·리터럴% 0). 비차단: 백슬래시 리터럴 이스케이프 양측 동일한계(실데이터 영향0).
파일: `src/app/(dashboard)/pos/SalesListTab.tsx`.
근본원인: ①검색 input 이 쿼리 deps(legacySearch)에 직접 바인딩 → 타이핑마다 재페치(루프) ②검색 결과 줄었는데 legacyPage 미리셋 → from=page*50 > 총건수 → PostgREST 416.
수정:
- 입력/적용 분리: legacySearchInput(타이핑·무페치) ↔ legacySearch(적용값·쿼리 deps). 적용=Enter/[검색]/[조회]에서 setLegacySearch(input)+setLegacyPage(0)→effect 재페치(loadLegacy 직접호출 안 함=stale 회피). 탭 첫 진입 1회 자동조회 유지.
- page0 리셋: 검색적용·날짜input·프리셋·조회/검색 전부 setLegacyPage(0).
- 416 가드: from=Math.max(0,page*50). 에러가 416(PGRST103/'range not satisfiable')+page>0 → setLegacyPage(0) 복구(재페치, 루프 아님). 그 외만 에러표시.
- 콤마-AND(customers/search:291 미러링): tokens=split(',')·trim·filter, 토큰별 .or() 체이닝(토큰간 AND·토큰내 OR), esc /[%_(),]/g. RPC 는 p_search=콤마문자열 그대로(Arch RPC 내부 동일규칙·시그니처 불변). 목록·건수·합계 정합.
- 안내: placeholder + 하단 회색 힌트(Enter 검색·콤마 AND 예시).
무회귀: list/compare·RPC 합계 시그니처·RBAC·셀 표시(Rev2) 무손댐.
Known Gaps: 기존 유지(품목명 서버검색·담당자 코드→이름·CSV·지점직원 접근).

## (배포완료) 레거시 조회 — 그리드 셀 잘림 해소(Rev2 표시수정)
Date: 2026-06-25
Status: ✅ DEPLOYED (dc17754) — className만(로직무관) 정식리뷰 생략 → 커밋/푸시. PO 피드백(...만 보임) 후속(34a85fb 후), 레거시 셀 표시 스타일만.
파일: `src/app/(dashboard)/pos/SalesListTab.tsx` 레거시 렌더 블록.
수정: 품목(1718)·상담특이사항/note(1728)·받는분주소(1732) 3컬럼 `line-clamp-2 + max-w` → `whitespace-normal break-words min-w/max-w`로 줄바꿈 전체표시. title 툴팁 제거(불요). 짧은 컬럼 nowrap 유지. min-w-[1500px] 와이드+max-width 폭제한으로 레이아웃 보존.
무회귀: 셀 className만 — list/compare·정렬·페이징·RPC 합계·RBAC·행펼침 무손댐.
Known Gaps: 기존 유지(품목명 서버검색·담당자 코드→이름·CSV·지점직원 접근).

## (배포완료) 레거시 조회 — 판매현황 동형 개편 + 이카운트 15컬럼
Date: 2026-06-25
Status: ✅ DEPLOYED (34a85fb) — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시(코드+schema.ts+마이그099). 읽기전용·본사전용. RPC legacy_sales_summary 적용·검증 완료(전체기간 cnt 47,268/total 10,498,357,372 일치). 비차단: 검색어 ( ) , 포함시 합계/목록 이스케이프 미세차(정상검색 영향0).
파일: `src/app/(dashboard)/pos/SalesListTab.tsx` 단일.
개편: 카드형 아코디언 → 판매현황(list) 동형(전용 프리셋바·요약카드 2개·표 그리드). 컬럼은 PO 제시 이카운트 판매조회 동형으로 8→15 확장(coordinator 정정, legacy_orders 마이그070 실존 필드 재확인).
구현:
- 날짜 분리: legacyStart('2018-01-01')/legacyEnd(오늘)/legacyPeriod('all') 전용 state — list startDate/endDate 무손댐(무회귀 핵심). 공유 필터바 날짜 onChange의 setLegacyPage 부수효과 제거 + 공유 필터바를 subView!=='legacy' 게이트.
- select 추가(541): received_at, staff_code, phone, note, customer:customers(name). 인터페이스(280) 동기.
- RPC 합계: loadLegacy 내 legacy_sales_summary(p_start/p_end/p_search, 목록과 동일 필터) 1회 → cnt=legacyTotal(건수카드·페이지네이션), total=legacySum(합계카드). 실패 0/0+warn.
- 15컬럼: 일자·수령일자·매출처·출고처·결제·이름(customer.name 폴백 phone)·번호(phone)·품목(대표+외N)·수량·합계·받는분·상담특이사항(note truncate)·받는분연락처·받는분주소(truncate)·담당자(staff_code). 제외: 수령현황·고객주소·승인·상태·상담머신(데이터 부재). 와이드 min-w-[1500px] 가로스크롤. 행 펼침(품목/옵션/코드/출고지점) 유지.
- Fragment import 추가(tr 2행 묶음).
무회귀: list/compare는 공유 필터바 그대로(subView!=='legacy'), RBAC 가드(!isBranchUser effect/렌더 + 메인탭 !isBranchLocked) 유지.
Known Gaps: 품목명 서버검색(임베드)·담당자 코드→이름 매핑·레거시 CSV·지점직원 접근(본사전용).

## (배포완료) 레거시 판매현황 조회 서브뷰 v1 (이카운트 대체 — 카드형)
Date: 2026-06-25
Status: ✅ DEPLOYED (ff4fd5a + 진입로 핫픽스 3f6c902) — Richard clean(APPROVED). 진입로 버그: SalesListTab이 forcedView 마운트라 내부 서브뷰 토글(레거시)이 항상 숨겨져 본사 포함 안 보임 → pos/page.tsx 메인탭에 "레거시 조회" 탭 추가(!isBranchLocked, sales 패턴). 교훈: 새 뷰는 메인탭으로 노출(내부 토글은 forcedView 구조상 죽은 코드).
Rev3 핫픽스(pos/page.tsx): SalesListTab을 forcedView로 마운트 → 내부 서브뷰 토글(`!forcedView`)이 항상 숨겨져 레거시 진입로 없음 → 화면 미표시. 수정: MainTab 타입(27)·MAIN_TAB_KEYS(29)에 'legacy' 추가, 탭버튼 배열(1660)에 isBranchLocked? [] : [...,{key:'legacy',label:'레거시 조회'}], 렌더(1817) `{mainTab==='legacy' && !isBranchLocked && <SalesListTab forcedView="legacy" />}`(sales 패턴 동일). SalesListTab 자체 무수정(forcedView='legacy' 이미 동작). 게이트=isBranchLocked(sales 동일 HQ-only). 기존 탭 무회귀.
Rev2(ff4fd5a 배포분): Richard Must Fix 2건(RBAC/PII 우회+페이징 리셋) 수정 → clean(APPROVED). RBAC 삼중가드(레거시+compare 동시 폐쇄). 읽기전용·legacy_orders 직접·서버 페이징. 마이그 없음. Known Gap: 레거시 매출집계·품목명검색·legacy_orders RLS allow-all(클라가드 의존, 서버 RBAC 강화 후속).
파일: `src/app/(dashboard)/pos/SalesListTab.tsx` 단일.
목적: 이카운트 미사용 상태에서 과거 판매·고객 내역(legacy_orders 47k건)을 판매현황에서 이카운트처럼 즉시 조회(검색+기간+품목펼침).
구현:
- subView 타입 'list'|'compare'|'legacy' 확장(169/198/251). 토글 배열에 ['legacy','레거시'] 추가(983).
- 레거시 상태(270~289): LEGACY_PAGE_SIZE=50, LegacyOrderRow/Item 인터페이스, legacyRows/Page/Total/Loading/Error/Search/expandedLegacy.
- loadLegacy(521~565): legacy_orders 직접 select(임베드 legacy_order_items)+count:'exact', .gte/.lte(startDate/endDate)+검색(.or recipient_name/recipient_phone/phone ilike)+order ordered_at DESC,legacy_order_no DESC+.range(page*50,+49). 에러 격리. useEffect(subView==='legacy'), toggleLegacy, legacyTotalPages.
- 조회 버튼 분기(1027): legacy→page0 리셋 후 loadLegacy.
- 렌더 블록(compare 직후): 검색 input/버튼/총건수/기간 + 행 펼침(품목/옵션/수량/금액, 출고지점) + 페이지네이션(이전/다음 N/total). 고객상세 customers/[id] 렌더 차용.
페이징: 서버 .range + count:'exact'(47k·1000캡 대응). 검색: 헤더 필드(받는분/전화) only(.or, legacy_orders 070행 phone·recipient_phone 둘 다 확인). RBAC: !isBranchUser 부모 게이트(compare 동일) → 지점직원 미노출.
Known Gaps(범위 밖):
- legacy 매출 집계/요약 카드 — 후속(branch_sales_summary 통합집계 활용).
- 품목명(item_text) 서버 검색 — 임베드라 .or 불가, 헤더 필드만 1차(후속 RPC/클라필터).
- legacy 행 편집/삭제 — 읽기전용 고정.
- 지점직원 레거시 접근 — branch 매핑 부분적이라 본사 전용 유지.

## #61 — 카페24 주문옵션 매핑 기준 수정 (옵션 원문 누수 차단)
Date: 2026-06-25
Status: ✅ DEPLOYED (12c192f) — Richard clean(Must Fix 0, APPROVED, 매핑키 무손상 확인) → 커밋/푸시. 마이그 없음(저장 값만 변경), forward-only.
PO 결정(LOCKED): (b) 매핑품목만 옵션 제거·미매핑 유지 + forward-only + 마이그 없음.
파일: cafe24/webhook.ts(핵심 1줄), ai/schema.ts(74/82/215 동기화). CJ export(shipping/page.tsx:486)는 무변경(확인만).
구현:
- webhook.ts:357 syncCafe24OrderItems: `order_option: extractItemOptions(i)||null` → `pid ? null : (extractItemOptions(i)||null)`. 매핑여부=pid 존재(347행 productMap.get 결과). 매핑→확정 product.name만·옵션 NULL, 미매핑→원본명+옵션 유지. extractItemOptions=표시용(매핑 키 normalizeOptionValue와 별개, 미합침). 366행 폴백 분기 무손상.
- CJ export 자동 미병기 확인: opt=s.order_options(shipping-actions.ts:73-82 합성=item.order_option 비어있지 않은 값 dedup, 전부 비면 NULL) → 매핑 cafe24=NULL→export ' / 옵션' 미병기. 혼합=미매핑 옵션만, 직접입력=유지. items_summary는 별도(route.ts:379 name x qty)라 품목명·수량 정상.
- POS 직접입력(actions.ts:2819) webhook 미경유 → 무영향(게이트 불요).
- schema.ts 74/82/215 동기화: cafe24 매핑성공 order_option NULL(옵션=매핑조건), 미매핑/직접입력만 유지.
Known Gaps(범위 밖):
- 과거 ONLINE 전표 order_option 옵션 잔존 — forward-only(백필 안 함).
- 미매핑 cafe24 품목 옵션 유지 — 의도(점진 매핑 유도).
- 스마트스토어 임포트 옵션 처리 — 범위 밖(cafe24만).

## #59 — 온라인몰 주문 수집 시 미등록 고객 자동 등록 (PII 정책 확장)
Date: 2026-06-25
Status: ✅ DEPLOYED (55cc76d) — Richard 보안리뷰 clean(Must Fix 0, APPROVED) → 커밋/푸시. PO 승인(A) 자동생성. 마이그 없음(metadata JSONB), 기존 고객 name/source 비파괴. Known Gap: flagNeedsReview metadata read-then-write 비원자적(저빈도, 향후 jsonb_set 권장).
🔴 정책 기록: **자사몰 결제완료 주문자 자동 고객생성 정책 = 2026-06-25 Project Owner 승인(A)**. 현행 "수동 등록만" → "결제완료 수집 시 자동 dedup 생성·연결"로 확장. 동의 없는 PII 자동생성이나 2026-06-08 수동 registerCafe24Customers 와 같은 궤도(신규 위반 아님). schema.ts BUSINESS_RULES 동기화 완료(304-312행).
파일: cafe24/webhook.ts(헬퍼 신설+paid 경로), smartstore/actions.ts(미매칭 자동생성), ai/schema.ts(정책 동기화).
자동생성 트리거: ①카페24 webhook handleOrderPaid(결제완료, 백필도 paid 단계서 1회) ②스마트스토어 commit 미매칭 주문자. 미결제(handleOrderCreated)는 생성 OFF 유지(linkOrCreateCustomer allowCreate:false).
구현:
- autoRegisterOnlineCustomer(webhook.ts 162~260) 공용 헬퍼: anon 클라이언트, 반환 linked|created|needs_review. 전화(UNIQUE)로 먼저 조회→미존재 upsert(onConflict:'phone', ignoreDuplicates)→재조회(동시성 중복 0, 멱등). 빈 주소/이메일/member_id만 비파괴 보강.
- needs_review(LOCKED): ①전화없음/자릿수 비정상/이름없음→생성·연결 안 함 ②전화매칭+이름불일치→연결+metadata.needs_review=true·review_reason='phone_match_name_mismatch'(name 미수정) ③정상전화+무매칭→created. metadata 병합 비파괴.
- webhook paid: linkOrCreateCustomer(false)→autoRegisterOnlineCustomer(CAFE24), .is(customer_id null) 미연결 전표만 연결, try/catch 매출 무회귀.
- smartstore: 미매칭 시 헬퍼 자동생성 best-effort, custByPhone 캐시 갱신(임포트 내 멱등), insert customer_id=resolvedCustomerId.
- 수령자≠주문자: buyer_*/recipient_* 분리 기존 충족(확인만). customer_id 항상 buyer 기준.
멱등/실패격리: phone dedup 우선 + upsert DO NOTHING + 미연결전표만 연결 + 전 호출 try/catch.
Known Gaps(범위 밖):
- needs_review 검수 UI/큐 — 플래그 저장만, 화면 미구현.
- 과거 미연결 ONLINE 주문 소급 백필 — forward-only(자동 호출은 신규 수집부터).
- 동의/약관·법적 고지 UI.
- 온라인 주문 포인트 적립 자동화.

## #58 — 지점별 매출 일자 내림차순 (1줄)
Date: 2026-06-25
Status: ✅ DEPLOYED (7a734ee) — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시. 표시 레이어 단독, 마이그/schema.ts/RPC 무변경.
파일: `src/app/(dashboard)/pos/SalesListTab.tsx` 단일.
구현: line 533 compareMatrix(지점비교 서브뷰) 기간 행 정렬 `a.localeCompare(b)`→`b.localeCompare(a)` (최신 상단). period_date 가 day/month/year 모두 YYYY-MM-DD라 사전순=시간순 → 세 grain 동시 적용.
확인: line 533 이 compareMatrix 블록(periodSet/cell/colTotals/grandTotal) 내 정렬임을 컨텍스트로 확인. 합계/열 매핑 정렬 무관(회귀 없음). 다른 sort(목록 ordered_at DESC, perDay 918, 송장 byReceiptDesc) 무손댐.
Known Gaps: 없음.

## #56 — 레거시 주소 입력 분리 (택배 주소 수동편집)
Date: 2026-06-25
Status: ✅ DEPLOYED (8708d57) — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시. 순수 UI 변경(readOnly 해제 + onChange), 마이그/schema.ts/서버액션/송장 합산 무변경.
파일: `src/app/(dashboard)/pos/page.tsx` 단일.
구현(readOnly·onClick·bg-slate-50 cursor-pointer 제거 + onChange 바인딩):
- 받는분 우편번호(2854)·기본주소(2858) → setShipping recipient_zipcode/recipient_address. placeholder "주소 직접 입력 또는 [주소 검색] *".
- 보내는분 우편번호(2907)·기본주소(2911) → setShipping sender_zipcode/sender_address.
- 인라인 고객모달 기본주소(3499) → setAddress1. (모달엔 우편번호 input 없음, base/detail 2칸.)
유지(무변경): 상세주소 칸 3곳 분리 유지 / "주소 검색" 버튼 3곳 openPostcode 그대로(보조수단) / Daum oncomplete 431-432 detail='' 리셋=의도적 교체로 유지(확인만) / 복사(applyCopy 660·applyLegacyCopy 756)는 prefill만·openPostcode 미호출(자동검색 안 뜸, grep 확인) / 송장 합산 shipping/page.tsx:489 무변경.
목표 충족: 레거시 복사 시 raw 주소가 기본주소 칸에 prefill → 그 자리에서 수기 수정 가능(편집가능 기본주소 칸이 곧 원문 보관처).
Known Gaps(범위 밖):
- 레거시 주소 원문 전용 DB 컬럼 — 추가 안 함(기본주소 칸 편집가능화로 대체, 송장/저장 경로 무침습).
- shipping/page.tsx export·편집 모달 — 무변경.

## #55 Step 1 — 발송 진행상태를 판매현황에 표면화 (읽기전용 보조배지)
Date: 2026-06-25
Status: ✅ DEPLOYED (97e33b2) — Richard clean(Must Fix 0, APPROVED, #57 회귀 없음 확인) → 커밋/푸시. PO 결정=(A) 표시만. 순수 읽기/표시 변경, DB/마이그/schema.ts/서버액션/receipt enum 무변경(091 존중). 후속 후보: 판매현황 직접 발송처리(B)=Step2, CSV 반영.
PO 결정(확정): (A) 판매현황엔 발송단계 표시만. 발송처리 버튼 추가 금지(Step 2 후보). 처리는 택배관리에서만.
파일: `src/app/(dashboard)/pos/SalesListTab.tsx` 단일.
발송단계 출처: `o.shipments[0].status`(전표당 1 shipment). 조회 쿼리는 이미 status select 중(full 370 + fallback 376 양쪽) → 쿼리 무변경. 파생 표시만.
구현:
- `SHIP_STAGE_LABEL` 맵 신설(114~122): PRINTED '출력완료' / SHIPPED '발송완료'. shipping/page.tsx STATUS_LABEL 동일 문구(중복정의+출처주석). DELIVERED 는 receipt 가 RECEIVED 종결이라 중복 회피 위해 제외(보조배지 생략).
- 수령현황 열(764~772): 기존 receipt_status 배지 유지. firstShip.status 가 PRINTED/SHIPPED 일 때만 중립 슬레이트 보조배지("🚚 출력완료"/"🚚 발송완료") 추가. PENDING·shipment 없음·방문/퀵·DELIVERED 미표시.
#57 회귀방지: shipment.status 로 수령상태 덮어쓰기 안 함. 두 축 별도 배지. displayStatusLabel/Badge 부활 없음.
결정/가정: DELIVERED 보조배지 생략(receipt RECEIVED 와 중복) — 브리프가 Bob 판단 허용, SHIPPED/PRINTED 만 필수.
Known Gaps(범위 밖):
- 판매현황 발송단계 *변경*(쓰기 양방향) — Step 2 후보, 이번 읽기만.
- CSV 발송단계 열 추가 — 스코프 최소화로 제외.
- 다중 shipment(전표당 2건+) — firstShip만.
- 택배관리→판매현황 실시간 푸시 — 새로고침 반영으로 충분.

## #60 — 택배관리 목록 정렬 내림차순 통일 (단일 슬라이스)
Date: 2026-06-25
Status: ✅ DEPLOYED (9cf14e8) — Richard clean(Must Fix 0, APPROVED) → 커밋/푸시. 정렬 레이어 전용, DB/마이그/schema.ts 무변경.
파일: `src/app/(dashboard)/shipping/page.tsx` 단일.
구현:
- 기본 정렬을 "수령예정일 임박순(오름차순)"→"수령일/택배예정일 내림차순(최신 우선)". 모든 상태 탭(대기중/출력완료/발송완료/전체)은 단일 .sort() 공유라 한 곳 수정으로 전 탭 적용.
- 1차 키 `sale_receipt_date` 내림차순(비교 부호 `ra<rb?-1:1`→`ra<rb?1:-1`), null 행은 맨 뒤 유지(미정 건이 위로 안 튐). 2차 `created_at` 내림차순 현행 유지.
- `shipSort` 값 `receipt_asc`→`receipt_desc` rename, 다섯 동기화 지점(타입 240 / useState 초기값 240 / sort 분기 960 / onChange 캐스팅 1515 자동 / option value+라벨 1519) 일치. 드롭다운 라벨 "수령예정일 임박순"→"수령일/택배예정일 최신순". latest/oldest 옵션 존치.
결정/가정:
- `byReceiptDesc`(578행, 송장 import 매칭용)는 무관 — 손대지 않음(브리프 명시).
Known Gaps: 없음(범위 내 완결).

## #57 — 수령상태 단순화 + 택배 아이콘 출고처 열 통일 (단일 슬라이스)
Date: 2026-06-25
Status: ✅ DEPLOYED (101c6ee) — Richard Condition 1건(그룹헤더 라벨 수령→수령완료) 수정 후 충족 → 커밋/푸시. 표시 레이어 전용, DB/마이그/schema.ts 무변경.
파일: `src/app/(dashboard)/pos/SalesListTab.tsx` 단일.
구현:
- 수령현황 열 = 수령상태만. 행 배지·CSV가 shipment.status(발송완료/배송완료/출력완료/대기중)로 덮어쓰던 것 제거. `RECEIPT_STATUS_BADGE[receiptKey]` + `receiptStatusLabelFor(o.receipt_status)`로 교체(4라벨: 방문예정/퀵예정/택배예정/수령완료).
- `RECEIPT_STATUS_LABEL` RECEIVED 라벨 `'수령'`→`'수령완료'` 통일(상세 드로어와 일관).
- 데드코드 제거: `SHIPMENT_STATUS_LABEL`·`SHIPMENT_STATUS_BADGE`·`displayStatusLabel`·`displayStatusBadge`(이 파일 외 미사용 확인 후 제거). `receiptStatusLabelFor` 미사용 2번째 인자(`_hasShipment`) 제거.
- 택배(📦)/퀵(🛵) 아이콘을 받는분 열 → 출고처 열로 이동(단일 위치). recvIcon 도출 로직(QUICK/PARCEL/PARCEL_PLANNED/ONLINE) 불변 → 직접입력 택배+자사몰 동일 표시. 받는분 열은 이름/연락처/주소만.
결정/가정:
- recvIcon 도출 기준 재사용(브리프 지정) — shipment.delivery_type · receipt_status · channel='ONLINE'. 신규 회귀 없음.
- 방문/현장(아이콘 null)은 출고처 '동일'/'-' 표시 기존 유지.
Known Gaps(이번 슬라이스 범위 밖):
- 수령 전 전표 수정 드로어(SalesDetailDrawer) 내부 상세 배지/라벨은 미수정(별도 영역). RECEIPT_STATUS_LABEL 라벨 통일분만 부수 반영.
- shipment.delivery_type 빈 직접입력이 RECEIVED 전이 후 아이콘 신호 소실(현 로직과 동일, 기존 동작).

## (이전) Step: AI 에이전트 엑셀 첨부 입력구 — 2026-06-20 REVIEWED ✓ APPROVED, 배포완료(추정). 상세는 git log 0ebd5cf 묶음.

---

## #57 — 수령상태 단순화 + 택배 아이콘 출고처 열 통일 (별도 단일 슬라이스)
Date: 2026-06-25
Status: 🔨 IN PROGRESS — Brief 작성 완료, Bob 대기.
Goal: 판매현황 수령현황 열 = 수령 처리 단계만(방문예정/퀵예정/택배예정/수령완료). 배송 진행상태(발송완료/배송완료/출력완료) 제거. 택배/퀵 아이콘은 출고처 열에 단일 표시(직접+cafe24 동일).
Locked 결정:
- **표시 레이어 전용** — 마이그·schema.ts·DB_SCHEMA 변경 없음. enum은 이미 마이그 091로 4값 단순화 적용 확인(라이브 DB: RECEIVED 251 / PARCEL_PLANNED 36 / PICKUP_PLANNED 7, PARCEL_SHIPPED 0건, CHECK 4값).
- 근본 원인: SalesListTab `displayStatusLabel`/`displayStatusBadge`가 shipment 존재 시 수령현황 열을 SHIPMENT_STATUS_LABEL(발송완료 등)로 덮어씀 → #57이 빼라는 배송상태가 노출됨.
- 아이콘 위치: 받는분 열 → **출고처 열**(Project Owner 명시). recvIcon 도출 로직(QUICK=🛵 / PARCEL·PARCEL_PLANNED·ONLINE=📦) 재사용.
- 범위: 목록 행 배지 + CSV export + RECEIPT_STATUS_LABEL 라벨 통일('수령'→'수령완료'). 단일 파일 SalesListTab.tsx.
Known Gaps:
- SalesDetailDrawer 내부 상세 배지는 이번 슬라이스 밖(부수 라벨 통일만).
- 직접입력 RECEIVED 전이 후 shipment delivery_type 비면 아이콘 신호 소실(기존 동일, 신규 회귀 아님).

---

## #55 — 택배 처리상태 ↔ 판매현황 수령상태 연동 (진단 2026-06-25)

### 진단 결과 (코드 검증)
- 상태 2축은 의도적 분리: **발송축=shipments.status**(PENDING/PRINTED/SHIPPED/DELIVERED, 택배관리 담당) / **수령축=sales_orders.receipt_status**(RECEIVED/PICKUP_PLANNED/QUICK_PLANNED/PARCEL_PLANNED, 마이그091에서 PARCEL_SHIPPED 삭제로 발송단계 배제 확정).
- receipt-sync.ts syncReceiptStatusFromShipment는 **DELIVERED일 때만** receipt=RECEIVED 전파. PRINTED/SHIPPED는 receipt 무영향. → PARCEL_SHIPPED 0건은 전파버그 아니라 그 단계가 receipt축에 없어서.
- 양방향 RECEIVED 종결은 이미 동작: 판매현황 bulkUpdateReceiptStatus↔택배관리 bulkUpdateShipmentStatus 둘 다 공용헬퍼 경유.
- **이중처리 현황**: 판매현황엔 발송단계 쓰기 버튼 없음(receipt 일괄=RECEIVED 종결만). 택배관리엔 별도 수령완료 없음(DELIVERED가 곧 RECEIVED 전파). 구조적 이중처리는 사실상 없음. 진짜 빠진 건 "발송 진행단계가 판매현황에 안 보임".

### Locked 결정
- 발송축 단일진실원천 = shipments.status (전표당 1 shipment). 판매현황은 파생 표시만.
- 수령축 단일진실원천 = sales_orders.receipt_status. 무변경.
- 새 receipt enum 값 추가 금지(091 존중). 마이그 불필요. schema.ts 무변경.

### Step 1 (브리프 작성, Bob 대기) — 발송단계 판매현황 표면화(읽기전용)
판매현황 수령현황 열에 firstShip.status(PRINTED/SHIPPED/DELIVERED) 보조배지 표시. 쓰기·CSV·다중shipment·실시간은 Out of Scope.

### Known Gaps (#55)
- 판매현황에서 발송단계 *변경*(쓰기 양방향) 미구현 — 표시만. 발송처리는 택배관리에서만.
- CSV에 발송단계 열 없음.
- 전표당 다중 shipment 미표시(firstShip만).
- 택배관리 변경의 판매현황 실시간 반영 없음(새로고침 필요).

### 🚩 에스컬레이션 (PO 결정 필요 — Step1 빌드와 병행 확인)
사용자 요청은 "송장출력/발송처리가 판매현황에 자동 반영 + 양방향 + 이중처리 제거". 이를 충족하는 두 해석:
  (A) 발송단계를 판매현황에 **표시만**(읽기) — 발송처리는 택배관리에서, 결과가 판매현황에 보임. ← Step1이 이것. 091 설계 존중, 위험 낮음.
  (B) 판매현황에서도 **발송처리 버튼**을 띄워(쓰기 양방향) 어느 화면에서든 발송 가능. ← 091 설계 확장, 두 화면 쓰기 동기화로 위험 상승.
Step1은 (A)로 진행(되돌릴 필요 없는 토대). (B)가 진짜 요구면 Step2로 추가. PO에게 "표시로 충분한가, 판매현황에서도 발송처리 버튼이 필요한가" 확인.

---

## #59 온라인몰 미등록 고객 자동 등록 (브리프 작성, PO 승인 대기 — 2026-06-25)

진단: PO 요구(자동등록·전화매칭 연결·확인필요 분리·수령자≠주문자·재연결) 5개 중 link/create/reconnect 비파괴 엔진은 `cafe24-actions.ts registerCafe24Customers`에 이미 존재. buyer/recipient 분리도 두 파이프라인 모두 충족. 슬라이스 본질 = 그 엔진을 수집 시점(카페24 webhook paid·스마트스토어 commit)에 자동 호출.

미존재: "확인 필요" 상태 큐 없음(customers status 컬럼 없음) → metadata JSONB로 플래그(마이그 불필요).

ESCALATION: 자동 "생성"은 개인정보 정책(현행 "수동만") 변경. PO 명시 승인 필요. 옵션 B(자동 연결만, 생성 OFF) 제시.

Known Gaps (예정):
- needs_review 검수 UI 미구현(플래그 저장만).
- 과거 미연결 ONLINE 주문 소급 백필 미실행(forward-only).
- 동의/약관 고지 UI 없음.
- 온라인 포인트 적립 미자동화.

Locked(승인 시): 마이그 금지(metadata 사용), 기존 customer name/source 비파괴, 미결제 게스트 생성 OFF, schema.ts 동기화 동일 커밋.

---

## #61 카페24 주문옵션 매핑 기준 수정 (브리프 확정, 빌드 트리거 대기 — 2026-06-25)

진단: 옵션 원문 누수 근원=webhook.ts:357 `order_option: extractItemOptions(i)` (cafe24 옵션을 POS 직접입력과 공유하는 order_option 필드에 저장). 하류(판매현황 배지·고객상세·배송 order_options 파생·CJ export:486)는 전부 이 컬럼 파생 → 357 한 곳 게이트로 자동 정상화.

PO 결정 LOCKED: (1b) 매핑 성공(pid 존재)→order_option=null, 미매핑→옵션 유지. (2) forward-only(과거 백필 X). (3) 마이그 없음.

슬라이스: ①webhook.ts:357 order_option = pid?null:extractItemOptions. ②export:486 코드변경 불필요(order_options 자동 비어 옵션 미병기)—확인만. ③schema.ts 74/82/215 동기화. POS 직접입력은 actions.ts:2819 경로라 webhook 미접촉=무영향(별도 게이트 불필요).

Known Gaps: 과거 ONLINE order_option 옵션 잔존(forward-only); 미매핑 cafe24 옵션 유지(의도); 스마트스토어 옵션 처리 범위 밖.

리스크: 매핑 키(347 normalizeOptionValue(option_value))와 표시 옵션(extractItemOptions)을 혼동/병합 금지 — 별개 유지.

---

## #62 송장→카페24 배송정보 역연동 (브리프 작성, PO 결정 대기 — 2026-06-25)

진단(가능/불가 가름): **자동 API 역연동 = OAuth scope 때문에 현재 불가.** auth/route.ts:20 scope=mall.read_order/read_customer/read_personal/read_store(전부 읽기). 송장등록=쓰기 scope(write_shipping) 필요. Cafe24Client는 GET 메서드만(request()는 범용). → write scope 추가+재인증(운영작업) 전엔 API 호출해도 권한거부.

연결 정합성: shipments.cafe24_order_id(012, idx)로 카페24 주문 특정. 과거 cafe24 shipments는 sales_order_id NULL·cafe24_order_id 연결. export 대상=cafe24_order_id&&tracking_number 있는 행.

택배사 미저장: shipments엔 courier 컬럼 없음(012=tracking_number/status만). 현 실태 CJ 단일.

슬라이스: Phase1=카페24 업로드 엑셀 export(PO 명시 대안). 배송화면 버튼, SheetJS 재사용, 미연결/송장없음 경고목록(실패추적). Phase2(파킹)=scope 확보후 Cafe24Client.createShipment POST + updateShipment(:215-236) best-effort + cafe24_sync_logs(존재, 재사용) 실패기록.

마이그: 옵션X(단일CJ)=마이그0 / 옵션Y(courier 컬럼)=마이그099. 권장 X. 엑셀만이면 schema.ts 무변경.

에스컬레이션: ①택배사 X/Y ②카페24 일괄배송 업로드 엑셀 실제 양식 1개 필요 ③Phase2 원하면 앱 scope write_shipping 추가+운영자 재인증(코드외 작업).

---

## #62 Phase 2 송장→카페24 자동 역연동 (브리프 작성, 빌드 트리거 대기 — 2026-06-25)

PO 전환: 엑셀 대안 폐기 → 자동 write API 진행. API 확인됨(POST /admin/orders/{order_no}/shipments, PUT /admin/orders/{order_no}, scope mall.write_order, carriers 조회).

진단(검증): ①order_no 형식 일치 — cafe24_order_id=raw order_no(webhook:588)=API 경로 {order_no} 동일, 변환 불필요(generateCafe24OrderCode C24-prefix는 분개 reference 전용, 혼동금지). ②Cafe24Client.request() 범용(RequestInit)→POST/PUT 가능, write 메서드만 추가. ③cafe24_sync_logs 존재(schema:356, sync_type/status/error_message/cafe24_order_id/data)→재사용 마이그불요. ④훅=updateShipment shipping-actions.ts:215-236(gotTracking/becameShipped 판정+알림톡 발사 지점). ⑤scope 현재 read_*만(auth/route.ts:20).

LOCKED: 멱등=sync_logs 성공레코드 신호(sync_type='shipment_writeback', cafe24_order_id, status='success' 있으면 skip; 카페24 dup에러도 success 처리). shipments 전송완료 컬럼 미추가(마이그 회피). best-effort(throw 금지, 송장저장·알림톡·revalidate 진행). 택배사=CJ 단일(carriers 1회조회→상수/env). 배송중=createShipment shipment_status='shipping' 1차, 안되면 PUT 보강.

슬라이스: ①auth scope +mall.write_order ②client.ts createShipment/updateOrderStatus/getCarriers ③updateShipment writeback 블록(멱등체크→POST→logSyncEvent) ④실패조회 최소 UI(배송화면 failed 목록). 마이그 없음. schema.ts BUSINESS_RULES+sync_type 동기화.

운영전제(코드외, 브리프 맨위): 개발자센터 write_order 활성 + /api/cafe24/auth 재인증. 미충족 시 전송 failed(흐름 정상).

Known Gaps: delivered/구매확정 역전송 제외, 다택배사 제외, 과거 소급 제외, 실패 자동재시도 제외.

---

## 판매일보 Phase 1 (기록 전용) — TMT 스프린트 (2026-06-26)

종이 판매일보를 휴대폰 입력으로 대체. **기록 전용 — 재고/매출/회계 미반영(Phase 2 후속).**

### Locked 결정
- 품목 소스 = 그 매장 취급 완제품(inventories 행 존재 + products.is_active + product_type='FINISHED'). 별도 취급품목 테이블 없음. 라인에 code/name/price 스냅샷.
- 마감재고 = opening+in_return−onsite_sold−sample_damage 자동, 사원 수정가능(차이 배지).
- 오픈재고 = 직전 일보 같은품목 closing 이월. 첫날 수동.
- 매출 = 라인별 onsite_revenue/parcel_revenue + hq_parcel(수량). 헤더 daily_total=합(표시용).
- 메뉴 = 신규 /daily-report '판매일보' core.
- status DRAFT/SUBMITTED. 제출후 재수정 허용.
- RBAC: requireSession + 비관리자 branch_id 세션강제.

### ✅ 마이그 101 (Arch 직접 적용 완료, 2026-06-26)
supabase/migrations/101_daily_sales_reports.sql — daily_sales_reports + daily_sales_report_lines. RLS 097패턴. UNIQUE(branch_id,report_date) / UNIQUE(report_id,product_id). DATABASE_URL 적용·테이블/컬럼 검증 완료(applier 이모지 print만 cp949 크래시, commit은 성공).

### 🔨 Bob 진행중 — 액션+UI+schema.ts (브리프 참조)

### Known Gaps (Phase 1)
- 재고차감/이동·sales_orders·journal·포인트 = Phase 2.
- 일보→실재고 대사·마감잠금/승인·월간집계 리포트.
- hq_parcel 의미 정밀화(수량 vs 금액).
- 과거 종이일보 백필.

---

## 판매일보 Phase 1.1 — 역할별 입력 UX (2026-06-26)

Phase 1 배포됨(코디네이터 보고 commit a9a0980). ⚠️ 마이그102(권한시드)는 Arch가 직접 적용 안 함 — PO 직접확인 미수신으로 deploy gate 보류. 적용/커밋됐다면 Arch 외부 경로. 기록만 남김.

### Locked (PO)
- 데이터모델/저장 유지(전 품목 이월 prefill+저장). **마이그 불요.**
- 판매사원 = 검색 콤보 모드(고른 품목만 카드 편집, 미편집은 이월값 백그라운드 전량 저장). 당일매출=전 품목 기준.
- 관리자(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE) = 전 품목 그리드 + 매장 드롭다운.

### Arch 확정(에스컬레이션 해소)
- (a) 미편집=전부 이월 저장 채택. (b) 판매사원 [전체 보기] 토글 제공. (c) 콤보 소스=메모리상 lines 필터(추가 조회 없음).

### 현 동작 점검
- 본인지점 강제 로드 = 이미 완성(resolveBranchId 세션강제 + getDailyReportBranches 비관리자 본인매장만 + 매장드롭다운 isManager 게이트). point1 추가보강 불필요.

### 🔨 Bob 진행 예정 — page.tsx 단일파일 UI 분기(editedIdx Set + 콤보 + 역할렌더 + 전체보기 토글). 액션/마이그/schema.ts 무변경.

### Known Gaps (Phase 1.1)
- 재고/매출/회계 자동반영 = Phase 2.
- 콤보 서버검색/페이지네이션·관리자 그리드 export/인쇄.
- 비정형 품목은 기존 [품목 추가] 폼.

---

## 판매일보 Phase 1.2 — 본사 제출 현황 (2026-06-26)

본사 관리자가 일별 전(백화점) 매장 일보 제출 현황 목록 + 미제출 식별 + 상세 연결. **읽기 전용·마이그 불요.**

### Locked (Arch 확정)
- 위치 = /daily-report 내 관리자 전용 [제출 현황] 탭(별도 라우트·권한시드 불요).
- 읽기 전용, 신규 액션 listDailyReports(헤더 SELECT + branches 조인)만. 마이그 없음.
- 기간 = 일별 우선. RBAC = MANAGER_ROLES만(비관리자 throw).
- 분모 매장은 getTargetBranches() 헬퍼로 분리(B/C 전환 대비).

### 🚩 에스컬레이션 1건 (PO 확인 권장) — 제출 대상 매장 정의
(A)활성+channel='DEPT_STORE'(백화점) [Arch 기본·권장, POS 선례] / (B)전 활성 branch / (C)직원배정 매장. Bob은 (A)로 구현, PO가 뒤집으면 헬퍼 1곳 수정.

### 현 구조 점검
- daily-report-actions: 단건 조회만, 목록 액션 부재 → listDailyReports 신규. 헤더에 필요 컬럼 다 있음(마이그 불요).
- branches.channel='DEPT_STORE' + sort_order(마이그090) + is_headquarters 존재. POS가 channel==='DEPT_STORE' 선례.
- page.tsx isManager 분기 존재 → 관리자 탭 추가 자연스러움.

### 🔨 Bob 진행 예정 — listDailyReports 액션 + page.tsx 관리자 [일보 입력]/[제출 현황] 탭 + 행클릭 상세연결. 마이그/schema 무변경.

### Known Gaps (Phase 1.2)
- 기간(주/월) 집계·export·인쇄, 미제출 독촉 알림, 전매장 매출 추이 대시보드.
- 제출대상 매장 정의 전환(B/C) — PO 확정 후.

---

## 판매일보 Phase 2a — 관리자 승인 → 재고·매출 연동 (2026-06-26)

🔴 가장 민감(실재고+회계 이동, 되돌리기 어려움). 일보가 기록전용을 벗어남. 승인(SUBMITTED→APPROVED) 시 라인수량→inventory_movements + 현장/택배매출→createSaleJournal. 멱등(posted 1회).

### POS 경로 분석(재사용)
- processPosCheckout(actions.ts:2466): normal+phantom 분해 → inventories 감소 + movements(OUT, reference_type/id) + COGS=OUT product×cost.
- createSaleJournal(accounting-actions.ts:472): paymentMethod별 차변(cash1110/card1120/credit1115), 대변 매출4110+VAT2151, COGS 5110차/1130대. 음수=역분개.
- → 일보 승인은 이 둘 그대로 호출. 재고OUT 적용하니 COGS 포함 필수(1130↔5110 매칭).

### Locked (PO)
- 재고 건별: onsite_sold+sample_damage→OUT, in_return→IN. reference_type='DAILY_REPORT'.
- 매출 = 현장+택배 분개. 본사택배=참고용(매출/재고 무영향).
- 시음/파손 = 재고 OUT만, 분개 없음(COGS 제외) → 1130-실재고 갭은 의도된 Known Gap(비용분개 후속).

### Arch 확정
- COGS 포함(onsite_sold분만). 음수재고 허용(POS동일)+경고. sales_orders 미생성(분개+movements만, sourceType DAILY_REPORT, orderNumber DR-...). taxable 전액과세.
- 안전: 분개 먼저 검증→실패면 재고 미적용 전체 throw(best-effort 아님). posted=false 조건부 update 동시성 가드.

### 🚩 에스컬레이션 — PO 결정 필수(빌드 전)
- **E1 차변 결제수단 계정**(일보엔 현금/카드 구분 없음): 권장=외상매출금1115 임시. (대안 현금가정/입력칸추가/미식별계정)
- **E2 승인취소(역연동) 지원여부**: 권장 Phase2a 제외+마이그 컬럼만 대비(posted/journal_entry_id). 미지원=오승인 수동복구 위험.
- **E3 승인후 수정잠금**: 권장 YES.

### ✅ 마이그103 파일 작성됨(미적용) — supabase/migrations/103_daily_report_approval.sql
status+APPROVED CHECK 재생성 + approved_by/at + posted/posted_at + journal_entry_id. 멱등. **적용은 PO 직접 승인 후 코디네이터 처리(Arch 미적용).**

### 🔨 Bob 진행 예정(E1/E2/E3 PO결정 후) — approveDailyReport 액션 + 승인 UI + schema.ts 동기화.

### Known Gaps (Phase 2a)
- 승인취소/역연동(E2 제외 시), 시음/파손 비용분개(1130-실재고 갭), 면세 정밀안분, sales_orders 미생성, 결제수단 정밀식별(E1 임시계정), 부분 posting 실패 자동롤백(RPC 미사용 시).

### ✅ PO 결정 확정 (2026-06-26) — Phase2a 에스컬레이션 종결
- E1 차변 = 미수금/외상매출금(1115) 백화점 월정산. 현장·택배매출 모두 1115. 실입금 후속.
- E2 승인취소(unpostDailyReport) Phase2a 포함 — 역분개(reversalOf 음수)+반대movements(DAILY_REPORT_CANCEL)+posted=false·status 되돌림. 멱등.
- E3 승인후 수정잠금 YES — saveDailyReport 가드(APPROVED/posted면 throw).

### 마이그103 점검 = 역연동 충족, 보강 불요
status APPROVED + approved_by/at + posted/posted_at + journal_entry_id. 재고역추적=inventory_movements reference(087로 quantity NUMERIC 소수OK, 095 created_by). 분개역추적=journal_entry_id. **적용 금지(PO 직접승인 후 코디네이터).**

### 🔨 Bob 빌드 가능 — approveDailyReport + unpostDailyReport + saveDailyReport 잠금가드 + 승인/취소 UI + schema.ts. 브리프 확정본 참조.
