import { test, expect } from '@playwright/test';

async function start(page) {
  await page.route('**/api/**', r => r.fulfill({ json: { ok: true, items: [], entries: [], balances: [] } }));
  await page.addInitScript(() => localStorage.setItem('onb_seen', '1'));
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen-shell-ready', '1');
}

test('keyboard focus stays in visible screen and focused question survives reduced viewport', async ({ page }) => {
  await start(page);
  await page.locator('#homeAskBtn').click();
  await page.locator('#homeAskInput').fill('Сохранённый вопрос');
  await page.locator('#homeAskInput').focus();
  await expect(page.locator('#homeAskInput')).toBeFocused();
  const original = page.viewportSize();
  // Layout surrogate only, not a real Android/iOS keyboard acceptance test.
  await page.setViewportSize({ width: original.width, height: 420 });
  await page.locator('#homeAskInput').scrollIntoViewIfNeeded();
  await expect(page.locator('#homeAskInput')).toHaveValue('Сохранённый вопрос');
  const box = await page.locator('#homeAskInput').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(420);
  await page.setViewportSize(original);
  await page.locator('[data-tab="profile"]').click();
  await page.locator('[data-tab="profile"]').focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
      const el = document.activeElement;
      return !el.closest('[hidden], [aria-hidden="true"]');
    })).toBe(true);
  }
  await page.locator('[data-tab="home"]').click();
  await expect(page.locator('#homeAskInput')).toHaveValue('Сохранённый вопрос');
});

test('bottom navigation exposes an accessible current page and safe-area padding', async ({ page }) => {
  await start(page);
  for (const tab of ['home', 'arc', 'stars', 'history', 'profile']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    if (tab === 'arc') await expect(page.locator('#arcSpreadTabs')).toBeVisible();
    await expect(page.locator('.bottom-tab[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute('aria-current', 'page');
  }
  const safe = await page.evaluate(() => ({
    navPadding: parseFloat(getComputedStyle(document.querySelector('#bottomTabs')).paddingBottom),
    viewport: document.querySelector('meta[name="viewport"]').content,
  }));
  expect(safe.viewport).toContain('viewport-fit=cover');
  expect(safe.viewport).not.toContain('user-scalable=no');
  expect(safe.navPadding).toBeGreaterThanOrEqual(0);
});
