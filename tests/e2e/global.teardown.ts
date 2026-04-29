// globalTeardown — 모든 테스트 종료 후 _E2E_* 접두 데이터 자동 일괄 삭제.
//   라이프사이클 테스트의 cleanup이 실패해도 여기서 안전망으로 정리.
//   설정: playwright.config.ts에서 dependencies로 마지막 실행되도록 등록.
import { test as teardown, expect } from '@playwright/test';

teardown.setTimeout(180_000);

teardown('테스트 데이터 일괄 정리 (_E2E_*)', async ({ page }) => {
  let totalDeleted = 0;

  // 제품
  for (let i = 0; i < 50; i++) {
    await page.goto('/products');
    const search = page.locator('input[placeholder*="검색"]').first();
    if (!(await search.isVisible().catch(() => false))) break;
    await search.fill('_E2E_');
    await page.waitForTimeout(600);

    const row = page.locator('table tbody tr', { hasText: '_E2E_' }).first();
    if (await row.count() === 0) break;

    const editBtn = row.locator('button', { hasText: /수정|편집/ }).first();
    if (await editBtn.count() === 0) break;
    await editBtn.click();
    await page.waitForTimeout(500);

    const modal = page.locator('form').last();
    const deleteBtn = modal.getByRole('button', { name: /^삭제$/ }).first();
    if (await deleteBtn.count() === 0) {
      await page.keyboard.press('Escape');
      break;
    }
    page.once('dialog', d => d.accept());
    await deleteBtn.click();
    await page.waitForTimeout(1200);
    totalDeleted++;
  }

  // 고객
  for (let i = 0; i < 50; i++) {
    await page.goto('/customers');
    const search = page.locator('input[placeholder*="검색"]').first();
    if (!(await search.isVisible().catch(() => false))) break;
    await search.fill('_E2E_');
    await page.waitForTimeout(600);

    const link = page.locator('a').filter({ hasText: '_E2E_' }).first();
    if (await link.count() === 0) break;
    const href = await link.getAttribute('href');
    if (!href || !/\/customers\/[a-f0-9]{8}/.test(href)) break;

    await page.goto(href);
    await page.waitForTimeout(500);

    const editBtn = page.getByRole('button', { name: /수정|편집/ }).first();
    if (await editBtn.count() > 0) {
      await editBtn.click();
      await page.waitForTimeout(400);
    }
    const deleteBtn = page.getByRole('button', { name: /^삭제$/ }).first();
    if (await deleteBtn.count() === 0) break;
    page.once('dialog', d => d.accept());
    await deleteBtn.click();
    await page.waitForTimeout(1200);
    totalDeleted++;
  }

  console.log(`[teardown] _E2E_* 데이터 ${totalDeleted}건 정리`);
});
