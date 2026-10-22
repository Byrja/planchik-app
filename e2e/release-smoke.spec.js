import { test, expect } from '@playwright/test';

test.describe('release smoke: home, onboarding and primary surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('fresh user can skip onboarding and open the free question flow', async ({ page }) => {
    await expect(page.locator('#onboarding')).toBeVisible();
    await page.locator('.onb-skip').click();
    await expect(page.locator('#onboarding')).toBeHidden();
    await expect(page.locator('#homeAskBtn')).toBeVisible();
    await page.locator('#homeAskBtn').click();
    await expect(page.locator('#homeAskFlow')).toBeVisible();
    await expect(page.locator('#homeAskPrice')).toContainText('7 маны');
    await page.locator('#homeAskInput').fill('Стоит ли сделать первый шаг?');
    await expect(page.locator('#homeAskSubmit')).toBeEnabled();
  });

  test('home opens cards and exposes chart, profile, history and mana surfaces', async ({ page }) => {
    await page.locator('.onb-skip').click();
    await page.locator('#homeAskBtn').click();
    await page.locator('#homeAskOpenCards').click();
    await expect(page.locator('#arcPortal')).toBeVisible();
    await page.locator('[data-tab="home"]').click();
    for (const [trigger, panel] of [
      ['#tileChart', '#panelChart'],
      ['#tileProfile', '#panelProfile'],
      ['#homeManaCard', '#panelStars'],
    ]) {
      await page.locator('[data-tab="home"]').click();
      await page.locator('#homeTools').evaluate((element) => { element.open = true; });
      const button = page.locator(trigger);
      await expect(button, `${trigger} trigger is missing`).toHaveCount(1);
      await button.click();
      await expect(page.locator(panel), `${panel} panel is missing`).toBeVisible();
    }
    await page.locator('[data-tab="home"]').click();
    await page.locator('#homeTools').evaluate((element) => { element.open = true; });
    await page.locator('#tileJournal').click();
    await expect(page.locator('#panelHistory')).toBeHidden();
    await page.locator('[data-tab="history"]').click();
    await expect(page.locator('#panelHistory')).toBeVisible();
  });
});
