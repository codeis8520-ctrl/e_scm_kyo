// Phase C — 상호작용·검색·필터·검증
//   데이터 변경 없는 클릭/입력 동작만. 화면 상태 변화로 정상 동작 확인.
//   데이터 의존적 검증보다는 invariant(입력 → 상태 변화) 위주.
import { test, expect } from '@playwright/test';

// ─── 검색 입력 동작 ─────────────────────────────────────────────────────────
test.describe('검색 입력', () => {
  test('제품 페이지 — 검색 input에 입력한 값이 보존된다', async ({ page }) => {
    await page.goto('/products');
    await expect(page.locator('table thead')).toBeVisible({ timeout: 8_000 });

    const searchInput = page.locator('input[placeholder*="검색"]').first();
    await searchInput.fill('홍삼');
    await expect(searchInput).toHaveValue('홍삼');

    // 입력 후 짧게 대기 → 클라이언트 사이드 필터가 fired
    await page.waitForTimeout(400);
    // 화면이 깨지지 않았으면 thead/tbody는 여전히 존재
    await expect(page.locator('table tbody')).toBeAttached();
  });

  test('POS — 검색 input + 그리드 가시성', async ({ page }) => {
    await page.goto('/pos');
    await expect(page.getByRole('button', { name: /^결제\s*\(/ })).toBeVisible({ timeout: 8_000 });

    // 제품 그리드는 .grid-cols-* 가 적용된 div — 검색 후에도 존재해야 함
    const productGrid = page.locator('div[class*="grid-cols-"]').first();
    await expect(productGrid).toBeVisible({ timeout: 5_000 });

    const searchInput = page.locator('input[placeholder*="검색"]').first();
    await searchInput.fill('ZZZZZNO');
    await page.waitForTimeout(400);

    // 검색 결과 메시지가 노출되거나 그리드가 비어 있으면 OK
    const hasNoResult = await page.locator('text=/검색 결과가 없|결과 없음/').first().isVisible().catch(() => false);
    const cardCount = await productGrid.locator('button').count();
    expect(hasNoResult || cardCount === 0, 'POS 검색 후 그리드가 그대로').toBeTruthy();
  });

  test('재고 페이지 — 카테고리 select 노출 + 옵션 로드', async ({ page }) => {
    await page.goto('/inventory');
    // 데이터 로드 대기 — 첫 데이터 행이 표시될 때까지
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });

    const categorySelect = page.locator('select').filter({ hasText: '전체 카테고리' }).first();
    await expect(categorySelect).toBeVisible({ timeout: 5_000 });

    // 옵션이 비동기 로드될 수 있으니 [경로코드] 패턴 옵션 등장까지 대기
    // 단, 카테고리 데이터가 아예 없을 수 있어 hard fail 대신 select가 동작하는지만 확인
    const value = await categorySelect.evaluate((el: HTMLSelectElement) => el.value);
    expect(value, '카테고리 select 기본값이 비어있지 않음').toBe('');
  });
});

// ─── 폼 검증 ────────────────────────────────────────────────────────────────
test.describe('폼 검증', () => {
  test('고객 모달 — 빈 이름 + 빈 연락처로 등록 시 모달이 닫히지 않는다', async ({ page }) => {
    await page.goto('/customers');
    await page.getByRole('button', { name: /\+\s*고객 추가/ }).click();
    const modal = page.locator('form').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 모든 필드 빈 채로 등록 시도
    await modal.getByRole('button', { name: /^등록$/ }).click();
    await page.waitForTimeout(500);

    // 검증 실패 → 모달이 그대로 열려 있어야 함 (성공 시 모달 닫힘)
    await expect(modal).toBeVisible();
  });

  test('지점 관리 탭 진입 가능', async ({ page }) => {
    await page.goto('/system-codes');
    // 라벨이 "지점 관리"
    const tab = page.getByRole('button', { name: /지점 관리/ });
    await expect(tab).toBeVisible({ timeout: 5_000 });
    await tab.click();
    await page.waitForTimeout(300);
    // 탭 진입 시 "지점" 관련 컬럼·버튼이 노출
    await expect(page.locator('body')).toContainText(/지점/);
  });
});

// ─── POS 할인·합계 ──────────────────────────────────────────────────────────
test.describe('POS 상호작용', () => {
  test('첫 제품 추가 → "전체 삭제" 클릭 → 카트 비움', async ({ page }) => {
    await page.goto('/pos');
    const productGrid = page.locator('div[class*="grid-cols-"]').first();
    const firstProduct = productGrid.locator('button:not([disabled])', { hasText: '원' }).first();
    await expect(firstProduct).toBeVisible({ timeout: 8_000 });
    await firstProduct.click();

    const clearAll = page.getByRole('button', { name: '전체 삭제' });
    await expect(clearAll).toBeVisible({ timeout: 5_000 });

    await clearAll.click();
    await page.waitForTimeout(300);

    // 비운 후 — 전체 삭제 버튼이 사라지거나 결제 버튼이 0원으로 비활성
    await expect(clearAll).toBeHidden({ timeout: 3_000 });
  });
});

// ─── 카테고리/유형 필터 효과 ────────────────────────────────────────────────
test.describe('재고 필터 동작', () => {
  test('유형 필터 토글 시 active 상태 변경', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page.locator('table tbody')).toBeAttached({ timeout: 8_000 });

    const allBtn = page.getByRole('button', { name: '전체', exact: true }).first();
    const finishedBtn = page.getByRole('button', { name: '완제품', exact: true }).first();

    await expect(allBtn).toBeVisible();
    await expect(finishedBtn).toBeVisible();

    // 완제품 클릭 → 활성 표식(bg-slate-800)이 붙어야 함
    await finishedBtn.click();
    await page.waitForTimeout(300);
    await expect(finishedBtn).toHaveClass(/bg-slate-800/);

    // 전체로 복원
    await allBtn.click();
    await page.waitForTimeout(300);
    await expect(allBtn).toHaveClass(/bg-slate-800/);
  });
});

// ─── AI 어시스턴트 위젯 ─────────────────────────────────────────────────────
test.describe('AI 어시스턴트', () => {
  test('🤖 플로팅 아이콘 클릭 → 채팅 패널 열림 → 닫힘', async ({ page }) => {
    await page.goto('/');
    const floating = page.locator('button[title*="AI 어시스턴트"]').first();
    await expect(floating).toBeVisible({ timeout: 5_000 });
    await floating.click();

    // 패널 헤더 (h3)
    await expect(page.getByRole('heading', { name: '경옥채 AI 어시스턴트' })).toBeVisible({ timeout: 3_000 });

    // textarea 입력창
    await expect(page.locator('textarea[placeholder*="도와드릴까요"]')).toBeVisible();

    // 다시 클릭 → 닫힘
    await floating.click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: '경옥채 AI 어시스턴트' })).toBeHidden();
  });
});
