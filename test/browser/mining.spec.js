import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snap = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
const AT = snap.price.updatedAt + 2 * 60_000;
const num = (t) => Number(t.replace(/[^0-9.]/g, ''));
const row = (page, i) => page.locator('#earn-body tr').nth(i);

test('defaults render every row with numbers (fixture: 10 TH/s, 3000 W, $0.08, 1%)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  await expect(row(page, 0).locator('td').nth(0)).toHaveText('0.12116099');
  await expect(row(page, 0).locator('td').nth(1)).toHaveText('$103.23');
  await expect(row(page, 0).locator('td').nth(2)).toHaveText('$5.76');
  await expect(row(page, 0).locator('td').nth(3)).toHaveText('$97.47');
  await expect(row(page, 0).locator('td').nth(3)).toHaveAttribute('data-dir', 'up');
  await expect(row(page, 3).locator('td').nth(2)).toHaveText('$2,102.40');
  await expect(page.locator('#earn-body tr th')).toHaveText(['Day', 'Week', 'Month (30 d)', 'Year (365 d)']);
  await expect(page.locator('[data-k="net-hashrate"]')).toHaveText('43.30 PH/s');
  await expect(page.locator('[data-k="net-subsidy"]')).toHaveText('3.125 XBT');
  await expect(page.locator('[data-k="net-block"]')).toHaveText('8.5 min');
  await expect(page.locator('[data-k="net-share"]')).toHaveText('0.0231%');
  await expect(page.locator('[data-k="net-solo"]')).toHaveText('≈ 25.6 days');
  await expect(page.locator('[data-k="net-diff"]')).toHaveText('▲ +17.48%');
  await expect(page.locator('#mining-msg')).toHaveText('');
  await expect(page.locator('.credit')).toHaveText('Estimates only: assumes today’s network hashrate, fees, block time and price stay constant. Mining rewards vary.');
  await expect(page.locator('footer')).toContainText('Not financial advice.'); // said once, in the footer
  await expect(page.locator('nav.nav a[aria-current="page"]')).toHaveText('Mining');
  expect(errors).toEqual([]);
});

test('PH/s unit scales XBT by 1000', async ({ page }) => {
  await page.goto('/mining');
  await expect(row(page, 0).locator('td').nth(0)).toHaveText('0.12116099');
  await page.locator('#in-unit').selectOption('PH/s');
  await expect(row(page, 0).locator('td').nth(0)).toHaveText('121.16099353');
  await page.locator('#in-unit').selectOption('GH/s');
  await expect(row(page, 0).locator('td').nth(0)).toHaveText('0.00012116');
});

test('profit colour flips when electricity cost is raised', async ({ page }) => {
  await page.goto('/mining');
  const profit = row(page, 0).locator('td').nth(3);
  await expect(profit).toHaveAttribute('data-dir', 'up');
  await page.getByLabel('Electricity ($/kWh)').fill('2');
  await expect(profit).toHaveAttribute('data-dir', 'down');
  expect(num(await profit.textContent())).toBeGreaterThan(0);
  await expect(profit).toContainText('-');
});

test('guards: empty hashrate shows dashes; huge hashrate warns', async ({ page }) => {
  await page.goto('/mining');
  await page.getByLabel('Hashrate', { exact: true }).fill('0');
  await expect(row(page, 0).locator('td').nth(0)).toHaveText('—');
  await expect(row(page, 0).locator('td').nth(3)).toHaveText('—');
  await expect(page.locator('[data-k="net-share"]')).toHaveText('—');
  await page.getByLabel('Hashrate', { exact: true }).fill('999999');
  await page.locator('#in-unit').selectOption('PH/s');
  await expect(page.locator('#mining-msg')).toHaveText('More than the whole network?');
});

test('without a snapshot outputs are dashes with a note', async ({ page }) => {
  await page.route('**/api/snapshot', (r) => r.fulfill({ json: JSON.parse(readFileSync(new URL('../fixtures/snapshot-empty.json', import.meta.url), 'utf8')) }));
  await page.goto('/mining');
  await expect(row(page, 0).locator('td').nth(0)).toHaveText('—');
  await expect(page.locator('#mining-msg')).toHaveText('Waiting for the first network numbers.');
});

test('refreshes the snapshot every 30 s', async ({ page }) => {
  let price = snap.price.usd;
  await page.route('**/api/snapshot', (r) => {
    const s = structuredClone(snap);
    s.price.usd = price;
    return r.fulfill({ json: s });
  });
  await page.clock.install({ time: AT });
  await page.goto('/mining');
  await expect(row(page, 0).locator('td').nth(1)).toHaveText('$103.23');
  price = 1000;
  await page.clock.runFor(31_000);
  await expect(row(page, 0).locator('td').nth(1)).toHaveText('$121.16');
});

for (const width of [375, 640, 768, 1280]) {
  test(`mining page has no sideways scroll and a wrapped nav at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/mining');
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const navRight = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.nav a')].map((a) => a.getBoundingClientRect().right)));
    expect(navRight).toBeLessThanOrEqual(width);
  });
}

test('makes only same-origin requests', async ({ page }) => {
  const foreign = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:4173/')) foreign.push(r.url()); });
  await page.goto('/mining');
  await page.waitForLoadState('networkidle');
  expect(foreign).toEqual([]);
});

test('network inputs show the next halving; far away, no period is affected', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  await expect(page.locator('[data-k="net-halving"]')).toHaveText('1,050,000');
  await expect(page.locator('[data-k="net-halving-date"]')).toHaveText('Dec 18, 2027');
  await expect(page.locator('[data-k="net-subsidy-after"]')).toHaveText('1.5625 XBT');
  await expect(page.locator('[data-k="net-halving-in"]')).toContainText('days');
  await expect(page.locator('#halving-note')).toBeHidden();
});

test('a halving inside the year lowers the Year row and explains why', async ({ page }) => {
  const s = structuredClone(snap);
  s.halving.eta = AT + 100 * 86_400_000; // halving in 100 days
  await page.route('**/api/snapshot', (r) => r.fulfill({ json: s }));
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  await expect(page.locator('#halving-note')).toContainText('Includes the halving');
  await expect(page.locator('#halving-note')).toContainText('3.125 XBT to 1.5625 XBT');
  const day = num(await row(page, 0).locator('td').nth(0).textContent());
  const year = num(await row(page, 3).locator('td').nth(0).textContent());
  expect(year).toBeLessThan(day * 365 * 0.8); // 100 days full, 265 days at about half
  const month = num(await row(page, 2).locator('td').nth(0).textContent());
  expect(Math.abs(month - day * 30)).toBeLessThan(0.0001); // month is before the halving
});

test('the mining pools card is the first card on the Mining tab', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  const first = page.locator('main .card').first();
  await expect(first.locator('h2')).toHaveText('Mining pools');
  await expect(page.locator('#pools-week li')).toHaveCount(3);
  await expect(page.locator('#pools-week-summary')).toHaveText('AlphaPool found the most blocks: 384 of 734.');
});

test('pools pie shows the DATUM share of blocks with a key and a screen-reader summary', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  const pie = page.locator('#pools-pie');
  await expect(pie).toBeVisible();
  await expect(pie.locator('.pie-centre strong')).toHaveText('64.0%'); // (380 + 0 + 90) / 734 blocks
  await expect(pie.locator('.pie-key')).toBeVisible();
  await expect(pie.locator('.pie-summary')).toHaveText('Pie chart: miners built 64.0% of the 734 blocks in the last 24 hours with DATUM; pools built the rest (Stratum).');
  await expect(pie.locator('svg text')).toHaveCount(3);
  expect((await pie.locator('svg text').allTextContents()).sort()).toEqual(['AlphaPool', 'BravoPool', 'CharliePool']);
});

test('24H, 7D and 30D switch both the pool list and the pie', async ({ page }) => {
  const ranges = [];
  await page.route('**/api/history?series=pools**', (r) => {
    const range = new URL(r.request().url()).searchParams.get('range');
    ranges.push(range);
    const points = { '7d': [['Week', 70, 35, [['m', 35]]], ['Other', 30, 0, []]], '1m': [['Month', 40, 20, [['m', 20]]]] }[range] ?? [['Day', 10, 10, [['m', 10]]]];
    return r.fulfill({ json: { series: 'pools', range, source: 'test', points } });
  });
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  const day = page.locator('.mining-pools .tab', { hasText: '24H' }), week = page.locator('.mining-pools .tab', { hasText: '7D' });
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#pools-week-summary')).toHaveText('Day found the most blocks: 10 of 10.');
  await expect(page.locator('.pie-centre strong')).toHaveText('100.0%');
  await week.click();
  await expect(week).toHaveAttribute('aria-pressed', 'true');
  await expect(day).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#pools-week-summary')).toHaveText('Week found the most blocks: 70 of 100.');
  await expect(page.locator('.pie-centre strong')).toHaveText('35.0%');
  await expect(page.locator('.pie-summary')).toContainText('in the last 7 days');
  await page.locator('.mining-pools .tab', { hasText: '30D' }).click();
  await expect(page.locator('#pools-week-summary')).toHaveText('Month found the most blocks: 40 of 40.');
  await expect(page.locator('.pie-summary')).toContainText('in the last 30 days');
  expect(ranges).toEqual(['1d', '7d', '1m']);
});

test('pools pie without DATUM data (backup explorer) still draws slices, centre says n/a', async ({ page }) => {
  await page.route('**/api/history?series=pools**', (r) => r.fulfill({ json: { series: 'pools', range: '1d', source: 'test', points: [['A', 5], ['B', 3]] } }));
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  await expect(page.locator('#pools-pie')).toBeVisible();
  await expect(page.locator('.pie-centre strong')).toHaveText('n/a');
  await expect(page.locator('.pie-key')).toBeHidden();
});

test('pools card says so when pool data is unavailable', async ({ page }) => {
  await page.route('**/api/history?series=pools**', (r) => r.fulfill({ status: 502, body: 'down' }));
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  await expect(page.locator('#pools-week-summary')).toHaveText('Pool data is unavailable right now.');
  await expect(page.locator('#pools-pie')).toBeHidden();
});

test('pools card fits a 390 px phone: pie above the list, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  const pie = page.locator('#pools-pie');
  await expect(pie).toBeVisible();
  const pieBox = await pie.boundingBox(), listBox = await page.locator('#pools-week').boundingBox();
  expect(pieBox.y).toBeLessThan(listBox.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});

test('pools card shows the top 10 and a button reveals the rest', async ({ page }) => {
  const points = Array.from({ length: 15 }, (_, i) => [`Pool ${i + 1}`, 100 - i * 5]);
  await page.route('**/api/history?series=pools**', (r) => r.fulfill({ json: { series: 'pools', range: '1m', source: 'test', points } }));
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  const visible = page.locator('#pools-week li:visible');
  await expect(visible).toHaveCount(10);
  const more = page.locator('.list-more');
  await expect(more).toHaveText('Show all 15 pools');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(visible).toHaveCount(15);
  await expect(more).toHaveText('Show top 10');
  await more.click();
  await expect(visible).toHaveCount(10);
});

test('no button when there are 10 pools or fewer', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/mining');
  await expect(page.locator('#pools-week li')).toHaveCount(3);
  await expect(page.locator('.list-more')).toHaveCount(0);
});
