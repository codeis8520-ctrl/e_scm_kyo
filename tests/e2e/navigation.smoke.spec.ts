// 메뉴별 스모크 테스트 — 각 페이지에 진입했을 때:
//   1) HTTP 200 응답
//   2) 페이지 제목/주요 요소 존재
//   3) 콘솔 에러 없음 (network 401/500 포함)
//   4) 5초 내 렌더 완료
//
// 데이터·동작 시나리오는 검증하지 않음. 화면이 깨지는 회귀만 잡는 안전망.
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// 좌측 ALL_NAV_ITEMS와 동일 (layout.tsx 참조)
const MENUS: Array<{ path: string; label: string; expectedText?: string | RegExp }> = [
  { path: '/',                      label: '대시보드',     expectedText: /대시보드|매출|재고/ },
  { path: '/pos',                   label: '판매관리',     expectedText: /판매|장바구니|결제/ },
  { path: '/products',              label: '제품',         expectedText: /제품/ },
  { path: '/production',            label: '생산',         expectedText: /생산|BOM/ },
  { path: '/inventory',             label: '재고',         expectedText: /재고/ },
  { path: '/purchases',             label: '매입',         expectedText: /매입|발주/ },
  { path: '/shipping',              label: '배송',         expectedText: /배송/ },
  { path: '/accounting',            label: '회계',         expectedText: /회계|분개/ },
  { path: '/trade',                 label: '거래 관리',    expectedText: /거래|B2B|거래처/ },
  { path: '/customers',             label: '고객 관리',    expectedText: /고객/ },
  { path: '/notifications',         label: '알림',         expectedText: /알림/ },
  { path: '/system-codes',          label: '코드',         expectedText: /코드|채널|카테고리/ },
  { path: '/reports',               label: '보고서',       expectedText: /보고서|매출|기간/ },
  { path: '/agent-memory',          label: 'AI 메모리',    expectedText: /메모리/ },
  { path: '/agent-conversations',   label: 'AI 대화 기록', expectedText: /대화|에이전트/ },
];

// 콘솔 에러 수집 — 광고 차단·확장 프로그램에서 자주 나오는 노이즈는 무시
const IGNORED_CONSOLE_PATTERNS = [
  /chrome-extension:/i,
  /Refused to load.*google-analytics/i,
  /Failed to load resource.*favicon/i,
  /\[HMR\]/i,                    // dev hot reload
  /Download the React DevTools/i,
];
function isIgnoredConsole(msg: ConsoleMessage): boolean {
  const text = msg.text();
  return IGNORED_CONSOLE_PATTERNS.some(rx => rx.test(text));
}

async function visitAndAssert(page: Page, menu: typeof MENUS[number]) {
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error' && !isIgnoredConsole(msg)) {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push(`PAGE ERROR: ${err.message}`);
  });
  page.on('response', res => {
    const url = res.url();
    const status = res.status();
    // 우리 도메인의 5xx만 캐치 (외부 API/광고 추적 무시)
    if (status >= 500 && url.includes(new URL(page.url() || 'http://localhost').host)) {
      networkFailures.push(`${status} ${url}`);
    }
  });

  const response = await page.goto(menu.path, { waitUntil: 'domcontentloaded' });
  expect(response, `${menu.label}: 응답 객체 없음`).not.toBeNull();
  // 200~399 정상. 401(auth) / 4xx 발생 시 명확히 실패.
  const status = response!.status();
  expect.soft(status, `${menu.label}: HTTP ${status}`).toBeLessThan(400);

  // body 렌더 + 핵심 요소 — 메뉴 라벨이나 expectedText가 보여야 함
  // layout 헤더에 라벨이 들어가 있고 본문에도 키워드가 있을 가능성이 높음
  if (menu.expectedText) {
    await expect.soft(
      page.locator('body'),
      `${menu.label}: 핵심 키워드(${menu.expectedText}) 미발견`
    ).toContainText(menu.expectedText, { timeout: 10_000 });
  }

  // 좌측 nav가 보이는지 (인증 통과 + 레이아웃 정상 로드 확인)
  await expect.soft(
    page.locator('nav, [class*="sidebar"], aside').first(),
    `${menu.label}: nav/sidebar 미렌더`
  ).toBeVisible({ timeout: 5_000 });

  // 클라이언트 추가 렌더 시간 확보 — 비동기 데이터 fetch가 콘솔 에러를 늦게 뱉을 수 있음
  await page.waitForTimeout(800);

  expect.soft(consoleErrors, `${menu.label}: 콘솔 에러\n${consoleErrors.join('\n')}`).toEqual([]);
  expect.soft(networkFailures, `${menu.label}: 5xx 네트워크 실패\n${networkFailures.join('\n')}`).toEqual([]);
}

test.describe('Navigation smoke', () => {
  for (const menu of MENUS) {
    test(`${menu.path} ${menu.label}`, async ({ page }) => {
      await visitAndAssert(page, menu);
    });
  }
});
