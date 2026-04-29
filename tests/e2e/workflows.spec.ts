// 핵심 워크플로우 테스트 (Phase B)
//   각 테스트는 page.goto()로 fresh page를 받으므로 모달 cleanup 불필요.
//   진짜 결제·재고 차감은 운영 데이터에 영향 주므로 제외.
import { test, expect } from '@playwright/test';

test.describe('카테고리 트리 (시스템 코드)', () => {
  test('트리 뷰에 [경로코드] + 이름이 노출되고 행별 액션이 보인다', async ({ page }) => {
    await page.goto('/system-codes');
    await page.getByRole('button', { name: /^카테고리$|^분류$/ }).first().click();

    await expect(page.locator('body')).toContainText('품목 계층');

    // 트리 행에 [숫자] / [숫자-숫자] 형식 코드 — font-mono span 안에
    const codeBadges = page.locator('span.font-mono', { hasText: /^\[\d+(-\d+)*\]$/ });
    await expect(codeBadges.first()).toBeVisible({ timeout: 8_000 });

    // 행 단위 액션
    await expect(page.getByRole('button', { name: /^수정$/ }).first()).toBeVisible();
  });
});

test.describe('POS — 카트 동작 (결제 없음)', () => {
  test('제품 카드 클릭 시 결제 금액이 0보다 큰 값으로 갱신된다', async ({ page }) => {
    await page.goto('/pos');
    await expect(page.getByRole('button', { name: /^결제\s*\(/ })).toBeVisible({ timeout: 8_000 });

    // 첫 활성 제품 카드 — POS 화면의 제품 그리드는 가격에 "원" 포함된 button
    // disabled가 아닌 그리드 카드 (재고 0이 아님)
    const productGrid = page.locator('div.grid');
    const firstProduct = productGrid.locator('button:not([disabled])', { hasText: '원' }).first();
    await expect(firstProduct).toBeVisible({ timeout: 8_000 });
    await firstProduct.click();
    await page.waitForTimeout(400);

    await expect(page.getByRole('button', { name: '전체 삭제' })).toBeVisible({ timeout: 5_000 });

    const payText = (await page.getByRole('button', { name: /^결제\s*\(/ }).textContent()) || '';
    expect(payText, `결제 버튼이 0원: ${payText}`).not.toMatch(/결제\s*\(\s*0\s*원/);
  });

  test('수량 + 버튼 클릭 시 결제 금액이 증가한다', async ({ page }) => {
    await page.goto('/pos');
    const productGrid = page.locator('div.grid');
    const firstProduct = productGrid.locator('button:not([disabled])', { hasText: '원' }).first();
    await expect(firstProduct).toBeVisible({ timeout: 8_000 });
    await firstProduct.click();
    await expect(page.getByRole('button', { name: '전체 삭제' })).toBeVisible({ timeout: 5_000 });

    // 카트 내 + 버튼 — 정확히 "+" 텍스트인 버튼
    const plusBtn = page.locator('button').filter({ hasText: /^\+$/ }).first();
    await expect(plusBtn).toBeVisible({ timeout: 5_000 });

    const payBefore = (await page.getByRole('button', { name: /^결제\s*\(/ }).textContent()) || '';
    await plusBtn.click();
    await page.waitForTimeout(300);
    const payAfter = (await page.getByRole('button', { name: /^결제\s*\(/ }).textContent()) || '';

    expect(payAfter, `+ 클릭 전후 동일\nbefore=${payBefore}\nafter=${payAfter}`).not.toBe(payBefore);
  });
});

test.describe('제품 등록 모달', () => {
  test('+ 제품 추가 → 모달 안에 4개 유형 버튼 노출', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('button', { name: /\+\s*제품 추가/ }).click();

    const modal = page.locator('form').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    for (const t of ['완제품', '원자재', '부자재', '무형상품']) {
      await expect(modal.getByRole('button', { name: t, exact: true })).toBeVisible();
    }

    // 카테고리 select가 모달 안에 존재 (카테고리 데이터 로드 대기)
    const categorySelect = modal.locator('select').first();
    await expect(categorySelect).toBeVisible({ timeout: 3_000 });
  });

  test('완제품 → 부자재 전환 시 바코드 input이 사라지고 안내 문구로 바뀐다', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('button', { name: /\+\s*제품 추가/ }).click();

    const modal = page.locator('form').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const barcodeInput = modal.locator('input[placeholder*="바코드"]');
    await expect(barcodeInput).toBeVisible({ timeout: 3_000 });

    await modal.getByRole('button', { name: '부자재', exact: true }).click();
    await page.waitForTimeout(300);

    await expect(barcodeInput).toBeHidden({ timeout: 3_000 });
    await expect(modal.getByText('바코드는 완제품 유형에서만 입력')).toBeVisible({ timeout: 3_000 });
  });
});

test.describe('고객 등록 모달', () => {
  test('+ 고객 추가 → 모달의 필수 필드 라벨이 보인다', async ({ page }) => {
    await page.goto('/customers');
    await page.getByRole('button', { name: /\+\s*고객 추가/ }).click();

    await expect(page.getByRole('heading', { name: /고객 등록|고객 추가|고객 수정/ })).toBeVisible({ timeout: 5_000 });

    const modal = page.locator('form').last();
    await expect(modal.locator('label', { hasText: /이름/ }).first()).toBeVisible();
    await expect(modal.locator('label', { hasText: /연락처|전화/ }).first()).toBeVisible();
  });

  test('엑셀 일괄 등록 모달 → 양식 다운로드 링크 + 파일 선택 버튼', async ({ page }) => {
    await page.goto('/customers');
    await page.getByRole('button', { name: /엑셀 일괄 등록/ }).click();

    await expect(page.locator('a[href*="/api/customers/import-template"]')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('button', { name: '파일 선택' })).toBeVisible();
  });
});

test.describe('재고 이력 모달', () => {
  test('피벗 뷰 제품명 클릭 → "재고 변동 이력" 모달 열림', async ({ page }) => {
    await page.goto('/inventory');
    const firstProductButton = page.locator('button[title*="이력"]').first();
    await expect(firstProductButton).toBeVisible({ timeout: 8_000 });
    await firstProductButton.click();

    await expect(page.getByRole('heading', { name: '재고 변동 이력' })).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('카테고리 필터 동기화', () => {
  test('재고 페이지에 카테고리 select와 유형 필터가 모두 보인다', async ({ page }) => {
    await page.goto('/inventory');

    await expect(page.locator('option', { hasText: '전체 카테고리' })).toHaveCount(1, { timeout: 5_000 });

    for (const label of ['전체', '완제품', '원자재', '부자재', '무형상품']) {
      await expect(page.getByRole('button', { name: label, exact: true }).first()).toBeVisible();
    }
  });
});
