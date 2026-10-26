import { test, expect } from '@playwright/test';

async function start(page, auth = false, startParam = '') {
  await page.route('**/api/**', r => r.fulfill({ json: { ok: true, items: [], entries: [], balances: [] } }));
  await page.route('**/js/vendor/telegram-web-app.js*', r => r.fulfill({ contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(auth ? 'mock-auth' : '')},initDataUnsafe:{user:{id:123,first_name:'Test'},start_param:${JSON.stringify(startParam)}},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},onEvent(){},BackButton:{onClick(fn){window.testBack=fn},show(){},hide(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){},selectionChanged(){}}}};` }));
  await page.addInitScript(() => localStorage.setItem('onb_seen', '1'));
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen-shell-ready', '1');
}
async function route(page, name, tab = name) {
  await expect(page.locator('body')).toHaveAttribute('data-active-route', name);
  await expect(page.locator('[data-screen-root]:visible')).toHaveCount(1);
  await expect(page.locator('.bottom-tab.is-active')).toHaveCount(1);
  await expect(page.locator(`.bottom-tab[data-tab="${tab}"]`)).toHaveAttribute('aria-current', 'page');
  expect((await page.locator('[data-screen-root]:visible').innerText()).trim().length).toBeGreaterThan(10);
}
for (const auth of [false, true]) {
  test(`chart/compat close and Telegram Back restore routes and drafts (${auth ? 'mock auth' : 'guest'})`, async ({ page }) => {
    await start(page, auth, 'mychart');
    await route(page, 'chart', 'profile');
    await page.locator('#panelChart .panel-close').click();
    await route(page, 'home');
    await page.locator('#userChip').click();
    await route(page, 'profile');
    for (let i = 0; i < 5; i++) {
      await page.locator('#todayChartBtn').click();
      await route(page, 'chart', 'profile');
      if (i % 2) await page.evaluate(() => window.testBack());
      else await page.locator('#panelChart .panel-close').click();
      await route(page, 'profile');
    }
    await page.locator('#todayCompatBtn').click();
    await route(page, 'compat', 'profile');
    if (auth) await page.locator('#compatInput').fill('456');
    else await expect(page.locator('#compatGuestOpen')).toBeVisible();
    await page.evaluate(() => window.testBack());
    await route(page, 'profile');
    await page.locator('#todayCompatBtn').click();
    if (auth) await expect(page.locator('#compatInput')).toHaveValue('456');
    await page.locator('#panelCompat .panel-close').click();
    await route(page, 'profile');
  });
}

test('Home hierarchy and relocated features remain reachable', async ({ page }) => {
  await start(page);
  await expect(page.locator('#todayCardBtn')).toBeVisible();
  await expect(page.locator('#heroCard')).toBeHidden();
  await expect(page.locator('#screen-day .home-primary-btn:visible')).toHaveCount(2);
  await expect(page.locator('#homeManaCard')).toBeVisible();
  await page.locator('#todayCardBtn').click();
  await route(page, 'daily', 'home');
  await page.locator('#dailyClose').click();
  await route(page, 'home');
  await page.locator('#dailyJournalDisclosure > summary').click();
  await expect(page.locator('#dailyJournal')).toBeVisible();
  await page.locator('#userChip').click();
  for (const id of ['todayChartBtn', 'todayCompatBtn', 'moonCard', 'homeTools']) await expect(page.locator('#' + id)).toBeVisible();
  await page.locator('[data-tab="arc"]').click();
  await expect(page.locator('#arcSpreadTabs')).toBeVisible();
  await page.locator('#homeDreamBtn').click();
  await route(page, 'dream', 'arc');
  await page.evaluate(() => window.testBack());
  await route(page, 'arc');
  await expect(page.locator('#arcSpreadTabs')).toBeVisible();
});

test('history guest, auth expiry, network error and retry are distinct; re-entry refreshes', async ({ page }) => {
  await start(page);
  await page.locator('[data-tab="history"]').click();
  await expect(page.locator('#homeHistoryStatus')).toHaveAttribute('data-state', 'guest');
  await expect(page.locator('#homeHistoryEmpty')).toBeHidden();
  await start(page, true);
  let mode = 401;
  let requests = 0;
  await page.unroute('**/api/**');
  await page.route('**/api/history*', r => {
    requests++;
    if (mode === 0) return r.abort();
    return r.fulfill({ status: mode, json: { ok: mode === 200, items: [] } });
  });
  await page.locator('[data-tab="history"]').click();
  await expect(page.locator('#homeHistoryStatus')).toHaveAttribute('data-state', 'auth');
  await expect(page.locator('#homeHistoryEmpty')).toBeHidden();
  mode = 0;
  await page.locator('#historyRetry').click();
  await expect(page.locator('#homeHistoryStatus')).toHaveAttribute('data-state', 'error');
  mode = 200;
  await page.locator('#historyRetry').click();
  await expect(page.locator('#homeHistoryEmpty')).toBeVisible();
  const before = requests;
  await page.locator('[data-tab="home"]').click();
  await page.locator('[data-tab="history"]').click();
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(page.locator('#homeHistoryEmpty')).toBeVisible();
});

test('Arc pending, durable retry and rapid tab switching never steal navigation', async ({ page }) => {
  let fail = true;
  let release;
  await page.route('**/js/arc-app.js*', async r => {
    if (fail) return r.abort();
    await new Promise(resolve => { release = resolve; });
    await r.continue();
  });
  await start(page);
  await page.locator('[data-tab="arc"]').click();
  await expect(page.locator('#arcLoadRetry')).toBeVisible();
  await expect(page.locator('#arcLoadStatus')).toContainText('Не удалось');
  fail = false;
  await page.locator('#arcLoadRetry').click();
  await expect(page.locator('#arcLoadStatus')).toContainText('Загружаем');
  await expect.poll(() => !!release).toBe(true);
  await page.locator('[data-tab="profile"]').click();
  release();
  await expect.poll(() => page.evaluate(() => !!window.ArcApp)).toBe(true);
  await route(page, 'profile');
  await expect(page.locator('#arcPortal')).toBeHidden();
  await page.locator('[data-tab="arc"]').click();
  await expect(page.locator('#arcSpreadTabs')).toBeVisible();
  await route(page, 'arc');
  await expect(page.locator('#arcLoadStatus')).toBeHidden();
});
