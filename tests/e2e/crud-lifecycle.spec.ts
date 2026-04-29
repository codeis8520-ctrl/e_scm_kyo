// Phase E — 안전한 CRUD 라이프사이클
//   실제 등록 → 검증 → 즉시 삭제. globalTeardown(global.teardown.ts)이
//   _E2E_* 잔존을 일괄 정리하므로 라이프사이클 cleanup이 실패해도 안전.
//   타임스탬프 기반 unique 식별자로 다른 테스트와 격리.
import { test, expect, type Page } from '@playwright/test';

const E2E_PREFIX = `_E2E_${Date.now().toString(36)}_`;

async function searchAndFindRow(page: Page, route: string, keyword: string) {
  await page.goto(route);
  const search = page.locator('input[placeholder*="검색"]').first();
  await expect(search).toBeVisible({ timeout: 8_000 });
  await search.fill(keyword);
  await page.waitForTimeout(700);
  return page.locator('table tbody tr', { hasText: keyword }).first();
}

async function deleteByName(page: Page, route: string, name: string) {
  await page.goto(route);
  const search = page.locator('input[placeholder*="검색"]').first();
  await expect(search).toBeVisible({ timeout: 8_000 });
  await search.fill(name);
  await page.waitForTimeout(700);
  const row = page.locator('table tbody tr', { hasText: name }).first();
  if (await row.count() === 0) return;
  const editBtn = row.locator('button', { hasText: /수정|편집/ }).first();
  if (await editBtn.count() === 0) return;
  await editBtn.click();
  const modal = page.locator('form').last();
  await expect(modal).toBeVisible({ timeout: 5_000 });
  const deleteBtn = modal.getByRole('button', { name: /^삭제$/ }).first();
  if (await deleteBtn.count() === 0) {
    await page.keyboard.press('Escape');
    return;
  }
  page.once('dialog', d => d.accept());
  await deleteBtn.click();
  await page.waitForTimeout(1500);
}

// ─── 고객 등록 → 검증 → 삭제 ───────────────────────────────────────────────
test.describe('고객 라이프사이클', () => {
  test('등록 → 검색 결과 노출 → 삭제로 cleanup', async ({ page }) => {
    const name = `${E2E_PREFIX}고객${Date.now() % 10000}`;
    const phone = `010-9999-${String(1000 + (Date.now() % 9000)).slice(0, 4)}`;

    // 1) 등록
    await page.goto('/customers');
    await page.getByRole('button', { name: /\+\s*고객 추가/ }).click();
    const modal = page.locator('form').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await modal.locator('input').nth(0).fill(name);
    await modal.locator('input[type="tel"]').fill(phone);
    await modal.getByRole('button', { name: /^등록$/ }).click();
    await expect(modal).toBeHidden({ timeout: 8_000 });

    // 2) 검색으로 노출 확인
    const row = await searchAndFindRow(page, '/customers', phone);
    await expect(row).toBeVisible({ timeout: 8_000 });

    // 3) cleanup — globalTeardown이 안전망. 여기서도 best-effort 시도.
    const link = row.locator('a').first();
    const href = await link.getAttribute('href').catch(() => null);
    if (href && /\/customers\/[a-f0-9]{8}/.test(href)) {
      await page.goto(href);
      await page.waitForTimeout(500);
      const editBtn = page.getByRole('button', { name: /수정|편집/ }).first();
      if (await editBtn.count() > 0) {
        await editBtn.click();
        await page.waitForTimeout(400);
      }
      const deleteBtn = page.getByRole('button', { name: /^삭제$/ }).first();
      if (await deleteBtn.count() > 0) {
        page.once('dialog', d => d.accept());
        await deleteBtn.click();
        await page.waitForTimeout(1200);
      }
    }
  });
});

// ─── 제품 등록 → 자동 재고 row 검증 → 삭제 ────────────────────────────────
test.describe('제품 라이프사이클', () => {
  test('등록 → 제품/재고 페이지 노출 → 삭제 (재고 row cascade)', async ({ page }) => {
    const name = `${E2E_PREFIX}제품${Date.now() % 10000}`;

    // 1) 제품 등록 — 모달은 fixed inset-0 backdrop으로 식별 (form 선택자 충돌 방지)
    await page.goto('/products');
    await page.getByRole('button', { name: /\+\s*제품 추가/ }).click();
    const modalBackdrop = page.locator('div.fixed.inset-0.z-50').first();
    await expect(modalBackdrop).toBeVisible({ timeout: 5_000 });
    const modalForm = modalBackdrop.locator('form');

    await modalForm.locator('input[type="text"]').first().fill(name);
    const numbers = modalForm.locator('input[type="number"]');
    if (await numbers.count() > 0) await numbers.nth(0).fill('1');

    await modalForm.locator('button[type="submit"]').first().click();

    // 모달 backdrop이 사라지거나 모달 안에 에러 메시지가 보일 때까지 대기
    await modalBackdrop.waitFor({ state: 'hidden', timeout: 15_000 });
    // 추가 안전장치 — 닫혔어도 잠시 대기 (state 동기화)
    await page.waitForTimeout(500);

    // 2) 제품 페이지에서 노출 확인
    const productRow = await searchAndFindRow(page, '/products', name);
    await expect(productRow).toBeVisible({ timeout: 8_000 });

    // 3) 재고 페이지에서도 자동 생성된 row 존재 확인
    const invRow = await searchAndFindRow(page, '/inventory', name);
    await expect(invRow).toBeVisible({ timeout: 8_000 });

    // 4) cleanup — best-effort (globalTeardown이 안전망)
    await deleteByName(page, '/products', name);
  });
});
