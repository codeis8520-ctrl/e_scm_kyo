import { defineConfig, devices } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// .env.test.local 자동 로드 — dotenv 의존성 없이 간단 파싱.
//   key=value 형식 한 줄 단위. 따옴표·이스케이프는 지원하지 않음(단순용).
//   이미 설정된 환경변수는 덮어쓰지 않음 (CI에서 secrets가 우선).
function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadEnvFile(path.resolve(__dirname, '.env.test.local'));

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
    // storageState는 smoke 프로젝트에만 적용 — setup이 이 파일을 생성하므로 setup엔 없어야 함
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'smoke',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/state.json',
      },
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
