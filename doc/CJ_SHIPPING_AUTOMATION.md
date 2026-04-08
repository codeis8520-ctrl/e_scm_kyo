# CJ대한통운 송장 처리 자동화 검토

## 현재 수동 워크플로

1. 우리 시스템 (`/shipping`) → **대한통운 엑셀 다운로드** 버튼으로 발송 대상 엑셀 받기
2. CJ대한통운 전산 사이트에 로그인 → 엑셀 업로드 → 송장번호 일괄 발번
3. CJ에서 송장번호가 채워진 엑셀 다시 다운로드
4. 우리 시스템 → **엑셀로 송장번호 가져오기** 버튼으로 임포트 → `shipments.tracking_number` 일괄 업데이트
5. 이후 **배송상태 일괄 업데이트** 버튼이 SweetTracker로 배송 진행상태 동기화

→ 1~4단계가 사람이 매일 반복하는 단순 작업이라 자동화 가치가 큼.

---

## 자동화 옵션 비교

### 1. Power Automate Desktop (RPA / 화면 매크로)
- **장점**
  - Windows 10/11 무료, GUI 녹화 + 변수화로 1차 버전 30분~1시간 구축
  - 우리 시스템 ↔ CJ 사이트 모두 화면 단위로 다루므로 별도 API 계약 불필요
  - 사용자(점원) PC에서 실행하므로 기존 CJ 계정 그대로 사용 가능
- **단점**
  - CJ 사이트 DOM/레이아웃이 바뀌면 매번 손봐야 함
  - 캡차/2FA 도입 시 중단
  - PC가 켜져 있어야 동작 (서버 배치 아님)
- **추천 대상**: 일 50건 이하, 1대 PC에서 정해진 시각에 돌리는 운영

### 2. Playwright / Puppeteer 헤드리스 봇
- **장점**
  - Node.js 코드라 우리 레포(`scripts/cj-sync.ts` 등)에 같이 관리 가능
  - cron / Vercel Cron / GitHub Actions로 야간 배치화 가능
  - 매크로보다 안정적 (셀렉터 기반)
- **단점**
  - 여전히 사이트 변경 리스크
  - CJ 약관상 자동화 봇 접속이 금지되는지 확인 필요 (회색지대)
  - 캡차/2FA 도입 시 우회 어려움
- **추천 대상**: 일 50~수백 건, 서버에서 무인 배치를 원하는 경우

### 3. CJ대한통운 공식 송장 발번 API (EDI / Open API) — 정공법
- **장점**
  - 엑셀 왕복 자체가 사라짐 — 송장번호 발번/취소/조회를 API로 직접
  - 한 번 붙이면 가장 안정적, 우리 배송관리에서 "송장 발번" 버튼 한 번이면 끝
  - 야간 배치, 실시간 처리 모두 가능
- **단점**
  - CJ 영업과 **B2B 계약** 필요, API 키 발급 절차 존재
  - 월 물량/계약 형태에 따라 사용 가능 여부 다름
- **추천 대상**: 일 100건 이상 또는 안정적인 무인 운영이 필요한 경우

---

## 권고

| 일 송장 건수 | 권고 방식 |
|---|---|
| ~50건 | Power Automate Desktop (즉시 구축) |
| 50~100건 | Playwright 스크립트 (`scripts/cj-sync.ts` 형태로 레포 내 관리) |
| 100건+ | CJ Open API 계약 → server action으로 직접 발번 |

---

## 우리 시스템 측 통합 지점 (어떤 옵션이든 공통)

- **다운로드**: `shipping/page.tsx` `downloadCjExcel()` — 발송 대상 엑셀 생성
- **업로드(임포트)**: `shipping/page.tsx` `handleImportFile()` — 송장번호 채워진 엑셀 임포트
- **개별 업데이트 액션**: `src/lib/shipping-actions.ts` `updateShipment()` — `tracking_number`, `status='SHIPPED'` 갱신
- **추적 동기화**: `/api/shipping/track` (SweetTracker) — 이미 일괄 업데이트 버튼이 사용 중

CJ Open API 도입 시 신규로 만들 것:
- `src/lib/cj-actions.ts`
  - `requestCjTrackingNumbers(shipmentIds: string[])` — 발번 요청 → 응답으로 `tracking_number` 채워서 `shipments` 일괄 업데이트
  - `cancelCjTrackingNumber(shipmentId)` — 송장 취소
- `shipping/page.tsx`에 "CJ 송장 자동 발번" 버튼 추가 (선택된 발송 대상 일괄)

---

## 의사결정에 필요한 정보

1. CJ대한통운과의 계약 형태 (B2B 계약 상태인지, 일반 개인사업자 계약인지)
2. 일 평균 송장 건수
3. 자동화 실행 환경 (점원 PC vs 서버 무인 배치)
4. CJ 사이트 로그인 시 캡차/SMS 인증 여부

위 4가지가 정해지면 어느 옵션이 가능/최적인지 확정 가능.
