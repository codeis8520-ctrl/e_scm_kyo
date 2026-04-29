# E2E Smoke Tests (Playwright)

각 네비게이션 메뉴가 깨지는 회귀를 잡는 안전망.

## 검증 항목 (메뉴당)
- HTTP 응답 < 400
- 본문에 페이지 핵심 키워드 노출 (예: 재고 페이지 → "재고")
- 좌측 nav/사이드바 렌더 (로그인 + 레이아웃 정상)
- 콘솔 에러 / pageerror 0건 (광고 차단·HMR 노이즈 무시)
- 같은 도메인 5xx 응답 0건

## 로컬 실행

### 1) 설치 (첫 1회)
```bash
npm install
npx playwright install chromium
```

### 2) 환경변수 설정
```bash
# 운영 또는 로컬 — 둘 중 하나
export E2E_BASE_URL=https://e-scm-kyo.vercel.app   # 비우면 npm run dev 자동 기동
export E2E_LOGIN_ID=test@test.com
export E2E_PASSWORD=********
```

> Windows PowerShell: `$env:E2E_LOGIN_ID="..."`

### 3) 실행
```bash
npm run test:e2e          # 전체 스모크
npm run test:e2e:ui       # 대화형 UI 모드 (디버깅)
npm run test:e2e:report   # 마지막 실행 HTML 리포트
```

## CI에서 실행
GitHub Actions secrets에 `E2E_LOGIN_ID`, `E2E_PASSWORD` 등록 후
`.github/workflows/e2e-smoke.yml` 활성화 (선택).

## 추가 메뉴가 생기면
`tests/e2e/navigation.smoke.spec.ts`의 `MENUS` 배열에 한 줄 추가.
`layout.tsx` ALL_NAV_ITEMS와 함께 갱신할 것.

## Tip
- `--workers=1` (기본) — 인증 storageState 충돌 방지
- 첫 실행 후 `tests/e2e/.auth/state.json` 생성됨 (gitignore)
- 실패 시 `playwright-report/` HTML, `test-results/` 비디오/스크린샷 자동 생성
