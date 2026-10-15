import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
const empty = JSON.parse(readFileSync(new URL('../fixtures/snapshot-empty.json', import.meta.url), 'utf8'));
const FRESH = snapshot.generatedAt + 5_000;

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test('renders the dashboard from a snapshot', async ({ page }) => {
  const errors = watchErrors(page);
  const t = Math.floor(FRESH / 1000);
  // Recorded history shorter than the default 1D range, so the note shows.
  await page.route('**/api/history**', (r) => r.fulfill({ json: { series: 'price', range: '1d', source: 'recorded', points: [[t - 7200, 850], [t - 60, 852]] } }));
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('[data-k="chain.height"]')).toHaveText(['976,572', '976,572']);
  await expect(page.locator('[data-k="price.usd"]')).toHaveText('$851.99');
  await expect(page.locator('[data-k="price.changeLine"]')).toHaveText('−20.95 (−2.40%)');
  await expect(page.locator('[data-k="price.changeLine"]')).toHaveAttribute('data-dir', 'down');
  await expect(page.locator('[data-c="price.change24h"], [data-k="price.change24hUsd"], [data-k="price.athDate"]')).toHaveCount(0);
  await expect(page.locator('footer')).toContainText('XBT is not BTC');
  await expect(page.locator('footer a[href="/about"]')).toHaveText('About and sources');
  await expect(page.locator('[data-k="status.line"]')).toHaveCount(0); // sources and status live on About
  await expect(page.locator('.chart-note')).toContainText('History begins');
  await expect(page.locator('[data-c="difficulty.change"]')).toHaveText('▲ +17.48%');
  await expect(page.locator('[data-k="chain.supply"]')).toHaveText('20,114,290.63 XBT');
  await expect(page.locator('[data-k="mining.hashrate"]')).toHaveText(['43.30 PH/s', '43.30 PH/s']);
  await expect(page.locator('[data-k="difficulty.difficulty"]')).toHaveText('21.85 E');
  await expect(page.locator('[data-k="price.marketCap"]')).toHaveText('$17.14B');
  await expect(page.locator('[data-k="halving.date"]')).toHaveText('Dec 18, 2027');
  await expect(page.locator('[data-k="price.sources"]')).toHaveText('USD via NonKYC BTCB2/USDT, Neoxa XBT/USDC');
  await expect(page.locator('#pools li')).toHaveCount(3);
  await expect(page.locator('#future-halvings tr')).toHaveCount(6);
  await expect(page.locator('#milestones tr')).toHaveCount(4);
  // every table value in the number font, rewards without the unit (it's in the header)
  for (const td of await page.locator('#future-halvings td, #milestones td').all()) {
    expect(await td.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/^Michroma/);
  }
  await expect(page.locator('#future-halvings').locator('xpath=ancestor::table').locator('thead th').last()).toHaveText('Reward after (XBT)');
  await expect(page.locator('#future-halvings tr').first().locator('td').last()).not.toContainText('XBT');
  await expect(page.locator('.notice:not([hidden])')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('old chain data shows the stale notice with its age', async ({ page }) => {
  await page.clock.setFixedTime(snapshot.sources.chain.fetchedAt + 15 * 60_000);
  await page.goto('/');
  await expect(page.locator('#notice-stale-chain')).toBeVisible();
  await expect(page.locator('#notice-stale-chain')).toContainText('15 min ago');
  await expect(page.locator('#notice-stale-price')).toBeHidden(); // price is 16 min old, limit 20
});

test('disagreeing explorers show a notice', async ({ page }) => {
  const s = structuredClone(snapshot);
  s.flags.sourcesDisagree = true;
  s.sources.crossCheck.tip = 976560;
  await page.route('**/api/snapshot', (r) => r.fulfill({ json: s }));
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('#notice-disagree')).toContainText('mempool.kilombino.com at block 976,560');
});

test('cold start renders dashes and notices', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('**/api/snapshot', (r) => r.fulfill({ json: empty }));
  await page.route('**/api/history**', (r) => r.fulfill({ json: { series: 'price', range: '7d', source: 'recorded', points: [] } }));
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('[data-k="chain.height"]')).toHaveText(['—', '—']);
  await expect(page.locator('[data-k="price.usd"]')).toHaveText('—');
  await expect(page.locator('[data-k="price.sources"]')).toHaveText('No price recorded yet');
  await expect(page.locator('#notice-stale-chain')).toContainText('not available yet');
  expect(errors).toEqual([]);
});

test('server errors keep the last data and show the offline notice', async ({ page }) => {
  await page.clock.install({ time: FRESH });
  await page.goto('/');
  await expect(page.locator('[data-k="chain.height"]')).toHaveText(['976,572', '976,572']);
  await page.route('**/api/snapshot', (r) => r.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }));
  await page.clock.runFor(31_000);
  await expect(page.locator('#notice-offline')).toBeVisible();
  await expect(page.locator('[data-k="chain.height"]')).toHaveText(['976,572', '976,572']);
});

test('becoming visible refreshes immediately', async ({ page }) => {
  let hits = 0;
  await page.route('**/api/snapshot', (r) => { hits += 1; return r.fulfill({ json: snapshot }); });
  await page.clock.install({ time: FRESH });
  await page.goto('/');
  await expect(page.locator('[data-k="chain.height"]')).toHaveText(['976,572', '976,572']);
  const before = hits;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => hits).toBe(before + 1);
});

test('the price panel shows the live price label and all seven stats', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  const panel = page.locator('section.price-panel');
  await expect(panel).toHaveCount(1);
  await expect(panel.locator('#price-title')).toHaveText(/XBT live price \(USD\)/i);
  await expect(panel.locator('.price-stats dt')).toHaveText([
    /24h high/i, /24h low/i, /24h vol \(XBT\)/i, /24h vol \(USD\)/i, /ATH \(USD\)/i, /market cap/i, /sats per USD/i,
  ]);
  await expect(panel.locator('[data-k="price.high24h"]')).toHaveText('$930.00');
  await expect(panel.locator('[data-k="price.low24h"]')).toHaveText('$839.07');
  await expect(panel.locator('[data-k="price.volBase24h"]')).toHaveText('1,201 XBT');
  await expect(panel.locator('[data-k="price.volUsd24h"]')).toHaveText('$1.08M');
  await expect(panel.locator('[data-k="price.ath"]')).toHaveText('$1,187.00');
  await expect(panel.locator('[data-k="price.ath"]')).toHaveAttribute('title', 'Highest hourly close since Sep 10, 2026 · set Sep 15, 2026');
  await expect(panel.locator('[data-k="price.marketCap"]')).toHaveText('$17.14B');
  await expect(panel.locator('[data-k="price.satsPerUsd"]')).toHaveText('117,372');
  await expect(panel.locator('#price-chart .plot')).toHaveCount(1);
  await expect(panel.locator('.source-line')).toContainText('USD via');
  // the price panel comes first, then the counter strip (decorative terminal labels may sit between)
  const order = await page.evaluate(() => {
    let next = document.querySelector('.price-panel').nextElementSibling;
    while (next?.classList.contains('term')) next = next.nextElementSibling;
    return next === document.querySelector('.counters');
  });
  expect(order).toBe(true);
  await expect(page.locator('.hero, .chart-card')).toHaveCount(0);
});

test('without a price the panel shows dashes', async ({ page }) => {
  await page.route('**/api/snapshot', (r) => r.fulfill({ json: empty }));
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('[data-k="price.satsPerUsd"]')).toHaveText('—');
  await expect(page.locator('[data-k="price.ath"]')).not.toHaveAttribute('title', /./);
  await expect(page.locator('[data-k="price.changeLine"]')).toHaveText('—');
  await expect(page.locator('[data-k="price.changeLine"]')).toHaveAttribute('data-dir', 'flat');
});

test('the change under the price follows the selected chart range', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  const change = page.locator('[data-k="price.changeLine"]');
  const period = page.locator('[data-k="price.changePeriod"]');
  await expect(change).toHaveText('−20.95 (−2.40%)');
  await expect(period).toHaveText('24H');
  await page.locator('#price-chart [data-range="7d"]').click();
  // history fixture starts at 840; snapshot price 851.99 → up
  await expect(change).toHaveText('+11.99 (1.43%)');
  await expect(change).toHaveAttribute('data-dir', 'up');
  await expect(period).toHaveText('7D');
  await page.locator('#price-chart [data-range="1d"]').click();
  await expect(change).toHaveText('−20.95 (−2.40%)');
  await expect(period).toHaveText('24H');
});
