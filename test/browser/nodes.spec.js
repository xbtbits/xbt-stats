import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const nodes = JSON.parse(readFileSync(new URL('../fixtures/nodes.json', import.meta.url), 'utf8'));
const AT = nodes.updatedAt + 12 * 60_000;

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test('renders counters, sync, soft fork and versions from /api/nodes', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.setFixedTime(AT);
  await page.goto('/nodes');
  await expect(page.locator('.counter dt')).toHaveText([/reachable nodes/i, /known nodes/i, /stable nodes/i, /coinbase lock enforcing/i]);
  expect(await page.locator('.counter-lock dt').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(108, 192, 74)'); // green
  await expect(page.locator('[data-k="nodes.reachable"]')).toHaveText('962');
  await expect(page.locator('[data-k="nodes.known"]')).toHaveText('1,745');
  await expect(page.locator('[data-k="nodes.stable"]')).toHaveText('825');
  await expect(page.locator('[data-k="nodes.stable"]')).toHaveAttribute('title', /90% of the time over 1d \(825 of 957 observed\)/);
  await expect(page.locator('[data-k="nodes.enforcingPct"]')).toHaveText('84.8%');

  await expect(page.locator('#h-sync')).toHaveText('Sync status');
  await expect(page.locator('[data-k^="sync."]')).toHaveText(['945', '14', '1', '2']);
  // LED bar: every LED lit, in sync order; the tiny parts keep one LED each so they stay visible.
  const bar = page.locator('#sync-bar');
  const n = Math.floor(((await bar.boundingBox()).width + 1) / 6);
  const classes = await bar.locator('i').evaluateAll((leds) => leds.map((l) => l.className));
  expect(classes).toHaveLength(n);
  expect(classes.filter((c, i) => c !== classes[i - 1])).toEqual(['tip', 'near', 'day', 'behind']);
  expect(classes.filter((c) => c === 'tip').length).toBe(n - 3);
  await expect(page.locator('#fork-progress i').first()).toHaveClass('on');

  await expect(page.locator('#h-fork')).toHaveText('Coinbase lock soft fork');
  await expect(page.locator('[data-k="fork.window"]')).toHaveText('973,440 → 979,920');
  await expect(page.locator('[data-k="fork.enforcing"]')).toHaveText('816 (84.8%)');
  await expect(page.locator('[data-k="fork.notEnforcing"]')).toHaveText('146');
  await expect(page.locator('[data-k="fork.progress"]')).toHaveText('48.3%'); // snapshot height 976,572
  await expect(page.locator('[data-k="fork.remaining"]')).toHaveText('3,348');
  await expect(page.locator('#fork-progress')).toHaveAttribute('aria-valuenow', '48.3');

  const versions = page.locator('#versions li');
  await expect(versions).toHaveCount(13);
  await expect(versions.first().locator('.pool-name')).toHaveText('Knots 20260508 · 29.4.2');
  await expect(versions.first().locator('.pool-share')).toHaveText('774 · 80.5%');
  await expect(versions.last().locator('.pool-name')).toHaveText('Other');
  await expect(page.locator('#versions .tag-enforcing')).toHaveCount(2);
  await expect(versions.nth(0).locator('.tag-enforcing')).toHaveText('Coinbase lock');
  await expect(versions.nth(3).locator('.tag-enforcing')).toHaveCount(1);
  await expect(versions.nth(1).locator('.tag-enforcing')).toHaveCount(0);

  const credit = page.locator('.credit');
  await expect(credit).toContainText('Node data: B2B Node Census (independent crawler, updated hourly)');
  await expect(credit).toContainText('Reachable counts are a lower bound');
  await expect(credit).toContainText('Updated 12 min ago');
  const link = credit.locator('a');
  await expect(link).toHaveAttribute('href', 'https://github.com/LionThunderFingers/Bitcoin-Node-census');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).not.toHaveAttribute('target', /./);
  await expect(page.locator('.notice:not([hidden])')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the nodes chart draws reachable, enforcing and known, and the tooltip lists all three', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/nodes');
  const plot = page.locator('#nodes-chart .plot');
  await expect(plot.locator('.uplot')).toHaveCount(1);
  await expect(plot).toHaveAttribute('data-series-count', '4'); // x + three lines
  await expect(page.locator('#nodes-chart .chart-tag')).toHaveText('962');
  await plot.locator('.u-over').hover();
  const tip = page.locator('#nodes-chart .chart-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/Reachable [\d,]+/);
  await expect(tip).toContainText(/Coinbase lock [\d,]+/);
  await expect(tip).toContainText(/Known [\d,]+/);
  const axis = await plot.locator('.u-axis').nth(1).boundingBox();
  const over = await plot.locator('.u-over').boundingBox();
  expect(axis.x).toBeGreaterThan(over.x + over.width / 2);
});

test('range buttons slice the history in the browser, ALL by default, with no extra request', async ({ page }) => {
  let hits = 0;
  page.on('request', (r) => { if (r.url().includes('/api/nodes')) hits += 1; });
  await page.clock.setFixedTime(AT);
  await page.goto('/nodes');
  const summary = page.locator('#nodes-chart .chart-summary');
  await expect(page.locator('#nodes-chart .chart-head button')).toHaveText(['7D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y', 'ALL']);
  // title on its own line, range buttons under it starting at the left edge
  const title = await page.locator('#c-nodes').boundingBox();
  const first = await page.locator('#nodes-chart [data-range="7d"]').boundingBox();
  expect(first.y).toBeGreaterThan(title.y + title.height - 1);
  expect(Math.abs(first.x - title.x)).toBeLessThan(12);
  await expect(page.locator('#nodes-chart [data-range="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(summary).toHaveText('Reachable nodes 962, up 13.7x over this range.');
  const before = hits;
  await page.locator('#nodes-chart [data-range="7d"]').click();
  await expect(summary).toHaveText('Reachable nodes 962, up 19.4% over this range.');
  await expect(page.locator('#nodes-chart [data-range="7d"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#nodes-chart [data-range="all"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#nodes-chart [data-range="1m"]').click();
  await expect(summary).toHaveText('Reachable nodes 962, up 228.3% over this range.');
  await expect(page.locator('#nodes-chart .uplot')).toHaveCount(1);
  expect(hits).toBe(before);
});

test('without a snapshot the window progress shows a dash', async ({ page }) => {
  await page.route('**/api/snapshot', (r) => r.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }));
  await page.clock.setFixedTime(AT);
  await page.goto('/nodes');
  await expect(page.locator('[data-k="nodes.reachable"]')).toHaveText('962');
  await expect(page.locator('[data-k="fork.progress"]')).toHaveText('—');
  await expect(page.locator('[data-k="fork.remaining"]')).toHaveText('—');
  await expect(page.locator('#fork-progress')).not.toHaveAttribute('aria-valuenow', /./);
  await expect(page.locator('#notice-offline')).toBeHidden();
});

test('a finished activation window says Complete', async ({ page }) => {
  const snap = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
  snap.chain.height = 980000;
  await page.route('**/api/snapshot', (r) => r.fulfill({ json: snap }));
  await page.clock.setFixedTime(AT);
  await page.goto('/nodes');
  await expect(page.locator('[data-k="fork.progress"]')).toHaveText('100.0%');
  await expect(page.locator('[data-k="fork.remaining"]')).toHaveText('Complete');
});

test('unavailable node data shows a notice and dashes', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('**/api/nodes', (r) => r.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }));
  await page.clock.setFixedTime(AT);
  await page.goto('/nodes');
  await expect(page.locator('#notice-offline')).toBeVisible();
  await expect(page.locator('#notice-offline')).toContainText('Node data is unavailable right now.');
  await expect(page.locator('[data-k="nodes.reachable"]')).toHaveText('—');
  expect(errors.filter((e) => !/503/.test(e))).toEqual([]);
});

test('refreshes every 10 minutes and keeps the last data when the server is down', async ({ page }) => {
  let hits = 0;
  let down = false;
  await page.route('**/api/nodes', (r) => {
    hits += 1;
    return down ? r.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }) : r.fulfill({ json: nodes });
  });
  await page.clock.install({ time: AT });
  await page.goto('/nodes');
  await expect(page.locator('[data-k="nodes.reachable"]')).toHaveText('962');
  const first = hits;
  await page.clock.runFor(9 * 60_000);
  expect(hits).toBe(first);
  down = true;
  await page.clock.runFor(61_000);
  await expect.poll(() => hits).toBe(first + 1);
  await expect(page.locator('#notice-offline')).toContainText('Showing the last data received.');
  await expect(page.locator('[data-k="nodes.reachable"]')).toHaveText('962');
});

for (const path of ['/', '/charts', '/nodes', '/convert', '/about', '/404']) {
  test(`nav on ${path} shows Nodes before Mining and About`, async ({ page }) => {
    await page.clock.setFixedTime(AT);
    await page.goto(path);
    const links = page.locator('nav.nav a');
    await expect(links).toHaveText(['Dashboard', 'Charts', 'Nodes', 'Mining', 'Converter', 'About']);
    await expect(links.nth(2)).toHaveAttribute('href', '/nodes');
    await expect(links.nth(2)).toHaveCSS('text-transform', 'uppercase');
    if (path === '/nodes') await expect(page.locator('nav.nav a[aria-current="page"]')).toHaveText('Nodes');
    else await expect(links.nth(2)).not.toHaveAttribute('aria-current', /./);
  });
}

test('on a phone the nodes chart keeps most of the card width and its tag inside the card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nodes');
  const over = page.locator('.plot .u-over').first();
  await expect(over).toBeVisible();
  const sizes = await page.evaluate(() => {
    const plot = document.querySelector('.plot');
    const card = plot.closest('.card').getBoundingClientRect();
    const tag = plot.querySelector('.chart-tag').getBoundingClientRect();
    return { over: plot.querySelector('.u-over').clientWidth, plot: plot.clientWidth, tagRight: tag.right, cardRight: card.right };
  });
  expect(sizes.over / sizes.plot).toBeGreaterThan(0.7); // value axis sized to its labels, not a fixed 96px
  expect(sizes.tagRight).toBeLessThanOrEqual(sizes.cardRight);
});

test('node versions show the top 5; a button reveals all and stays open across refreshes', async ({ page }) => {
  await page.clock.install({ time: AT });
  await page.goto('/nodes');
  const items = page.locator('#versions li');
  await expect(items).toHaveCount(13);
  await expect(page.locator('#versions li:visible')).toHaveCount(5);
  const more = page.locator('.list-more');
  await expect(more).toHaveText('Show all 13 versions');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(page.locator('#versions li:visible')).toHaveCount(13);
  await expect(more).toHaveText('Show top 5');
  // the page re-renders when it refreshes the census; the list stays open
  await page.clock.runFor(15 * 60_000);
  await expect(page.locator('#versions li:visible')).toHaveCount(13);
  await expect(page.locator('.list-more')).toHaveText('Show top 5');
});

test('desktop: the node counters are centred in their columns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/nodes');
  await expect(page.locator('.counters')).toHaveClass(/counters-centered/);
  expect(await page.locator('.counter').first().evaluate((c) => getComputedStyle(c).alignItems)).toBe('center');
});

test('desktop: cards read Node versions, Soft fork, Sync status; summary bars sit on the card bottoms', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/nodes');
  await expect(page.locator('main .grid > .card h2')).toHaveText(['Node versions', 'Coinbase lock soft fork', 'Sync status']);
  for (const id of ['#fork-progress', '#sync-bar']) {
    const gap = await page.locator(id).evaluate((bar) => bar.closest('.card').getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom);
    expect(gap).toBeLessThan(25); // just the card padding
  }
});
