# Architect Brief — SMS/알림톡 발송 고도화 Step A (서버측 대상 해석 + 건수 미리보기)

## Goal
발송 대상을 클라이언트에 로드된 1000명에서 푸는 게 아니라, 서버에서 모드별(선택ID들 / 등급 / 전체)로 해석해 전화있는·중복제거된 SendTarget 배열과 건수를 돌려주는 서버액션을 신설한다. UI 변경 없음 — 이 스텝은 순수 데이터층.

## 배경 (조사 완료, 재조사 금지)
- 버그 근원: `notifications/page.tsx` L64 `from('customers').select(...).order('name')` → .range() 없음(1000캡). 모달 `filteredCustomers`는 .slice(0,100)(L460). 활성 12,409명 중 앞 1000만 도달.
- 발송 자체는 정상: `sendSmsAction`/`sendKakaoAction`(`src/lib/notification-actions.ts`)이 `targets: SendTarget[]`(`{customerId, phone, name?}`) 받아 Solapi `send-many` 호출. **이 두 액션과 Solapi 클라이언트는 이 스텝에서 건드리지 않는다.**
- RBAC 패턴 존재: `runNotificationBatch`(같은 파일 L172-175) — `const HQ = new Set(['SUPER_ADMIN','HQ_OPERATOR','EXECUTIVE'])`. 비-HQ는 `{ error: '본사 권한이 필요합니다.' }`. **이 패턴 그대로 재사용.**
- 등급 enum: customers.grade = 'NORMAL' | 'VIP' | 'VVIP' (text 컬럼).
- 1000캡 우회 정석(이 코드베이스): `.range(start,end)` 페이지네이션 루프. (search/route.ts·analytics가 이미 사용).

## Build Order
신규 파일 아님 — `src/lib/notification-actions.ts`에 export 액션 1개 추가.

```ts
export type SendAudienceMode = 'ids' | 'grade' | 'all';
export interface ResolveTargetsParams {
  mode: SendAudienceMode;
  customerIds?: string[];   // mode='ids'
  grade?: string;           // mode='grade' ('NORMAL'|'VIP'|'VVIP')
}
export async function resolveSendTargets(params: ResolveTargetsParams):
  Promise<{ targets: SendTarget[]; total: number; skipped: number } | { error: string }>
```

규칙:
- `requireSession()` 먼저(기존 액션과 동일 try/catch → `{ error }`).
- **RBAC**: mode가 'grade' 또는 'all'(대량발송)이면 HQ Set 게이트 적용. 비-HQ면 `{ error: '대량 발송은 본사 권한이 필요합니다.' }`. mode='ids'(명시 선택)는 게이트 없음(기존 단건/소량 흐름 유지).
- 공통 베이스 쿼리: `customers` 에서 `is_active=true` AND phone NOT NULL. select는 `id, name, phone, grade`.
- mode='ids': `.in('id', customerIds)` (빈 배열이면 `{ error: '선택된 고객이 없습니다.' }`). 1000개 초과 id는 청크로 .in 호출(PostgREST URL 한도) — 200개씩 나눠 합치기.
- mode='grade': `.eq('grade', grade)` + **.range() 페이지네이션 루프(1000씩 끝까지)** — 12k 전체 로드.
- mode='all': 등급 필터 없이 동일 페이지네이션 루프.
- **지점 사용자 스코프**: 세션 role이 BRANCH_STAFF/PHARMACY_STAFF면 `.eq('primary_branch_id', session.branch_id)` 강제(자기 지점 고객만). (search/route.ts L103 동일 패턴). HQ면 무제한. ※ 단 위 RBAC 게이트로 grade/all은 이미 HQ 전용이므로 실질 이 스코프는 ids 모드에서 의미. 그래도 일관 적용.
- **전화없음 제외 + 중복제거**: phone이 null/빈문자/공백이면 skipped++로 카운트하고 제외. 동일 정규화 전화번호(하이픈 제거) 중복은 1건만(중복도 skipped 집계). name 없으면 name=undefined 허용(발송은 됨).
- 반환: `targets`(정제된 SendTarget[]), `total`(targets.length), `skipped`(전화없음+중복 합).

## Out of Scope (BUILD-LOG Known Gaps로)
- 모달 UI(서버검색·선택누적·모드 선택·건수표시) → Step B.
- 대량발송 배치 청킹(Solapi send-many를 N건씩 분할)·결과 집계 → Step C.
- `sendSmsAction`/`sendKakaoAction`/Solapi 클라이언트 수정 일체.
- AI schema.ts 동기화: 이 스텝은 새 테이블/컬럼/enum 없음 → 불필요(신규 액션은 에이전트 도구 아님).

## Acceptance
- `npm run build` 통과.
- mode='ids'로 빈 배열 → error. 정상 id 배열 → 그 고객만, 전화없는 건 skipped.
- mode='grade'/'all' 비-HQ 세션 → 본사 권한 error. HQ 세션 → 1000 넘는 전체 반환(.range 루프 동작 확인: 코드상 while로 data.length===pageSize면 계속).
- 중복 전화 1건화, skipped 정확.
- 기존 sendSmsAction/sendKakaoAction 시그니처 무변경(회귀 0).

## Build 후
`handoff/REVIEW-REQUEST.md`에 변경 파일·함수·라인범위·자기리뷰 기재.

---

## Builder Plan — Step B (모달 UI 개편)

대상: `src/app/(dashboard)/notifications/page.tsx` SendModal.

### 변경
1. **모드 토글 3종 + single 유지**: `sendMode`를 `'ids' | 'grade' | 'all' | 'single'`로 확장(기존 'bulk'→'ids' 의미). 라벨: 개별 선택 / 등급별 / 전체 / 직접 전화. grade·all은 HQ 전용(비HQ는 버튼 숨김). HQ 판정은 `user_role` 쿠키(getCookie 헬퍼, production/page.tsx 패턴 복사) + HQ_ROLES set.
2. **서버검색**: ids 모드의 고객 목록을 `customers` prop(.slice100) 대신 `/api/customers/search?q=&page=&limit=&grade=` debounce fetch로 교체. 응답 `{customers,total,page}` 사용. 검색어 없으면 기본목록(이미 API가 처리). 결과는 id/name/phone/grade만 사용.
3. **선택 누적**: `selectedCustomerIds`(유지) + `selectedCustomers` Map<id,{name,phone}>(검색결과 밖 선택 보존용 — 칩 표시·발송 fallback). toggle 시 Map에도 적재. 검색어 변경해도 selection·Map 유지. 선택 칩(이름 x) + 카운트 표시, '선택 해제' 버튼.
4. **grade/all 모드 UI**: 개별 체크 없음. grade는 등급 라디오(VVIP/VIP/NORMAL). all은 안내문구만. 발송수는 확인 다이얼로그에서 resolveSendTargets로 받아 표시.
5. **확인 다이얼로그**: handleSend 1단계 = resolveSendTargets(mode 매핑)로 `{total, skipped}` 받아 'N명에게 발송합니다(SMS 건당 과금)' confirm 표시. ids 모드는 selectedCustomerIds 전달. 확정 시 그 액션이 돌려준 `targets`로 기존 sendSmsAction/sendKakaoAction 호출(클라 재수집 X — 서버 정제 targets 신뢰).
6. **single 무변경**: 기존 phone 입력 그대로. resolveSendTargets 안 거침.

### 결정/불확실
- ids 모드도 resolveSendTargets 경유(서버 정제 targets 사용) → 전화없음/중복 제거 일관. 단 selectedCustomers Map은 칩·미리보기 샘플용으로만 클라 보존.
- 미리보기 renderPreview: 기존 `customers` prop 대신 `selectedCustomers` Map의 첫 선택자로 샘플 구성(prop customers는 더 이상 전체 신뢰 불가). single은 phone 그대로.
- 등급 빠른필터(기존 customers.filter count) 제거 — 전체 DB count 불가, grade 모드가 대체.
- parent의 `customers` prop·L62-66 클라 1000 로드: Step B에서 모달이 prop 의존 제거하므로 **불필요해짐**. 단 제거는 parent 변경 → 스코프 최소화 위해 prop은 남기되 모달 내부에서 미사용(렌더 깨짐 0). L62-66 로드 제거는 Known Gap로 기록(선택). → **로드 제거까지 포함**: fetchData의 customerRes 제거해 12k 불필요 로드 차단(성능 이득, 회귀 위험 낮음). prop은 빈 배열 전달로 축소.

빌드 진행.
