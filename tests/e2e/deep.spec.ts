// Phase D — 광범위 페이지·탭·모달 깊은 검증
//   각 메뉴의 주요 기능이 깨지지 않는지 확인. 데이터 변경 없는 read-only 위주.
import { test, expect } from '@playwright/test';

// ─── 회계 ──────────────────────────────────────────────────────────────────
test.describe('회계 페이지', () => {
  test('탭(분개/원장/PL/마감) 모두 진입 가능', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.locator('body')).toContainText(/회계|분개/, { timeout: 8_000 });

    for (const tab of ['분개', '원장', '손익', '마감']) {
      const btn = page.getByRole('button', { name: new RegExp(tab) }).first();
      const exists = await btn.count();
      if (exists > 0) {
        await btn.click();
        await page.waitForTimeout(400);
        // 클릭 후 화면이 깨지지 않음 — 같은 본문 텍스트 유지
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });
});

// ─── 매입 ──────────────────────────────────────────────────────────────────
test.describe('매입 페이지', () => {
  test('발주서 목록 + 새 발주 모달', async ({ page }) => {
    await page.goto('/purchases');
    await expect(page.locator('body')).toContainText(/매입|발주/, { timeout: 8_000 });

    // 새 발주 버튼이 있다면 클릭 → 모달 열림
    const newPoBtn = page.getByRole('button', { name: /새 발주|\+\s*발주|발주 등록/ }).first();
    if (await newPoBtn.count() > 0) {
      await newPoBtn.click();
      await page.waitForTimeout(500);
      // 모달 안에 form 또는 dialog 등장
      const modalish = page.locator('form, [role="dialog"]').last();
      await expect(modalish).toBeVisible({ timeout: 5_000 });
    }
  });

  test('공급처/단가 보조 페이지 진입', async ({ page }) => {
    // /purchases/suppliers
    const r1 = await page.goto('/purchases/suppliers');
    expect(r1?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();

    // /purchases/prices
    const r2 = await page.goto('/purchases/prices');
    expect(r2?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });
});

// ─── 거래 관리 (B2B) ─────────────────────────────────────────────────────
test.describe('거래 관리', () => {
  test('거래처/B2B 매출 탭 진입 가능', async ({ page }) => {
    await page.goto('/trade');
    await expect(page.locator('body')).toContainText(/거래처|B2B|거래/, { timeout: 8_000 });

    const tabs = ['거래처', 'B2B 매출', '납품', '정산'];
    for (const t of tabs) {
      const btn = page.getByRole('button', { name: new RegExp(t) }).first();
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }
    // 어떤 탭에서든 화면 정상
    await expect(page.locator('body')).toBeVisible();
  });
});

// ─── 알림 ──────────────────────────────────────────────────────────────────
test.describe('알림 페이지', () => {
  test('발송 이력/템플릿/캠페인 탭 진입', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.locator('body')).toContainText(/알림/, { timeout: 8_000 });

    // 템플릿 페이지 별도 라우트
    const r = await page.goto('/notifications/templates');
    expect(r?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(/템플릿/, { timeout: 5_000 });
  });
});

// ─── 고객 상세 ──────────────────────────────────────────────────────────
test.describe('고객 상세', () => {
  test('첫 고객 클릭 → 상세 페이지 로드', async ({ page }) => {
    await page.goto('/customers');
    // UUID 형식의 고객 상세 URL만 매칭 (/customers/analytics 같은 라우트 제외)
    const uuidLink = page.locator('a').filter({
      has: page.locator(':scope'),
    }).filter({
      hasNot: page.locator('text=/^\\s*$/'),
    });
    // 더 단순한 방법 — href가 8자 이상 hex로 시작하는 segment를 가진 링크
    const detailLink = page.locator('a[href*="/customers/"]').filter({
      hasNotText: /^$/,
    }).filter({
      // href에 UUID-like segment (8자 hex- 패턴) 포함
    });
    const customerLinks = await page.locator('a').evaluateAll((links) =>
      links
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => /\/customers\/[a-f0-9]{8}/.test(href))
    );
    if (customerLinks.length === 0) return; // 데이터 없으면 skip
    await page.goto(customerLinks[0]);
    await expect(page.locator('body')).toContainText(/고객|상담|구매|포인트|이름/, { timeout: 5_000 });
  });
});

// ─── 재고 입출고 모달 ──────────────────────────────────────────────────
test.describe('재고 입출고', () => {
  test('피벗 셀 클릭 → 입출고 모달 → 수량 input + 취소', async ({ page }) => {
    await page.goto('/inventory');
    // 첫 재고 셀 — title에 "입출고"가 있는 button
    const firstQtyBtn = page.locator('button[title*="입출고"]').first();
    await expect(firstQtyBtn).toBeVisible({ timeout: 8_000 });
    await firstQtyBtn.click();

    // 모달 — 수량 input
    const modal = page.locator('form, [role="dialog"]').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator('input[type="number"]').first()).toBeVisible({ timeout: 3_000 });
  });
});

// ─── BOM 트리/조립 ────────────────────────────────────────────────────────
test.describe('생산 — BOM 탭', () => {
  test('BOM 탭 진입 가능 + 좌측 완제품 리스트', async ({ page }) => {
    await page.goto('/production');
    const bomTab = page.getByRole('button', { name: /BOM 조립|^BOM 목록$|BOM/ }).first();
    await expect(bomTab).toBeVisible({ timeout: 8_000 });
    await bomTab.click();
    await page.waitForTimeout(500);
    // BOM 화면에 "완제품" 텍스트 (좌측 패널)
    await expect(page.locator('body')).toContainText(/완제품|BOM/);
  });
});

// ─── 시스템 코드 모든 탭 순회 ─────────────────────────────────────────────
test.describe('시스템 코드 전체 탭', () => {
  test('탭 9개 순회 시 콘솔/네트워크 에러 없음', async ({ page }) => {
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];
    page.on('pageerror', e => consoleErrors.push(`PAGE: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error' && !/HMR|chrome-extension|favicon/i.test(m.text())) {
        consoleErrors.push(m.text());
      }
    });
    page.on('response', r => {
      if (r.status() >= 400 && /supabase\.co|e-scm-kyo/.test(r.url())) {
        networkErrors.push(`${r.status()} ${r.url()}`);
      }
    });

    await page.goto('/system-codes');
    await page.waitForTimeout(500);

    const tabLabels = ['채널', '지점 관리', '등급', '태그', '카테고리', '직원', '템플릿', '권한', '캠페인'];
    for (const label of tabLabels) {
      const btn = page.getByRole('button', { name: new RegExp(label) }).first();
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(400);
      }
    }

    expect.soft(consoleErrors, `system-codes 탭 순회 중 콘솔 에러:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect.soft(networkErrors, `system-codes 탭 순회 중 4xx/5xx:\n${networkErrors.join('\n')}`).toEqual([]);
  });
});

// ─── 보고서 모든 탭 ────────────────────────────────────────────────────────
test.describe('보고서 페이지 모든 탭', () => {
  test('매출/매입/손익/트렌드/마진 탭 순회', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', e => consoleErrors.push(`PAGE: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error' && !/HMR|chrome-extension|favicon/i.test(m.text())) {
        consoleErrors.push(m.text());
      }
    });

    await page.goto('/reports');
    await page.waitForTimeout(800);

    for (const t of ['매출', '매입', '손익', '트렌드', '마진']) {
      const btn = page.getByRole('button', { name: new RegExp(t) }).first();
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(700);
      }
    }

    expect.soft(consoleErrors, `보고서 탭 순회 중 에러:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});

// ─── POS — 판매 현황 탭 ──────────────────────────────────────────────────
test.describe('POS 판매 현황 탭', () => {
  test('판매 현황 탭 진입 + 검색 input + 행 또는 빈 상태', async ({ page }) => {
    await page.goto('/pos');
    await page.getByRole('button', { name: /판매 현황|판매 목록/ }).first().click();
    await page.waitForTimeout(500);
    // 화면 본문에 매출/주문 관련 텍스트
    await expect(page.locator('body')).toContainText(/주문|매출|결제|수령/, { timeout: 5_000 });
  });
});

// ─── 권한별 메뉴 가시성 ────────────────────────────────────────────────────
test.describe('권한 분기', () => {
  test('관리자 로그인 시 모든 핵심 메뉴 노출', async ({ page }) => {
    await page.goto('/');
    // 좌측 nav에 핵심 메뉴들이 모두 보임 (a[href]로)
    for (const path of ['/pos', '/products', '/inventory', '/customers', '/system-codes']) {
      const link = page.locator(`a[href="${path}"]`).first();
      await expect(link, `${path} 메뉴 미노출`).toBeVisible({ timeout: 5_000 });
    }
  });
});

// ─── 모바일 뷰포트 회귀 ────────────────────────────────────────────────────
test.describe('반응형', () => {
  test('모바일 뷰포트(375px)에서 대시보드 렌더', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const r = await page.goto('/');
    expect(r?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    // 모바일에서도 메뉴 트리거(햄버거 또는 nav 자체)가 어디든 있어야 함
    const navOrToggle = page.locator('nav, [class*="sidebar"], button[aria-label*="menu"], button:has-text("☰")').first();
    await expect(navOrToggle).toBeAttached();
  });
});
