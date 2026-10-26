import { test, expect } from '@playwright/test';

const spreads = ['one', 'three', 'yesno', 'coin', 'cross', 'love', 'horseshoe', 'alchemist', 'choice', 'career', 'health', 'psyche', 'destiny'];
const decks = ['all', 'tarot', 'lenormand', 'runes', 'gypsy', 'playing'];

async function start(page) {
  // Explicit local fixtures: no Telegram auth, backend, payments or AI are exercised.
  await page.route('**/api/**', route => route.fulfill({ json: { ok: true, entries: [], history: [], balances: [] } }));
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('onb_seen', '1'); });
  await page.goto('/');
  await page.locator('[data-tab="arc"]').click();
  await expect(page.locator('#arcSpreadTabs')).toBeVisible();
}
async function closedCatalog(page) {
  await expect(page.locator('.arc-catalog')).toHaveCount(1);
  await expect(page.locator('.arc-catalog [data-spread]:visible')).toHaveCount(3);
  await expect(page.locator('#arcNav, #arcMobileNav')).toHaveCount(0);
  expect(await page.locator('#arcSpreadTabs [data-spread]').evaluateAll(nodes => nodes.map(n => n.dataset.spread))).toEqual(spreads.slice(0, 3));
}

test('three primary spreads, reversible disclosure, every spread/deck remains reachable', async ({ page }) => {
  // Full spread/deck matrix uses real UI selections, including scrolling/animation.
  test.setTimeout(120_000);
  await start(page);
  await closedCatalog(page);
  await page.locator('#arcOtherSpreads summary').click();
  await expect(page.locator('.arc-catalog [data-spread]:visible')).toHaveCount(spreads.length);
  for (const spread of spreads) {
    await page.locator(`.arc-catalog [data-spread="${spread}"]`).click();
    await expect.poll(() => page.evaluate(() => window.ArcApp.getState().spread)).toBe(spread);
    await expect(page.locator(`.arc-catalog [data-spread="${spread}"]`)).toHaveAttribute('aria-pressed', 'true');
    const title = await page.locator(`.arc-catalog [data-spread="${spread}"] .arc-spread-tab-label`).textContent();
    await expect(page.locator('#arcSelectedSpread')).toContainText(title);
    await expect(page.locator('#arcSpreadTabs [data-spread]')).toHaveCount(3);
    if (spread !== 'coin') {
      for (const [i, deck] of decks.entries()) {
        await page.locator('#deckChips .arc-chip').nth(i).click();
        await expect.poll(() => page.evaluate(() => window.ArcApp.getState().deck)).toBe(deck);
        // Local deck data are exercised without drawing/saving or invoking AI.
        const cards = await page.evaluate(() => window.ArcApp.drawN(1));
        expect(cards).toHaveLength(deck === 'all' ? 5 : 1);
        expect(cards.every(c => c.name)).toBeTruthy();
      }
    }
  }
  await page.locator('#arcOtherSpreads summary').click();
  await closedCatalog(page);
  await expect(page.locator('#arcSelectedSpread')).toContainText('Судьба');
  await page.locator('#arcOtherSpreads summary').click();
  await expect(page.locator('.arc-catalog [data-spread="destiny"]')).toHaveAttribute('aria-pressed', 'true');
});

test('rare programmatic/deep-link entry, coin remount and history return retain selected state', async ({ page }) => {
  await start(page);
  for (const spread of spreads.slice(3)) {
    // Existing public entry used by callers; this is not a new URL parser.
    await page.evaluate(id => window.ArcApp.setSpread(id), spread);
    await closedCatalog(page);
    const title = await page.locator(`.arc-catalog [data-spread="${spread}"] .arc-spread-tab-label`).textContent();
    await expect(page.locator('#arcSelectedSpread')).toContainText(title);
    await expect(page.locator(`.arc-catalog [data-spread="${spread}"]`)).toHaveAttribute('aria-pressed', 'true');
    if (spread === 'coin') {
      await page.locator('#coinCountSelect').selectOption('3');
      await expect(page.locator('.coin-oracle-coin')).toHaveCount(3);
      await closedCatalog(page);
    }
  }
  await page.locator('[data-tab="history"]').click();
  await expect(page.locator('#screen-history')).toBeVisible();
  await page.locator('[data-tab="arc"]').click();
  await expect(page.locator('#arcSelectedSpread')).toContainText('Судьба');
  await closedCatalog(page);
});

test('paid actions display price before invocation; drawing stays local with mocked history', async ({ page }) => {
  let paidRequests = 0;
  await start(page);
  await page.locator('.arc-catalog [data-spread="one"]').click();
  await page.route('**/api/arc/*interpret*', route => { paidRequests++; return route.abort(); });
  await page.locator('#ctaDraw').click();
  await expect(page.locator('#arcFocusDraw')).toBeVisible();
  await page.locator('#arcFocusDraw').click();
  await expect(page.locator('#arcFocusOverlay')).toBeHidden();
  await expect(page.locator('.arc-ai-go')).toBeVisible();
  await expect(page.locator('.arc-ai-go')).toContainText('7 маны');
  await expect(page.locator('.arc-expand-btn').first()).toContainText('7 маны');
  expect(paidRequests).toBe(0);
});

for (const deck of ['tarot', 'all']) {
  test(`delayed history preserves pending paid AI action (${deck})`, async ({ page }) => {
    await start(page);
    await page.locator('.arc-catalog [data-spread="one"]').click();
    await page.evaluate(deck => window.ArcApp.setDeck(deck), deck);
    let historyRoute;
    let paidRoute;
    let paidRequests = 0;
    await page.route('**/api/history*', route => {
      if (route.request().method() === 'POST') historyRoute = route;
      else return route.fallback();
    });
    await page.route('**/api/arc/interpret*', route => {
      paidRequests++;
      paidRoute = route;
    });
    await page.locator('#ctaDraw').click();
    await page.locator('#arcFocusDraw').click();
    await expect(page.locator('#arcFocusOverlay')).toBeHidden();
    await expect.poll(() => Boolean(historyRoute)).toBe(true);
    await page.locator('.arc-ai-go').click();
    await expect.poll(() => paidRequests).toBe(1);
    await expect(page.locator('.arc-ai-card.is-loading')).toBeVisible();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await historyRoute.fulfill({ json: { ok: true, id: 'history-race-fixture' } });
    await page.waitForTimeout(1500); // Let both post-history animation branches finish.
    expect(pageErrors).toEqual([]);
    await expect(page.locator('#ctaDraw')).toContainText('Готово');
    await expect(page.locator('.arc-ai-card.is-loading')).toBeVisible();
    await expect(page.locator('.arc-ai-go')).toHaveCount(0);
    expect(paidRequests).toBe(1);
    await paidRoute.fulfill({ json: { ok: true, text: 'Локальный тестовый ответ' } });
  });
}

test('Arc script failure is recoverable by re-entering Cards', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { ok: true, entries: [], balances: [] } }));
  let fail = true;
  await page.route('**/js/arc-app.js*', route => fail ? route.abort('failed') : route.continue());
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('onb_seen', '1'); });
  await page.goto('/');
  await page.locator('[data-tab="arc"]').click();
  await expect(page.getByText('Не удалось загрузить карты. Проверьте сеть и попробуйте ещё раз.', { exact: true })).toBeVisible();
  fail = false;
  await page.locator('[data-tab="home"]').click();
  await page.locator('[data-tab="arc"]').click();
  await expect(page.locator('#arcSpreadTabs')).toBeVisible();
  await closedCatalog(page);
});
