# BUILD-LOG — SMS/알림톡 발송 고도화

## 과제
알림 발송 모달이 활성 12,409명 중 앞 1000명만 도달(클라 1000캡 + slice(0,100)). 전 고객 도달 가능하도록 고도화(SMS+알림톡 공통).

## 조사 결론 (재사용/신규)
- **재사용**: sendSmsAction/sendKakaoAction(targets 배열 발송, 무변경) · Solapi send-many · runNotificationBatch의 HQ RBAC Set · /api/customers/search(서버검색·RPC·branch RBAC, Step B에서 검색UI에) · .range() 페이지네이션 1000캡우회 패턴.
- **신규**: resolveSendTargets 서버액션(모드별 대상해석 ids/grade/all + 전화없음제외 + 중복제거 + skipped집계). 배치 청킹 헬퍼(Step C).

## 스텝 시퀀스 (한 스텝=한 배포)
- **Step A** (브리프 작성됨): 서버측 대상 해석 액션 + 건수/skipped 반환. UI 무변경. RBAC(grade/all=HQ).
- **Step B**: 모달 UI — 모드 토글(선택/등급/전체), /api/customers/search 서버검색, 검색 간 selection 누적, 발송 전 대상 건수 확인(SMS는 건당 과금 경고). handleSend가 resolveSendTargets로 targets 해석 후 기존 send 액션 호출.
- **Step C**: 대량발송 견고성 — send-many를 N건(예 100~500)씩 청크 분할 호출, 청크별 결과 합산(성공/실패/스킵), 타임아웃·Solapi 한도 대응, notifications insert도 청크 단위. 확인 다이얼로그(대량 가드).

## Known Gaps (열린 채로)
- 모달 UI / 검색 / 선택누적 / 건수표시 → Step B.
- send-many 청킹 / 결과집계 / 대량 가드 → Step C.
- 과거 발송이력 백필 없음(forward-only, 해당 없음).

## 결정
- 등급 enum: NORMAL/VIP/VVIP (customers.grade text).
- 대량발송(grade/all)=HQ 전용(SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE). ids(명시선택)=게이트 없음.
- 지점 사용자는 자기 지점 고객으로 스코프(primary_branch_id).

## Step A — 구현 완료 (리뷰 대기)
- 상태: BUILD DONE · `npm run build` ✓ (Compiled successfully)
- 파일: `src/lib/notification-actions.ts` — 끝에 export 1개 신규 추가(기존 액션 무변경).
  - `resolveSendTargets(params)` + 타입 `SendAudienceMode`/`ResolveTargetsParams`, 헬퍼 `normalizePhone`, 상수 `HQ_ROLES`, 내부타입 `CustomerRow`.
- 처리:
  - requireSession → try/catch `{ error }`(기존 패턴).
  - RBAC: isHQ=(!role || HQ_ROLES). grade/all & 비HQ → `{ error: '대량 발송은 본사 권한이 필요합니다.' }`.
  - branchScope: 비HQ면 session.branch_id로 `primary_branch_id` 강제. HQ는 null(무제한).
  - ids: 빈배열 error. 200개씩 .in() 청크 누적.
  - grade/all: .range() 1000씩 while 루프(page.length<PAGE면 종료). grade 누락 시 error.
  - 공통: is_active=true + phone NOT NULL. 후처리에서 빈/공백 phone 제외(skipped++), 정규화(하이픈·공백 제거) 중복 1건화(중복도 skipped++).
  - 반환 `{ targets, total, skipped }`.
- 결정(추가):
  - 1000캡 우회 루프에 `.order('id')` 부여 — range 페이징 안정성(누락/중복 방지).
  - HQ 판정에 `!session.role`(role 미상)도 HQ로 간주 — runNotificationBatch 동일 관용(`session.role && !HQ.has`).

## Step A — Known Gaps (스코프 고정, 미수정)
- (없음) 스텝 범위 내 추가 발견 없음. Step B/C 갭은 위 상위 섹션 유지.

## Step B — 구현 완료 (리뷰 대기)
- 상태: BUILD DONE · `npm run build` ✓ (Compiled successfully, error/warn 0)
- 파일: `src/app/(dashboard)/notifications/page.tsx` (단일 파일)
- 변경 요약:
  - **모드 토글 4종**: ids(개별선택)·grade(등급별)·all(전체)·single(직접전화). 기존 'bulk'→'ids' 의미 이관, 'single' 유지. grade/all은 비HQ 숨김(`user_role` 쿠키 + HQ_ROLES set).
  - **서버검색**: ids 모드 고객목록을 `/api/customers/search?q=&page=1&limit=30&sort=name` debounce(300ms) fetch로 교체. 응답 `{customers,total,page}`에서 id/name/phone/grade만 사용. 검색 cancel 가드.
  - **선택 누적**: `selectedCustomerIds`(id 배열) + `pickedCustomers`(Map<id,PickedCustomer>) — 검색결과 밖 선택도 보존(칩·미리보기 샘플). 검색어 변경해도 유지. 칩 표시(이름 ✕) + 카운트 + 선택해제.
  - **grade/all UI**: 개별 체크 없음. grade=등급 라디오(VVIP/VIP/NORMAL), all=경고 안내. 인원수는 확인 다이얼로그에서 표시.
  - **확인 다이얼로그**: handleSend 1단계 = `resolveSendTargets(mode)`(Step A)로 `{total,skipped}` 받아 'N명에게 발송합니다(SMS 건당 과금) + skip N건 제외' confirm. 확정 시 서버 정제 `targets`로 기존 sendSmsAction/sendKakaoAction 호출(클라 재수집 X). single은 현행 phone 그대로(resolve 미경유).
- 결정:
  - ids 모드도 resolveSendTargets 경유 — 전화없음/중복 제거 일관. pickedCustomers는 칩·미리보기용으로만 클라 보존.
  - parent의 12k 클라 로드(`customers` state + 모달 prop) **제거** — 모달이 서버검색·resolve로 자족. 불필요 `createClient` import도 정리. 성능 이득, 회귀 위험 낮음(prop 미사용화).
  - renderPreview: `customers` 배열 인자 → `sampleCustomer: PickedCustomer|null`로 시그니처 변경(전체 prop 신뢰 불가).
  - 등급 빠른필터(기존 customers.filter count) 제거 — 전체 DB count 불가, grade 모드가 대체.
- 보존 확인: 알림톡 템플릿/변수치환·manualFields·미리보기·single 발송·발송 기록·send 액션 시그니처 무변경. Step A resolveSendTargets 무변경.

## Step B — Known Gaps (스코프 고정, 미수정)
- 검색 결과는 페이지당 30명만 표시(페이지네이션 '더보기' UI 없음) — 검색어를 좁혀 선택 유도(안내 문구로 처리). 무한스크롤/페이지 버튼은 후속.
- 대량발송 시 send-many 단일 호출(청킹 없음) → Step C 범위 유지.
