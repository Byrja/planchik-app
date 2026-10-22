import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onb_seen', '1'));
  await page.goto('/');
  await expect(page.locator('h1.app-title')).toHaveText('Гадалка');
});

test('home fits Telegram mobile viewport without horizontal clipping', async ({ page }, testInfo) => {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.locator('#homeAskBtn')).toBeVisible();
  await expect(page.locator('#homeManaCard')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home-mobile.png'), fullPage: true });
});

test('guest question flow remains usable on mobile', async ({ page }) => {
  await page.locator('#homeAskBtn').click();
  await expect(page.locator('#homeAskFlow')).toBeVisible();
  await expect(page.locator('#homeAskPrice')).toContainText('7 маны');
  await page.locator('#homeAskInput').fill('Стоит ли сделать первый шаг?');
  await expect(page.locator('#homeAskSubmit')).toBeEnabled();
  const clipped = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(clipped).toBe(false);
});

test('focused question remains reachable with a compact software-keyboard viewport', async ({ page }) => {
  await page.locator('#homeAskBtn').click();
  const input = page.locator('#homeAskInput');
  await input.fill('Проверка экранной клавиатуры');
  await input.focus();
  await page.setViewportSize({ width: page.viewportSize().width, height: 430 });
  await input.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect.poll(async () => {
    const box = await input.boundingBox();
    return Boolean(box && box.y >= 0 && box.y + box.height <= 430);
  }).toBe(true);
  await expect(page.locator('#homeAskSubmit')).toBeEnabled();
});

test('optional card bundle is split from initial load and appears on demand', async ({ page }) => {
  const before = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(before.some((url) => url.includes('/js/arc-app.js'))).toBe(false);
  await page.locator('.bottom-tab[data-tab="arc"]').click();
  await expect(page.locator('#arcPortal')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.ArcApp))).toBe(true);
  const after = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(after.some((url) => url.includes('/js/arc-app.js'))).toBe(true);
});

test('primary mobile controls keep a usable touch target', async ({ page }) => {
  const controls = page.locator('button:visible, [role="button"]:visible, a.btn:visible');
  const tooSmall = await controls.evaluateAll((elements) => elements
    .map((element) => ({
      label: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 80),
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }))
    .filter(({ width, height }) => width > 0 && (width < 44 || height < 44)));
  expect(tooSmall, JSON.stringify(tooSmall)).toEqual([]);
});
