import { test, expect } from '@playwright/test';

test.describe('release smoke: home, onboarding and relocated surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('fresh user can skip onboarding and open question flow with price', async ({ page }) => {
    await expect(page.locator('#onboarding')).toBeVisible();
    await page.locator('.onb-skip').click();
    await expect(page.locator('#onboarding')).toBeHidden();
    await page.locator('#homeAskBtn').click();
    await expect(page.locator('#homeAskFlow')).toBeVisible();
    await expect(page.locator('#homeAskPrice')).toContainText('7 маны');
    await page.locator('#homeAskInput').fill('Стоит ли сделать первый шаг?');
    await expect(page.locator('#homeAskSubmit')).toBeEnabled();
  });

  test('cards, relocated profile tools, compact balance and journal remain usable', async ({ page }) => {
    await page.locator('.onb-skip').click();
    await page.locator('#homeAskBtn').click();
    await page.locator('#homeAskOpenCards').click();
    await expect(page.locator('#arcSpreadTabs')).toBeVisible();
    for (const [trigger, panel] of [
      ['#tileChart', '#panelChart'], ['#tileProfile', '#panelProfile'],
    ]) {
      await page.locator('[data-tab="profile"]').click();
      const summary = page.locator('#homeTools summary');
      if (!(await page.locator('#homeTools').evaluate(e => e.open))) await summary.click();
      await page.locator(trigger).click();
      await expect(page.locator(panel)).toBeVisible();
    }
    await page.locator('[data-tab="home"]').click();
    await page.locator('#homeManaCard').click();
    await expect(page.locator('#panelStars')).toBeVisible();
    await page.locator('[data-tab="profile"]').click();
    if (!(await page.locator('#homeTools').evaluate(e => e.open))) await page.locator('#homeTools summary').click();
    await page.locator('#tileJournal').click();
    await expect(page.locator('#panelHistory')).toBeHidden();
    await page.locator('[data-tab="history"]').click();
    await expect(page.locator('#panelHistory')).toBeVisible();
  });
});
