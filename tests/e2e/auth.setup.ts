// 인증 setup — 한 번 로그인하고 storageState를 저장. 모든 spec에서 재사용.
//   환경변수 E2E_LOGIN_ID, E2E_PASSWORD 필요. 미설정 시 명확한 에러로 종료.
import { test as setup, expect } from '@playwright/test';

const STATE_PATH = 'tests/e2e/.auth/state.json';

setup('authenticate', async ({ page }) => {
  const loginId = process.env.E2E_LOGIN_ID;
  const password = process.env.E2E_PASSWORD;
  if (!loginId || !password) {
    throw new Error(
      'E2E_LOGIN_ID, E2E_PASSWORD 환경변수가 필요합니다. ' +
      '예: E2E_LOGIN_ID=test@test.com E2E_PASSWORD=*** npm run test:e2e'
    );
  }

  await page.goto('/login');

  // 로그인 폼 입력 — 실제 폼의 name 속성 기준
  await page.fill('input[name="login_id"]', loginId);
  await page.fill('input[name="password"]', password);

  // 제출 + 성공 시 대시보드로 리다이렉트되는지 확인
  await Promise.all([
    page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);

  // 보호된 화면이 실제로 렌더되는지 (로그인 페이지로 다시 튕기지 않는지) 확인
  await expect(page).not.toHaveURL(/\/login/);

  // 세션 쿠키 + localStorage 등 보존
  await page.context().storageState({ path: STATE_PATH });
});
