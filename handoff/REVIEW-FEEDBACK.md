# Review Feedback — 판매일보 Phase2a (승인→재고·매출 + 승인취소) [재고+회계·보안]
Date: 2026-06-26 (Rev2 재리뷰)
Status: APPROVED
Ready for Builder: YES

## 1차 Condition 1 — 해소 확인 (CLEARED)
포스팅 슬롯 선점(권장안 a) 적용으로 동시성 멱등 블로커 해소.
- approveDailyReport: computeStockDeltas(계산만·부작용 0) → **부작용 이전** 헤더 조건부 update
  `update({posted:true}).eq('id').eq('posted',false).eq('status','SUBMITTED').select('id')` 로 슬롯 선점.
  PostgREST 문장단위 autocommit + 행 잠금 → 동시/더블서밋 중 1건만 false→true 통과, 패배자는
  `WHERE posted=false` 재평가 시 0행 → 즉시 `{error}` 반환(분개·movements·inventories **부작용 0**).
  승자의 movements/inventories 손상 경로(Rev1의 reference 공유삭제 + inventory 미원복) **소멸**.
- releaseSlot: 슬롯은 승자만 보유 → 승자 자기 호출분만 원복(posted=false). 분개 null 단계 실패 시
  적용된 것 없음 → 클린 재시도. status는 SUBMITTED 유지 → 재승인 가능. 정확.
- unpostDailyReport: 대칭. `posted:true→false .eq('posted',true).eq('status','APPROVED')` 선점, 패배자 0행 차단.
  journal_entry_id 슬롯 전 캡처(step③에서 null). CANCEL movements 사전체크는 저렴한 early-out, 권위 가드는 슬롯.
  교차 인터리브 안전: approve 진행중 status=SUBMITTED → unpost 차단 / unpost 진행중 posted=false → approve 차단.
- 비경합 멱등·역분개·COGS·RBAC·E3 잠금·무회귀 = 1차 Cleared 항목 슬롯 도입으로 **깨지지 않음**(추가 변경 없음).
- 크래시 잔여: 슬롯 선점으로 Rev1보다 **더 안전**해짐. claim 후 크래시 → posted=true/status=SUBMITTED
  → approve(posted!==true)·unpost(status!=='APPROVED') 양쪽 차단 = stuck-limbo(데이터 손상 0, 수동개입만).
  PO 수용 Known Gap 확인 — 신규 블로커 아님.

## Must Fix
- 없음. Condition 1 해소, 신규 데이터손상 경로 없음.

## Should Fix
- [daily-report-actions.ts:approve catch(②)] 재고 적용 중 **예외(throw)** 시 분개 롤백 + releaseSlot 하나,
  이미 적용된 부분 movements/inventories 는 원복하지 않음. 슬롯 해제로 재승인 가능해지면 partial 구간
  **이중차감** 가능. Bob 주석 "자기분만 정리(재시도 가능)"는 부정확(분개·슬롯만 정리, 재고 partial은 잔존).
  - 권장: catch 에서 releaseSlot 호출 제거(posted=true 유지) → 예외 경로를 크래시와 동일한 안전 stuck-limbo
    로 통일(수동개입 필요, 손상 0). 또는 partial movements delete + inventory 역적용까지 수행 후 해제.
  - 현실 확률은 낮음: applyMovement 가 .error 미검사라 DB 오류는 throw 안 함 → 루프 중 전송/네트워크
    throw 시에만 도달. 그러나 도달 시 조용한 재고 과차감 위험 → 1줄 하드닝 권장(5분 이내).
  - 차단 아님(아래 Known Gap 동일 계열). 미수정 시 BUILD-LOG 에 기록.

## Escalate to Arch
- (Known Gap 정밀화) PO 수용한 RPC 비트랜잭션 갭의 두 갈래 구분:
  · 크래시(예외 아님): 슬롯 선점으로 **safe stuck-limbo**(차단·손상 0). 수용 적정.
  · 예외(catch): 현재 releaseSlot 로 **재승인 가능 + partial 미원복 → 이중차감 가능**(크래시보다 위험).
  Should Fix 의 catch 하드닝(슬롯 미해제=limbo 통일)으로 두 갈래를 동일한 안전상태로 맞출지, 아니면
  Phase2b RPC 트랜잭션화로 본해결할지 Arch 판단. 코드레벨 단정 불가(재시도성 vs 안전성 UX 정책 선택).

## Cleared
슬롯 선점(분개·재고 이전 posted 조건부 update + 영향행 0 즉시중단)으로 동시성 멱등 블로커 해소,
승자 데이터 무손상·패배자 부작용 0 확인. 역분개/COGS/RBAC/E3/무회귀 1차 Cleared 유지. Step 2a 통과.
