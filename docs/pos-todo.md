# POS 관련 작업 예정

> 최종 업데이트: 2026-04-04  
> 배포 환경: **Vercel**

---

## 완료된 작업

- [x] POS 기본 결제 흐름 (현금/카드/카카오) — 카드 기본값
- [x] 바코드 스캔 + 제품 검색
- [x] 고객 연동 (포인트 사용/적립)
- [x] 빠른 고객 등록
- [x] 할인 기능 (금액 / % 토글)
- [x] 영수증 출력 (프린트)
- [x] 환불 처리
- [x] 모바일 슬라이드업 장바구니
- [x] VAN 카드 단말기 연동 인프라 구축
- [x] 가상 단말기 테스트 모드 (`/api/card-terminal/mock`)

---

## ⚡ VAN 에이전트 수령 시 즉시 적용 절차

### Step 1 — Vercel 환경변수 설정

`.env.local` 이 아닌 **Vercel 대시보드**에서 설정:

```
Vercel 대시보드 → 프로젝트 → Settings → Environment Variables

키:   NEXT_PUBLIC_CARD_TERMINAL_URL
값:   http://localhost:7001         ← 에이전트 포트로 교체
환경: Production, Preview, Development 모두 체크
```

설정 후 **Redeploy** 필수 (환경변수는 빌드 시 번들에 포함됨).

---

### ⚠️ CORS 문제 — Vercel 환경 필수 확인

**문제**: Vercel은 HTTPS(`https://앱.vercel.app`)로 서비스됨.  
브라우저가 `https` 페이지에서 `http://localhost:7001` 을 호출하면  
VAN 에이전트가 **CORS 헤더를 응답**해야 함.  
한국 VAN 에이전트는 로컬 Windows 소프트웨어 전용으로 만들어져 CORS 미지원 가능성 높음.

**에이전트 수령 후 먼저 확인할 것**:

```
브라우저 개발자도구(F12) → Console 탭에서
"CORS" 또는 "Access-Control-Allow-Origin" 오류 여부 확인
```

---

### CORS 문제 발생 시 해결책

#### 방법 A — 로컬 CORS 프록시 (권장)

POS PC에 아래 Node.js 스크립트를 시작프로그램에 등록:

```js
// cors-proxy.js  (Node.js 필요, 없으면 https://nodejs.org 설치)
const http = require('http');

const TARGET_PORT = 7001;   // VAN 에이전트 포트
const PROXY_PORT  = 7002;   // 브라우저가 호출할 포트

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const options = {
      hostname: 'localhost', port: TARGET_PORT,
      path: req.url, method: req.method,
      headers: { ...req.headers, host: `localhost:${TARGET_PORT}` },
    };
    const proxy = http.request(options, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    proxy.on('error', () => {
      res.writeHead(502);
      res.end(JSON.stringify({ resultCode: 'ERR', resultMsg: 'VAN 에이전트 연결 실패' }));
    });
    proxy.write(body);
    proxy.end();
  });
}).listen(PROXY_PORT, () => console.log(`CORS proxy: ${PROXY_PORT} → ${TARGET_PORT}`));
```

실행: `node cors-proxy.js`  
시작프로그램 등록: `Win + R → shell:startup → 바로가기 생성`

Vercel 환경변수를 프록시 포트로 설정:
```
NEXT_PUBLIC_CARD_TERMINAL_URL=http://localhost:7002
```

#### 방법 B — VAN사에 CORS 지원 여부 문의

일부 최신 에이전트는 CORS를 지원함. VAN사에 문의:  
> "웹 브라우저(HTTPS)에서 로컬 에이전트 HTTP 호출 시 CORS 헤더 지원 가능한가요?"

지원된다면 프록시 불필요, 직접 연결 가능.

---

### Step 2 — 응답 필드명 확인 (필요 시만)

에이전트 문서의 응답 필드명과 비교:

| 항목 | 현재 코드 인식 후보 |
|------|-------------------|
| 성공코드 | `resultCode`, `ResultCode`, `code`, `resCd`, `result` |
| 성공값 | `0000`, `00`, `000`, `SUCCESS`, `APPROVED`, `OK` |
| 승인번호 | `approvalNo`, `ApprovalNo`, `approval_no`, `authNo`, `AuthNo` |
| 카드사명 | `cardName`, `CardName`, `card_name`, `issuerName` |
| 카드번호 | `cardNo`, `CardNo`, `card_no`, `maskedCardNo` |
| 할부 | `installment`, `Installment`, `quota` |
| 오류메시지 | `resultMsg`, `ResultMsg`, `message`, `errMsg` |

목록에 없는 필드명이면 `src/lib/card-terminal.ts` 의 해당 `pick()` 에 추가.

### Step 3 — 테스트 체크리스트

- [ ] CORS 오류 없이 승인 요청 전달됨
- [ ] 카드 승인 정상 흐름
- [ ] 카드 승인 거절 처리
- [ ] 타임아웃 60초 후 에러 메시지
- [ ] 영수증 승인번호 · 카드정보 출력

### Step 4 — Supabase migration 011 적용

```sql
-- Supabase SQL Editor에서 실행 (아직 미적용)
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS approval_no  VARCHAR(20)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS card_info    VARCHAR(100) DEFAULT NULL;
```

### Step 5 — Windows 시작프로그램 등록

- VAN 에이전트 바로가기: `Win + R → shell:startup`
- CORS 프록시 사용 시 `cors-proxy.js` 도 함께 등록

---

## 추후 검토 항목

- [ ] **카드 취소(환불) 자동 연동**
  - `src/app/(dashboard)/pos/RefundModal.tsx` → `requestCardCancel()` 호출 추가
  - 원승인번호: `sales_orders.approval_no` 에서 조회
- [ ] **할부 선택 UI** — 현재 일시불(`00`) 고정
  - 카드 선택 시 0/3/6/12개월 버튼 추가
- [ ] **오프라인 모드** — 네트워크 단절 시 임시 저장 후 복구

---

## 단말기 정보

| 항목 | 내용 |
|------|------|
| 제조사 | O2CHECK |
| 모델 | SWT-3100A |
| 연결 | LAN (유선) |
| VAN사 | 확인 필요 — O2CHECK 고객센터 1588-1948 |
| 연동 방식 | 로컬 HTTP 에이전트 → `http://localhost:포트` |

## 주요 파일 위치

| 파일 | 역할 |
|------|------|
| `src/lib/card-terminal.ts` | VAN 에이전트 통신, 필드명 매핑 |
| `src/app/api/card-terminal/mock/route.ts` | 테스트용 가상 단말기 |
| `src/app/(dashboard)/pos/page.tsx` | POS UI, 카드 승인 흐름 |
| `src/app/(dashboard)/pos/ReceiptModal.tsx` | 영수증, 승인번호 표시 |
| `src/lib/actions.ts` → `processPosCheckout()` | DB 저장 |
| `supabase/migrations/011_card_approval.sql` | DB 컬럼 추가 (미적용) |
| `docs/cors-proxy.js` | CORS 프록시 스크립트 (필요 시 사용) |
