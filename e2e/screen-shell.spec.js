import { test, expect } from '@playwright/test';

async function start(page) {
  await page.goto('/');
  const skip = page.locator('.onb-skip');
  await skip.click();
  await expect(page.locator('#screen-day')).toBeVisible();
}

test.describe('screen shell navigation', () => {
  test('each primary tab exposes exactly one screen root and hides home elsewhere', async ({ page }) => {
    await start(page);
    for (const tab of ['home', 'arc', 'stars', 'history', 'profile']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      const visible = await page.locator('[data-screen-root]:visible').count();
      expect(visible, `${tab} should have one visible screen root`).toBe(1);
      const active = await page.locator('[data-screen-root]:visible').getAttribute('data-screen-root');
      expect(active).toBe(tab === 'home' ? 'home' : tab);
      if (tab !== 'home') await expect(page.locator('#screen-day')).toBeHidden();
      await expect(page.locator('[data-screen-root][aria-hidden="true"]')).toHaveCount(4);
    }
  });

  test('home tab is a deterministic back/home target', async ({ page }) => {
    await start(page);
    await page.locator('[data-tab="history"]').click();
    await expect(page.locator('#screen-history')).toBeVisible();
    await page.locator('[data-tab="home"]').click();
    await expect(page.locator('#screen-day')).toBeVisible();
    await expect(page.locator('#screen-history')).toBeHidden();
  });

  test('screen shell has no horizontal overflow at compact widths', async ({ page }) => {
    await start(page);
    for (const tab of ['home', 'arc', 'stars', 'history', 'profile']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await expect(page.locator(`[data-screen-root="${tab}"]`)).toBeVisible();
      if (tab === 'arc') await expect(page.locator('#arcSpreadTabs')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `${tab} overflows horizontally`).toBeFalsy();
    }
  });
});
