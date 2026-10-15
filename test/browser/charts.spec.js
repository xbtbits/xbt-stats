import { test, expect } from '@playwright/test';

const FRESH = 1791660035000;

test('home price chart draws and switches range', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('#price-chart .uplot')).toHaveCount(1);
  await expect(page.locator('#price-chart .chart-summary')).toHaveText('XBT price $852.00, up 1.4% over this range.');
  const req = page.waitForRequest((r) => r.url().includes('series=price&range=7d'));
  await page.locator('#price-chart [data-range="7d"]').click();
  await req;
  await expect(page.locator('#price-chart [data-range="7d"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#price-chart [data-log]').click();
  await expect(page.locator('#price-chart [data-log]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#price-chart .uplot')).toHaveCount(1);
});

test('charts page draws every chain chart with a text summary, and no price chart', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(FRESH);
  await page.goto('/charts');
  await expect(page.locator('.plot .uplot')).toHaveCount(5);
  await expect(page.locator('#price-chart')).toHaveCount(0); // the price chart lives on the dashboard only
  await expect(page.locator('[data-series="hashrate"] .chart-summary')).toHaveText('Hashrate 48.77 PH/s, up 109.4% over this range.');
  await expect(page.locator('#pools-week')).toHaveCount(0); // pools moved to the Mining tab
  const req = page.waitForRequest((r) => r.url().includes('series=hashrate&range=3m'));
  await page.locator('[data-series="hashrate"] [data-range="3m"]').click();
  await req;
  expect(errors).toEqual([]);
});

test('a slow older range response never overwrites a newer one', async ({ page }) => {
  await page.route('**/api/history?series=price&range=1d', async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await r.fulfill({ json: { series: 'price', range: '1d', source: 'recorded', points: [[1, 100], [2, 200]] } });
  });
  await page.route('**/api/history?series=price&range=7d', (r) =>
    r.fulfill({ json: { series: 'price', range: '7d', source: 'recorded', points: [[1, 100], [2, 110]] } }));
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await page.locator('#price-chart [data-range="7d"]').click();
  await expect(page.locator('#price-chart .chart-summary')).toHaveText('XBT price $110.00, up 10.0% over this range.');
  await page.waitForTimeout(1200); // let the slow 1d response land
  await expect(page.locator('#price-chart .chart-summary')).toHaveText('XBT price $110.00, up 10.0% over this range.');
  await expect(page.locator('#price-chart [data-range="7d"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a failed history request clears the chart and says so', async ({ page }) => {
  await page.route('**/api/history**', (r) => r.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }));
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('#price-chart .chart-summary')).toHaveText('XBT price: history is unavailable right now.');
  await expect(page.locator('#price-chart .uplot')).toHaveCount(0);
});

for (const path of ['/']) {
  test(`price chart on ${path} offers 1H to ALL (with 3M), 50 MA, 200 MA, then LOG, 1D by default, and YTD requests the ytd range`, async ({ page }) => {
    await page.clock.setFixedTime(FRESH);
    await page.goto(path);
    const buttons = page.locator('#price-chart .chart-head button');
    await expect(buttons).toHaveText(['1H', '1D', '7D', '1M', '3M', 'YTD', '1Y', '5Y', '10Y', 'ALL', '50 MA', '200 MA', 'LOG']);
    const ranges = await page.locator('#price-chart [data-range]').evaluateAll((bs) => bs.map((b) => b.dataset.range));
    expect(ranges).toEqual(['1h', '1d', '7d', '1m', '3m', 'ytd', '1y', '5y', '10y', 'all']);
    await expect(page.locator('#price-chart [data-range="1d"]')).toHaveAttribute('aria-pressed', 'true');
    const req = page.waitForRequest((r) => r.url().includes('series=price&range=ytd'));
    await page.locator('#price-chart [data-range="ytd"]').click();
    await req;
    await expect(page.locator('#price-chart [data-range="ytd"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#price-chart [data-range="1d"]')).toHaveAttribute('aria-pressed', 'false');
  });
}

test('chain charts offer 1D to 10Y with YTD and ALL, 1M by default', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/charts');
  for (const s of ['hashrate', 'difficulty', 'fees', 'mempool', 'blocksize']) {
    await expect(page.locator(`[data-series="${s}"] .chart-head button`)).toHaveText(['1D', '7D', '1M', '3M', 'YTD', '1Y', '5Y', '10Y', 'ALL']);
    await expect(page.locator(`[data-series="${s}"] [data-range="1m"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('[data-series="hashrate"] [data-ma]')).toHaveCount(0);
});

test('hovering the price chart shows a tooltip with value, change and date', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('#price-chart .uplot')).toHaveCount(1);
  await expect(page.locator('#price-chart .chart-tip')).toBeHidden();
  await page.locator('#price-chart .u-over').hover();
  const tip = page.locator('#price-chart .chart-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('$');
  await expect(tip).toContainText(/[A-Z][a-z]{2} \d{1,2}, 2026, \d{1,2}:\d{2} (AM|PM)/);
  await expect(tip.locator('[data-dir]')).toHaveText(/^([+−][\d,]+\.\d{2} \(−?\d+\.\d{2}%\)|0\.00 \(0\.00%\))$/);
  const inside = await page.evaluate(() => {
    const plot = document.querySelector('#price-chart .plot').getBoundingClientRect();
    const t = document.querySelector('#price-chart .chart-tip').getBoundingClientRect();
    return t.left >= plot.left && t.right <= plot.right && t.top >= plot.top && t.bottom <= plot.bottom;
  });
  expect(inside).toBe(true);
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
});

test('a gold current-value tag sits on the value axis', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  const tag = page.locator('#price-chart .chart-tag');
  await expect(tag).toHaveCount(1);
  await expect(tag).toHaveText('852.00');
  const axis = await page.locator('#price-chart .u-axis').nth(1).boundingBox();
  const box = await tag.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(axis.x - 1);
});

test('the price chart hides series points and has no visible summary', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('#price-chart .uplot')).toHaveCount(1);
  await expect(page.locator('#price-chart .chart-summary')).toHaveClass(/sr-only/);
  await expect(page.locator('#price-chart h2.sr-only')).toHaveText('Price chart');
});

test('the value axis is drawn on the right of the plot', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('#price-chart .uplot')).toHaveCount(1);
  const axis = await page.locator('#price-chart .u-axis').nth(1).boundingBox();
  const over = await page.locator('#price-chart .u-over').boundingBox();
  expect(axis.x).toBeGreaterThan(over.x + over.width / 2);
});

test('3M on the dashboard price chart requests the 3m range', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  const req = page.waitForRequest((r) => r.url().includes('series=price&range=3m'));
  await page.locator('#price-chart [data-range="3m"]').click();
  await req;
  await expect(page.locator('#price-chart [data-range="3m"]')).toHaveAttribute('aria-pressed', 'true');
});

const DAY_S = 86_400;
const LAST = 1791659200;
const longHistory = Array.from({ length: 60 }, (_, i) => [LAST - (59 - i) * DAY_S, 800 + i]);

for (const path of ['/']) {
  test(`50 MA toggles on ${path}, adds a series and lists itself in the tooltip`, async ({ page }) => {
    await page.route('**/api/history?series=price&range=all', (r) =>
      r.fulfill({ json: { series: 'price', range: 'all', source: 'recorded', points: longHistory } }));
    await page.clock.setFixedTime(FRESH);
    await page.goto(path);
    const plot = page.locator('#price-chart .plot');
    await expect(plot.locator('.uplot')).toHaveCount(1);
    await expect(plot).toHaveAttribute('data-series-count', '2');
    const btn = page.locator('#price-chart [data-ma="50"]');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(plot).toHaveAttribute('data-series-count', '3');
    await expect(page.locator('#price-chart .chart-ma-note')).toBeHidden();
    await plot.locator('.u-over').hover();
    await expect(page.locator('#price-chart .chart-tip')).toContainText(/50 MA \$[\d,]+\.\d{2}/);
    await page.locator('#price-chart [data-log]').click();
    await expect(plot).toHaveAttribute('data-series-count', '3');
    await btn.click();
    await expect(plot).toHaveAttribute('data-series-count', '2');
  });
}

test('an MA with too little history says when it becomes available, and toggling does not refetch the range', async ({ page }) => {
  let priceRequests = 0;
  page.on('request', (r) => { if (r.url().includes('series=price&range=1d')) priceRequests += 1; });
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await expect(page.locator('#price-chart .uplot')).toHaveCount(1);
  const before = priceRequests;
  await page.locator('#price-chart [data-ma="200"]').click();
  await expect(page.locator('#price-chart .chart-ma-note')).toContainText('200 MA needs 200 days of history');
  await expect(page.locator('#price-chart .plot')).toHaveAttribute('data-series-count', '3');
  await page.locator('#price-chart [data-ma="200"]').click();
  await expect(page.locator('#price-chart .chart-ma-note')).toBeHidden();
  expect(priceRequests).toBe(before);
});

test('pool numbers sit under a "Share · Blocks" column label', async ({ page }) => {
  await page.goto('/mining');
  await expect(page.locator('#pools-week').locator('xpath=..').locator('.pools-col')).toHaveText(/share · blocks/i);
  await expect(page.locator('#pools-week li .pool-share').first()).toHaveText(/^\d+(\.\d)?% · [\d,]+$/);
  await page.goto('/');
  await expect(page.locator('#pools').locator('xpath=..').locator('.pools-col')).toHaveText(/share · blocks/i);
});

const HEADERS = {
  hashrate: [['HASHRATE (CURRENT)', '43.30 PH/s'], ['HASH PRICE', '$10.43 /TH/day'], ['BLOCKS (24H)', '153'], ['LARGEST POOL (24H)', 'AlphaPool (34.0%)']],
  difficulty: [['DIFFICULTY', '21.85 E'], ['EPOCH', '484'], ['EPOCH PROGRESS', '41.1%'], ['RETARGET BLOCK', '977,760'],
    ['BLOCKS TO RETARGET', '1,188'], ['RETARGET ETA', 'Oct 17 (~6d 23h)'], ['ESTIMATED CHANGE', '▲ +17.48%'], ['PREVIOUS CHANGE', '▲ +9.97%']],
  fees: [['AVG FEES PER BLOCK', '0.0028 XBT'], ['TOTAL FEES (144 BLOCKS)', '0.399 XBT ($340)'], ['FEES VS REWARD', '0.09%'], ['BLOCK SUBSIDY VALUE', '$2,662']],
  mempool: [['PENDING TXS', '1,957'], ['MEMPOOL SIZE', '2.34 vMB'], ['BLOCKS TO CLEAR', '12'], ['NEXT BLOCK', '2 sat/vB'], ['30 MIN', '1.5 sat/vB'], ['1 HOUR', '1 sat/vB']],
  blocksize: [['AVG BLOCK SIZE', '438 kB'], ['TXS IN LAST BLOCK', '62'], ['AVG TXS PER BLOCK', '237']],
};

test('every chart card shows its stat header, labels in order, with fixture values', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/charts');
  for (const [series, pairs] of Object.entries(HEADERS)) {
    const dl = page.locator(`[data-series="${series}"] .chart-stats`);
    const labels = await dl.locator('dt').allTextContents(); // CSS upper-cases them
    expect(labels.map((l) => l.toUpperCase())).toEqual(pairs.map((p) => p[0]));
    await expect(dl.locator('dd')).toHaveText(pairs.map((p) => p[1]));
  }
  await expect(page.locator('[data-series="difficulty"] .chart-stats dd[data-dir="up"]')).toHaveCount(2);
  const order = await page.locator('.chart-card').evaluateAll((cs) => cs.map((c) => c.dataset.series));
  expect(order).toEqual(['hashrate', 'difficulty', 'fees', 'mempool', 'blocksize']);
});

test('the stat header sits between the title and the range buttons, with a hairline under it', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/charts');
  const card = page.locator('[data-series="fees"]');
  const h2 = await card.locator('h2').boundingBox();
  const stats = await card.locator('.chart-stats').boundingBox();
  const tabs = await card.locator('.tabs').boundingBox();
  expect(h2.y + h2.height).toBeLessThanOrEqual(stats.y + 1);
  expect(stats.y + stats.height).toBeLessThanOrEqual(tabs.y + 1);
  await expect(card.locator('.chart-stats')).toHaveCSS('border-bottom-width', '1px');
});

test('stat headers show dashes when the snapshot is unavailable', async ({ page }) => {
  await page.route('**/api/snapshot', (r) => r.fulfill({ status: 503, json: { error: 'down' } }));
  await page.clock.setFixedTime(FRESH);
  await page.goto('/charts');
  await expect(page.locator('[data-series="mempool"] .chart-stats dt')).toHaveCount(6);
  await expect(page.locator('[data-series="mempool"] .chart-stats dd')).toHaveText(Array(6).fill('—'));
});

test('stat headers refresh every 60 s while the page is visible', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/snapshot', async (r) => {
    calls += 1;
    await r.continue();
  });
  await page.clock.install({ time: FRESH });
  await page.goto('/charts');
  await expect(page.locator('[data-series="blocksize"] .chart-stats dd').first()).toHaveText('438 kB');
  const before = calls;
  await page.clock.runFor(61_000);
  await expect.poll(() => calls).toBeGreaterThan(before);
});

test('the Block size card renders a chart with a summary and the full range set', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/charts');
  const card = page.locator('[data-series="blocksize"]');
  await expect(card.locator('h2')).toHaveText('Block size');
  await expect(card.locator('.uplot')).toHaveCount(1);
  await expect(card.locator('.chart-head button')).toHaveText(['1D', '7D', '1M', '3M', 'YTD', '1Y', '5Y', '10Y', 'ALL']);
  await expect(card.locator('.chart-summary')).toHaveText('Block size 438 kB, up 4.0% over this range.');
  await expect(card.locator('.chart-tag')).toHaveText('438 kB');
  const req = page.waitForRequest((r) => r.url().includes('series=blocksize&range=all'));
  await card.locator('[data-range="all"]').click();
  await req;
});

for (const width of [375, 640, 768, 1280]) {
  test(`stat headers wrap without sideways scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(FRESH);
    await page.goto('/charts');
    await expect(page.locator('[data-series="difficulty"] .chart-stats dd').first()).toHaveText('21.85 E');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const clipped = await page.locator('.chart-stats').evaluateAll((els) => els.some((e) => e.scrollWidth > e.clientWidth + 1));
    expect(clipped).toBe(false);
    if (width <= 699) {
      const borders = await page.locator('.chart-stats div').evaluateAll((els) => els.map((e) => getComputedStyle(e).borderLeftWidth));
      expect(new Set(borders)).toEqual(new Set(['0px']));
    }
  });
}

test('the charts page only talks to its own origin', async ({ page }) => {
  const foreign = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:4173/') && !r.url().startsWith('data:')) foreign.push(r.url()); });
  await page.clock.setFixedTime(FRESH);
  await page.goto('/charts');
  await expect(page.locator('.plot .uplot')).toHaveCount(5);
  expect(foreign).toEqual([]);
});

test('chart cards have no visible title, the first stat names them (kept for screen readers)', async ({ page }) => {
  await page.goto('/charts');
  for (const [id, text] of [['#c-hashrate', 'Hashrate'], ['#c-difficulty', 'Difficulty'], ['#c-fees', 'Average fees per block'],
    ['#c-mempool', 'Mempool size'], ['#c-blocksize', 'Block size']]) {
    await expect(page.locator(id)).toHaveText(text);
    await expect(page.locator(id)).toHaveClass(/sr-only/);
  }
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('dragging a finger along a chart moves the cursor, tooltip above the finger', async ({ page, context }) => {
    await page.clock.setFixedTime(FRESH);
    await page.goto('/charts');
    const over = page.locator('[data-series="hashrate"] .u-over');
    await over.scrollIntoViewIfNeeded();
    // vertical swipes are left to the browser, so the page still scrolls
    expect(await over.evaluate((e) => getComputedStyle(e).touchAction)).toBe('pan-y');
    const r = await over.boundingBox();
    const y = r.y + r.height * 0.6;
    const cdp = await context.newCDPSession(page);
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const tip = page.locator('[data-series="hashrate"] .chart-tip');
    const dates = new Set();
    await touch('touchStart', r.x + 2);
    for (let i = 0; i <= 6; i++) {
      if (i > 0) await touch('touchMove', r.x + 2 + (i * (r.width - 4)) / 6);
      await expect(tip).toBeVisible();
      dates.add(await tip.locator('.chart-tip-date').textContent());
      const box = await tip.boundingBox();
      expect(box.y + box.height).toBeLessThan(y);
    }
    await touch('touchEnd');
    expect(dates.size).toBe(3); // the fixture has three points: the drag visits all of them
  });
});
