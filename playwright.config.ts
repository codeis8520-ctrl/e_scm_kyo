import { defineConfig, devices } from '@playwright/test';

// 환경변수
//   E2E_BASE_URL  - 테스트 대상 URL (기본: http://localhost:3000)
//   E2E_LOGIN_ID  - 로그인 아이디
//   E2E_PASSWORD  - 비밀번호
//   CI            - true면 fail 시 retry
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,            // 인증 setup 의존성 때문에 직렬
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    storageState: 'tests/e2e/.auth/state.json',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'], storageState: undefined },
    },
    {
      name: 'smoke',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts$/,
    },
  ],

  // 로컬 실행 시 dev 서버 자동 기동 (CI에선 외부 URL을 직접 지정)
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000/login',
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
