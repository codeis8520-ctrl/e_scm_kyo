# Review Feedback — Step 1 (CJ/선택 엑셀 발송지 모달 제거 + 행별 자동 해결)
Date: 2026-06-12
Status: APPROVED

## Conditions
(none)

## Escalate to Arch
(none blocking — two design choices below are confirmed acceptable, listed only for the record)

## Cleared
src/app/(dashboard)/shipping/page.tsx 만 리뷰. 검증 통과:

- resolveSenderForRow (L366-390): 이름/전화는 저장 sender_* → 출고지점 → 폴백, 주소/우편번호는
  항상 출고지점(구매자/수령자 주소 절대 미참조) — 정책 순서 정확. cafe24/NULL branch_id 행은
  is_headquarters → branchSenders[0] 폴백, 로드 쿼리가 is_headquarters DESC 정렬(L243)이라 두 경로 수렴.
  branch_id 가 있으나 inactive/삭제로 미매칭 시 falsy → HQ 폴백으로 안전 통과.
- guardSenders (L394-405): 이름/전화/주소 빈칸 행을 수령자명 alert 후 차단. downloadCjExcel(L418)·
  exportSelectedToExcel(L908) 양쪽 모두 가드 선통과 후 export — 조용한 빈칸 export 경로 없음.
- PENDING→PRINTED 부수효과(L455-479) 보존, .eq('status','PENDING') race 가드 유지. RTC(KX-),
  헤더/!cols/파일명 미변경.
- Dead-code 제거 완전: showSenderPicker/pickerForm/pickerBranchId/confirmSenderAndExport/
  doExportSelectedToExcel/lastSenderBranchId 참조 0건(grep). 프리필·localStorage useEffect 삭제.
  모달 JSX 삭제 후 컴포넌트 정상 종료. build 0 warning.
- openDaumPostcode/Daum 스크립트 보존 — manualForm(L1200)·editForm(L1600) 주소검색에서 사용 중, 미손상.
- Shipment 인터페이스 추가(branch_id/sender_zipcode/sender_address_detail)는 getShipments 가
  select('*') 반환(shipping-actions.ts L32)이라 정합.

확인된 설계 선택 (수정 불필요):
- 우편번호 미가드: CJ 양식상 선택값, sender.zipcode||'' 매핑. 의도대로 통과 — OK.
- cafe24 HQ-폴백 순서: HQ 미존재 시 [0] 이 의도외 지점일 수 있으나 주소/전화 비면 가드가 차단 — 안전.
