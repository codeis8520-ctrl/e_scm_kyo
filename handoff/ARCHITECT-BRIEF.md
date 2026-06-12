# Architect Brief — Step 1: CJ/선택 엑셀 발송지 모달 제거 + 행별 자동 해결

## Goal
대한통운(CJ) 및 "선택 엑셀" export 시 발송지 선택 모달을 완전히 제거하고, 각 행의 보내는분(이름/전화/주소/우편번호)을 행별로 자동 해결한다.

## Verified Data Facts (조사 완료 — 재조사 불필요)
- `getShipments()` (shipping-actions L31) 는 `select('*')` → 반환 행에 `branch_id`, `sender_zipcode`, `sender_address`, `sender_address_detail` 가 **이미 포함됨**. 단 page.tsx 의 `Shipment` interface(L11-28)에는 미선언 → 확장 필요.
- POS shipment insert (actions.ts L2224-2245): `branch_id = stockBranchId`(출고 지점) 세팅됨. `sender_name/phone` = 구매자 동일이면 구매자값, 아니면 수동. "구매자 동일"이면 `sender_address/zipcode` 미저장(null) — 의도된 동작.
- Cafe24 shipment insert (shipping/page.tsx L768-780): `branch_id` 안 넘김 → **NULL**. sender 빈 값. (cafe24DefaultSender 는 실제 운영 모드에서 항상 null — orders route L353.)
- `branchSenders` state (L270~): 클라이언트에 이미 로드됨. 각 원소에 `id, is_headquarters, name, address, phone, sender_name, sender_phone, sender_zipcode, sender_address, sender_address_detail` 보유. 폴백 로직(L237-264)도 그대로 둠.

## 확정 정책 (Project Owner)
행별 sender 해결 규칙 (per row `s`):
1. **이름/전화**: `s.sender_name`/`s.sender_phone` 가 비어있지 않으면 그것 사용. 비면 → 그 행의 출고지점(`s.branch_id`) `branch.sender_name`/`sender_phone`. 그것도 없으면 기존 기본 폴백(`경옥채 {name}` / `branch.phone`).
2. **주소/우편번호**: 항상 그 행의 출고지점(`s.branch_id`)의 `branch.sender_address`/`sender_zipcode` 사용 (구매자 주소 절대 아님). `sender_address` 없으면 `branch.address` 폴백. 상세주소는 `branch.sender_address_detail`.
3. **Cafe24 행(branch_id=NULL)**: 본사 지점(`branchSenders.find(b => b.is_headquarters)`)을 출고지점으로 간주해 위 규칙 적용. 본사도 없으면 `branchSenders[0]`.

## Build Order
1. **`Shipment` interface 확장** (L11-28): `branch_id: string | null;`, `sender_zipcode: string | null;`, `sender_address_detail: string | null;` 추가. (`sender_address`, `sender_name`, `sender_phone` 는 이미 있음.)
2. **헬퍼 추가** — `resolveSenderForRow(s: Shipment)` 를 컴포넌트 내부에 작성. 반환: `{ name, phone, address, addressDetail, zipcode }`. `branchSenders` + 위 정책 사용. 출고지점 lookup 은 `branchSenders.find(b => b.id === s.branch_id)`, cafe24/NULL 은 HQ 폴백.
3. **가드** — export 직전 모든 target 행에 대해 resolve 실행. 이름/전화/주소 중 하나라도 비는 행이 있으면 **export 중단하고 alert**: 해결 안 된 행의 수령자명을 나열(예: `"발송지(보내는분) 정보를 확정할 수 없는 행이 있습니다: 홍길동, 김철수. 출고 지점의 발송지 정보(지점 관리)를 먼저 등록해주세요."`). 조용히 빈칸 export 금지.
4. **`downloadCjExcel` (L384-390)**: 모달 오픈 제거. selectedShipments 비었으면 기존 alert 유지. 그 외엔 곧장 export 로직 실행(아래 5번에서 통합).
5. **CJ export 본문**: 현재 `confirmSenderAndExport` 의 `showSenderPicker === 'cj'` 블록(L398-459)을 `downloadCjExcel` 안으로 이전(또는 `downloadCjExcel` 가 호출하는 함수로). row 매핑 L415-423 에서 `pickerForm.name/phone/senderFullAddress/zipcode` → `resolveSenderForRow(s)` 결과로 교체 (행별). RTC(L419), 헤더, `!cols`, 파일명, **PENDING→PRINTED 자동전환(L435-459) 전부 보존**.
6. **`exportSelectedToExcel` (L893-897) + `doExportSelectedToExcel` (L900~)**: 동일하게 모달 제거 → 직접 export. `doExportSelectedToExcel` row 매핑(L906-910)의 `pickerForm.*` → `resolveSenderForRow(s)` 행별 값으로 교체. 가드(3번) 동일 적용.
7. **Dead code 제거**:
   - `confirmSenderAndExport` 함수 전체 삭제 (L393-469).
   - `showSenderPicker` state + setter, `pickerForm` state, `pickerBranchId` state, `setPickerForm` 프리필 useEffect(L280-292), localStorage `shipping.lastSenderBranchId` 저장/복원, 모달 JSX(L1632-1716) 삭제.
   - `openDaumPostcode`/Daum 스크립트 useEffect(L294-308): 모달 외 다른 곳에서 쓰이면 보존, 안 쓰이면 삭제. **grep 으로 확인 후 결정** — manualForm/editForm 주소검색에서 쓰면 남긴다.
   - `branchSenders` state 는 **보존**(resolve 헬퍼가 사용). 로드 useEffect(L237-277)도 보존하되 pickerBranchId 초기화 라인만 제거.

## Out of Scope (→ BUILD-LOG Known Gaps if surfaces)
- 지점 발송지(branches.sender_*) 등록 UI. 미등록 지점은 가드가 막는다.
- Cafe24 shipment 생성 시 branch_id 부여 로직 변경 (지금은 HQ 폴백으로 충분).
- POS "구매자 동일" 시 sender_address 저장 정책 변경.

## AI Sync (CLAUDE.md)
DB 스키마/enum/액션 의미 변경 **없음** (컬럼 추가/이름변경 없음, 순수 클라이언트 export 로직). `src/lib/ai/schema.ts` 갱신 불필요. — 명시적으로 검토 완료.

## Acceptance
- CJ 엑셀 / 선택 엑셀 다운로드 클릭 시 모달 없이 즉시 다운로드.
- 다운로드된 엑셀: 각 행 보내는분 = (저장 sender 이름/전화 우선) + (출고지점 주소/우편번호). 행마다 다를 수 있음.
- sender 미해결 행 존재 시 다운로드 안 되고 alert.
- `npm run build` 통과, `showSenderPicker`/`pickerForm`/`confirmSenderAndExport` 참조 0건 (grep).
- PENDING→PRINTED 전환 동작 유지.
