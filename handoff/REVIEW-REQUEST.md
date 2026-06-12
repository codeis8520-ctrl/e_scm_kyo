# Review Request — Step 1: CJ/선택 엑셀 발송지 모달 제거 + 행별 자동 해결
Date: 2026-06-12
Ready for Review: YES

빌드: `npm run build` ✅ Compiled successfully, error/warning 0, /shipping 정상 컴파일.
grep 검증: `pickerForm`/`pickerBranchId`/`showSenderPicker`/`confirmSenderAndExport`/`doExportSelectedToExcel`/`lastSenderBranchId` 참조 **0건**.

## Files Changed
모두 `src/app/(dashboard)/shipping/page.tsx` (단일 파일, DB/마이그/schema.ts 변경 없음):
- `:15,20` — `Shipment` interface에 `branch_id`/`sender_address_detail`/`sender_zipcode` 추가.
- `:228` — `branchSenders` state만 남기고 `showSenderPicker`/`pickerBranchId`/`pickerForm` state 삭제.
- `:269` — 로드 useEffect에서 localStorage 복원·pickerBranchId 초기화 라인 삭제(branchSenders 로드+3단 폴백 보존). 프리필 useEffect 전체 삭제.
- `:366-392` — 신규 `resolveSenderForRow(s)` 헬퍼(행별 sender 해결, cafe24→HQ 폴백).
- `:394-407` — 신규 `guardSenders(targets)` 가드(이름/전화/주소 빈칸 시 수령자명 alert 후 중단).
- `:408-483` — `downloadCjExcel` 재작성: 모달 제거→가드→행별 sender로 CJ aoa 매핑. RTC(`KX-`)/헤더/`!cols`/파일명/PENDING→PRINTED 자동전환 보존.
- `:904-933` — `exportSelectedToExcel` 재작성: 모달 제거→가드→행별 sender. `doExportSelectedToExcel` 통합 삭제.
- 발송지 선택 모달 JSX(구 L1631-1716) 전체 삭제 — 컴포넌트 말미가 `</div>);}` 로 정리됨.

## Open Questions
- 가드는 브리프대로 이름/전화/주소만 검사. 우편번호 빈칸은 통과시킴(CJ 양식상 선택값). 의도 맞는지 확인 요청.
- cafe24 행(branch_id NULL) 폴백 순서: branch_id 매칭 → `is_headquarters` → `branchSenders[0]`. HQ 미존재 환경에서 [0]이 의도치 않은 지점일 수 있으나, 그 경우 주소/전화 비면 가드가 막음.

## Out of Scope (logged in BUILD-LOG)
- 지점 발송지(branches.sender_*) 등록 UI — 미등록 지점은 가드가 차단.
- cafe24 shipment 생성 시 branch_id 부여 로직 — HQ 폴백으로 충분(브리프).
- POS "구매자 동일" 시 sender_address 저장 정책 — 미변경.
- `openDaumPostcode`/Daum 스크립트 useEffect는 manualForm/editForm 주소검색에서 사용 중이라 **보존**(grep 확인).
