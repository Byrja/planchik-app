import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onb_seen', '1'));
  await page.goto('/');
  await expect(page.locator('h1.app-title')).toHaveText('Гадалка');
});

test('home fits Telegram mobile viewport without horizontal clipping', async ({ page }) => {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.locator('#homeAskBtn')).toBeVisible();
  await expect(page.locator('#homeManaCard')).toBeVisible();
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
