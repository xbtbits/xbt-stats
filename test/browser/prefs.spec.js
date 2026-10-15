import { test, expect } from '@playwright/test';

test('the dashboard price chart remembers range, LOG and moving averages after leaving the page', async ({ page }) => {
  await page.goto('/');
  await page.locator('#price-chart [data-range="3m"]').click();
  await page.locator('#price-chart [data-log]').click();
  await page.locator('#price-chart [data-ma="50"]').click();
  await page.goto('/charts');
  const req = page.waitForRequest((r) => r.url().includes('series=price&range=3m'));
  await page.goto('/');
  await req;
  await expect(page.locator('#price-chart [data-range="3m"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#price-chart [data-range="1d"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#price-chart [data-log]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#price-chart [data-ma="50"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-k="price.changePeriod"]')).toHaveText('3M');
});

test('each chart remembers its own range', async ({ page }) => {
  await page.goto('/charts');
  await page.locator('[data-series="hashrate"] [data-range="3m"]').click();
  await page.reload();
  await expect(page.locator('[data-series="hashrate"] [data-range="3m"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-series="difficulty"] [data-range="1m"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the nodes chart remembers its range', async ({ page }) => {
  await page.goto('/nodes');
  await page.locator('#nodes-chart [data-range="7d"]').click();
  await page.reload();
  await expect(page.locator('#nodes-chart [data-range="7d"]')).toHaveAttribute('aria-pressed', 'true');
});

test('with browser storage blocked, charts still work with their defaults', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#price-chart [data-range="1d"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#price-chart [data-range="7d"]').click();
  await expect(page.locator('#price-chart [data-range="7d"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('the nodes chart shows the remembered range at once, before the census arrives', async ({ page }) => {
  await page.goto('/nodes');
  await page.locator('#nodes-chart [data-range="ytd"]').click();
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/api/nodes', async (route) => { await held; await route.continue(); });
  await page.reload();
  await expect(page.locator('#nodes-chart [data-range="ytd"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#nodes-chart [data-range="all"]')).toHaveAttribute('aria-pressed', 'false');
  release();
});

test('the Mining pools card remembers 24H / 7D / 30D', async ({ page }) => {
  await page.goto('/mining');
  await page.locator('.pools-tabs [data-range="1m"]').click();
  const req = page.waitForRequest((r) => r.url().includes('series=pools&range=1m'));
  await page.goto('/about');
  await page.goto('/mining');
  await req; // loads the remembered range straight away
  await expect(page.locator('.pools-tabs [data-range="1m"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pools-tabs [data-range="1d"]')).toHaveAttribute('aria-pressed', 'false');
});
