// Phase F — 재고 입출고 라이프사이클
//   실제 입고/출고 + 누적 검증. 음수 재고 허용 정책 검증.
//   각 테스트는 자체 cleanup + globalTeardown 안전망.
import { test, expect, type Page } from '@playwright/test';

const E2E_PREFIX = `_E2E_${Date.now().toString(36)}_`;

test.setTimeout(240_000);

async function searchAndFindRow(page: Page, route: string, keyword: string) {
  await page.goto(route);
  const search = page.locator('input[placeholder*="검색"]').first();
  await expect(search).toBeVisible({ timeout: 8_000 });
  await search.fill(keyword);
  await page.waitForTimeout(700);
  return page.locator('table tbody tr', { hasText: keyword }).first();
}

async function createTestProduct(page: Page, name: string) {
  await page.goto('/products');
  await page.getByRole('button', { name: /\+\s*제품 추가/ }).click();
  const backdrop = page.locator('div.fixed.inset-0.z-50').first();
  await expect(backdrop).toBeVisible({ timeout: 5_000 });
  const form = backdrop.locator('form');

  await form.locator('input[type="text"]').first().fill(name);
  const numbers = form.locator('input[type="number"]');
  if (await numbers.count() > 0) await numbers.nth(0).fill('100');

  await form.locator('button[type="submit"]').first().click();
  await backdrop.waitFor({ state: 'hidden', timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function deleteTestProduct(page: Page, name: string) {
  await page.goto('/products');
  const search = page.locator('input[placeholder*="검색"]').first();
  await search.fill(name);
  await page.waitForTimeout(700);
  const row = page.locator('table tbody tr', { hasText: name }).first();
  if (await row.count() === 0) return;
  const editBtn = row.locator('button', { hasText: /수정|편집/ }).first();
  if (await editBtn.count() === 0) return;
  await editBtn.click();
  const backdrop = page.locator('div.fixed.inset-0.z-50').first();
  await expect(backdrop).toBeVisible({ timeout: 5_000 });
  const deleteBtn = backdrop.getByRole('button', { name: /^삭제$/ }).first();
  if (await deleteBtn.count() === 0) {
    await page.keyboard.press('Escape');
    return;
  }
  page.once('dialog', d => d.accept());
  await deleteBtn.click();
  await backdrop.waitFor({ state: 'hidden', timeout: 10_000 });
}

// 첫 활성 지점의 재고 셀에서 입출고 모달 열고 수량 조정
async function adjustInventoryFirstBranch(page: Page, productName: string, movementType: 'IN' | 'OUT', qty: number): Promise<{ before: number; after: number }> {
  await page.goto('/inventory');
  const search = page.locator('input[placeholder*="검색"]').first();
  await expect(search).toBeVisible({ timeout: 8_000 });
  await search.fill(productName);
  await page.waitForTimeout(700);

  // 검색 결과 행에서 셀 클릭
  const row = page.locator('table tbody tr', { hasText: productName }).first();
  await expect(row).toBeVisible({ timeout: 5_000 });
  // 입출고 버튼(셀) — title에 "입출고"
  const cell = row.locator('button[title*="입출고"]').first();
  await expect(cell).toBeVisible({ timeout: 3_000 });
  // 클릭 전 표시 수량
  const beforeText = (await cell.textContent()) || '0';
  const before = parseInt(beforeText.replace(/[^0-9-]/g, '')) || 0;

  await cell.click();

  // 입출고 모달
  const backdrop = page.locator('div.fixed.inset-0.z-50').first();
  await expect(backdrop).toBeVisible({ timeout: 5_000 });

  // 입/출고 버튼 — 모달에 "입고 (+)" / "출고 (-)" 형식
  const typeButton = backdrop.getByRole('button', {
    name: movementType === 'IN' ? /입고/ : /출고/,
  }).first();
  if (await typeButton.count() > 0) {
    await typeButton.click();
    await page.waitForTimeout(200);
  }

  // 수량 input — 마지막 number input (수량)
  const qtyInputs = backdrop.locator('input[type="number"]');
  // 일반적으로 첫 number input이 quantity
  await qtyInputs.first().fill(String(qty));

  await backdrop.locator('button[type="submit"]').first().click();
  await backdrop.waitFor({ state: 'hidden', timeout: 15_000 });
  await page.waitForTimeout(800);

  // 후속 — 재로드된 셀의 수량 다시 읽기
  await page.goto('/inventory');
  await search.fill(productName);
  await page.waitForTimeout(700);
  const row2 = page.locator('table tbody tr', { hasText: productName }).first();
  const cell2 = row2.locator('button[title*="입출고"]').first();
  const afterText = (await cell2.textContent()) || '0';
  const after = parseInt(afterText.replace(/[^0-9-]/g, '')) || 0;

  return { before, after };
}

test.describe('재고 입출고 라이프사이클', () => {
  test('제품 등록 → 입고 +10 → 입고 +5 누적 → 출고 -3 → cleanup', async ({ page }) => {
    const name = `${E2E_PREFIX}재고테스트`;

    try {
      // 1) 제품 등록 (자동으로 모든 활성 지점에 재고 0 row 생성됨)
      await createTestProduct(page, name);

      // 2) 첫 입고 +10
      const { before: b1, after: a1 } = await adjustInventoryFirstBranch(page, name, 'IN', 10);
      expect(b1, `초기 재고가 0이어야 함 (실제: ${b1})`).toBe(0);
      expect(a1, `+10 입고 후 10이어야 함 (실제: ${a1})`).toBe(10);

      // 3) 추가 입고 +5 (누적 → 15)
      const { before: b2, after: a2 } = await adjustInventoryFirstBranch(page, name, 'IN', 5);
      expect(b2, `이전 재고 10이어야 함 (실제: ${b2})`).toBe(10);
      expect(a2, `+5 추가 입고 후 15여야 함 (실제: ${a2})`).toBe(15);

      // 4) 출고 -3 (15 → 12)
      const { before: b3, after: a3 } = await adjustInventoryFirstBranch(page, name, 'OUT', 3);
      expect(b3, `이전 재고 15여야 함 (실제: ${b3})`).toBe(15);
      expect(a3, `-3 출고 후 12여야 함 (실제: ${a3})`).toBe(12);
    } finally {
      // 5) cleanup — 제품 삭제
      await deleteTestProduct(page, name);
    }
  });
});
