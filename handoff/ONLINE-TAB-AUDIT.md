# ONLINE-TAB-AUDIT — 온라인몰(카페24) 주문 탭 전수 감사 (#50)

작성: 2026-06-19 · 코드 수정 없음 · 감사 + 신규범위 선별 전용
대상: `src/app/(dashboard)/shipping/page.tsx` cafe24 탭 + `src/app/api/cafe24/orders/route.ts`
임베드: /pos 5탭 '온라인몰' (embedded=true, 탭전환 금지 L867)

---

## (A) 9요청 현황표

### 1. 기간 선택 후 불러오기(수집) — ✅ 있음
- 시작일/종료일 input + '불러오기' 버튼: page L1046~1055
- handleLoadCafe24Orders L723 → GET /api/cafe24/orders?start_date&end_date (route L159~)
- 탭 진입 시 자동 1회 로드 L743. KST 기준 날짜 처리(route L162~166).
- 갭: 없음.

### 2. 수집→확인→고객매칭→품목매핑→중복확인→전표생성→택배연동 7단계 흐름 — ⚠️ 부분(6/7 화면 노출, 단계 라벨링 없음)
| 단계 | 화면 위치 | 상태 |
|---|---|---|
| 수집 | L1046 불러오기 | ✅ |
| 주문확인 | 테이블 L1152~ (주문일/주문자/수령자/주소/메모/품목/금액/상태) | ✅ |
| 고객매칭 | '고객' 컬럼 L1176 (✓고객/미등록 체크) | ✅ |
| 품목매핑 | 품목 셀 펼침 L1212~ (행 단위로만 보임) | ⚠️ collapsed 행엔 매핑상태 無 |
| 중복확인 | 🔁중복가능 배지 L1190 | ✅ |
| 전표생성 | '배송 추가 + 판매전표 생성' L1142 | ✅ |
| 택배연동 | createShipment→shipments→배송목록탭(#48) | ✅ |
- 갭: 단계가 명시적 stepper/안내로 라벨링돼 있지 않음(기능은 다 있음). 안내문구 L1148~1150이 부분 보완. → UX 라벨링은 신규 후보 아님(중복/저가치).

### 3. 주문별 고객 등록/연결 상태 표시 — ✅ 있음
- '고객' 컬럼 L1176~1188: customer_match면 `✓ 고객`(emerald), 아니면 `미등록` 체크박스.
- 판정 로직 route L397~456: 확정주문=sales_orders.customer_id 실연결 기준, 미확정=이름+전화 휴리스틱(byKey).
- register 버튼: '주문자 고객 등록 (N건)' L1138, handleRegisterCustomers L808→registerCafe24Customers, 등록 후 재조회로 ✓고객 전환.
- 갭: 없음.

### 4. 품목 매핑 상태 확인 — ⚠️ 부분 (펼쳐야만 보임, collapsed 요약 없음)
- 데이터: order_items[].mapped_name (route L387 resolveMappedName, cafe24_product_map 일괄조회 L284~332).
- 표시: 펼침 영역 L1230 `→ {mapped_name} ✓` / L1246 `미매핑`(amber) + HQ 연결/해제 버튼.
- **핵심 갭**: collapsed 테이블 행(L1197 품목 셀)은 items_summary 텍스트만 — 매핑된 품목은 매핑명으로 치환되지만(route L341), **미매핑 품목이 섞여 있는지/몇 건인지 행 단위로 알 수 없음**. 사용자는 모든 주문을 일일이 펼쳐야 미매핑을 발견. → 신규 후보 #1.

### 5. 전표 생성완료 배지 — ⚠️ 부분 (배지 있으나 흐림과 중복·약함)
- already_added → 행 opacity-40 (L1172) + 마지막 컬럼 `추가됨` badge-info (L1210) + 체크박스 disabled.
- already_added 산출: route L390 existingShipments(shipments.cafe24_order_id) 기준.
- **갭**: '추가됨' 배지가 맨 끝 빈 헤더 컬럼에 있어 눈에 안 띔 + opacity-40이 "비활성"처럼 보여 "완료"의 긍정 의미가 약함. 명확한 "전표생성완료" 의미의 배지/컬럼 부재. → 신규 후보 #2(경량).

### 6. 미처리 주문만 필터 — ✅ 있음
- '미추가만 보기' 체크박스 L1090~1096, cafe24HideAdded.
- 클라 필터 L903 + 서버 hide_added=1로 already_added 상세페치 스킵(성능, route L168/L258).
- 0건 시 해제 안내 L1099~1117.
- 갭: 없음.

### 7. 선택 주문만 전표생성 — ✅ 있음
- 행 체크박스 L1173(already_added는 disabled) + 모두선택 L1154(selectable=미추가만, L919).
- '배송 추가 + 판매전표 생성 (N건)' L1142 → handleAddSelectedOrders L835.
- 갭: 없음.

### 8. 중복 수집 자동생성 방지 — ✅ 있음
- 중복발송 의심: 🔁중복가능 배지 L1190, is_dup 산출 route L458~481(받는분 이름+전화+품목시그니처 ≥2건).
- 자동생성 방지: already_added로 동일 cafe24_order_id 재추가 차단(체크박스 disabled L1173) + #25 staged(크론 자동 전표생성 제거, 확정 시에만 생성). route L390 existingIds로 멱등.
- 갭: 없음. (is_dup은 경고용 표시일 뿐 차단은 already_added가 담당 — 의도된 설계)

### 9. 전표생성 후 판매현황·택배·매출·재고 1전표 연결 — ✅ 있음 (#48 Phase1~3 완료)
- handleAddSelectedOrders→createShipment(source:CAFE24, cafe24_order_id) L843~. 확정 시 전표/매출분개 생성(#25 staged, 안내문 L1148).
- shipments는 cafe24_order_id로 연결(과거 sales_order_id NULL 가능 — [[project_cafe24_staged_posting]]).
- 판매전표 중심 구조 #48로 판매현황·택배·매출 단일전표 연동.
- 갭: 없음(별도 검증대상 아님 — 보존영역).

---

## (B) 진짜 신규로 필요한 항목 (중복구현 금지)

**충족: 9개 중 6개 완전(1,3,6,7,8,9) + 1개 라벨링만 미흡(2, 저가치).**
**진짜 신규 = 2개 (둘 다 "표시" 강화, 로직/데이터 신규 없음):**

- **신규 #1 — 품목 매핑상태 행 요약 배지 (요청 4)**: 펼치지 않아도 주문 행에서 "미매핑 N건" 인지.
- **신규 #2 — 전표생성완료 표시 강화 (요청 5)**: '추가됨'을 명확한 "전표생성완료" 배지로 + opacity 흐림 보완.

(요청 2의 단계 stepper는 권장 안 함 — 기능 전부 존재, 라벨링은 저가치·화면 복잡도만 증가.)

---

## (C) 신규 항목별 최소 변경설계 (기존 데이터 재사용, DB변경 0)

### 신규 #1 — 품목 매핑상태 행 요약 배지
- **데이터 재사용**: 이미 route가 order_items[].mapped_name 내려줌(추가 쿼리 0). 마이그 불요.
- **변경 파일/위치**: page.tsx 품목 셀 L1197~1207 toggleExpandOrder 버튼 안.
- **로직**: `const unmapped = items.filter(i => i.product_code && !i.mapped_name).length;` (product_code 없는 품목은 매핑불가라 제외 — L1248 기존 규칙과 일치). unmapped>0이면 amber 배지 `미매핑 N`, ==0이면 emerald `매핑완료`(또는 무표시). items 0건이면 무표시.
- **범위**: 단일 파일 1셀, JSX 한 줄. 펼침/매핑 로직 무회귀.

### 신규 #2 — 전표생성완료 배지 강화
- **데이터 재사용**: 기존 already_added(route L390). 추가 0.
- **변경 파일/위치**: page.tsx L1210(마지막 컬럼). 옵션으로 L1164 헤더 빈 `<th>`에 라벨 '전표' 부여.
- **로직**: `추가됨` → `✓ 전표생성완료`(emerald badge)로 문구/색 변경. opacity-40(L1172)은 가독성 위해 opacity-60 정도로 완화 검토(미추가만 보기가 기본이라 실사용 영향 작음 — PO 확인).
- **범위**: 단일 파일, 배지 1개 + 헤더 라벨. 선택/필터 로직 무회귀.

> 두 항목 모두 **route.ts 무변경**(데이터 이미 존재), page.tsx 단일 파일, DB/마이그 0, AI schema.ts 무관(스키마·비즈규칙 변경 없음).

---

## (D) 절대 건드리지 말 보존영역
- **#25 staged posting**: 확정(배송추가) 시에만 전표·분개 생성, 크론 자동생성 제거. handleAddSelectedOrders·createShipment 흐름. [[project_cafe24_staged_posting]]
- **#48 판매전표 중심 연동**: shipments↔sales_orders↔매출·재고 단일전표. 출고/연동 로직.
- **기존 수집/필터**: handleLoadCafe24Orders, hide_added 성능경로(route L168/258), filteredCafe24Orders L902.
- **고객등록**: registerCafe24Customers, customer_match 판정 route L397~456.
- **품목매핑 데이터층**: cafe24_product_map, normalizeOptionValue(types.ts 단일출처), resolveMappedName, createCafe24ProductMap/delete. (#50은 "표시 요약"만 추가 — 매핑 로직 무수정)
- **중복/멱등**: is_dup 산출, already_added existingIds, CJ sender 자동해결.

## (E) 에스컬레이션
- **E1 (요청 5)**: opacity-40 흐림을 완화할지 = UX 결정. 현재 "미추가만 보기"가 기본이라 흐림 거의 안 보임. 배지 강화만 하고 흐림 유지할지 PO 확정 필요.
- **E2 (요청 2)**: 단계 stepper/안내 라벨링은 신규로 안 잡았음(기능 전부 존재). PO가 "단계 시각화 자체"를 원하면 별도 결정 — 권장은 안내문구(L1148) 보강 수준.
- **E3 (요청 4)**: 매핑완료까지 emerald로 양성표시할지, 미매핑만 경고할지(화면 소음 최소화) = PO 취향. 권장: 미매핑>0일 때만 amber 표시.
