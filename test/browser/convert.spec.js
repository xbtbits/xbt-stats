import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snap = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
const P = snap.price.usd; // 851.9869956632151
const AT = snap.price.updatedAt + 2 * 60_000;
const xbt = (u) => (u / P).toFixed(8).replace(/0+$/, '');
const sats = (u) => Math.round((u / P) * 1e8).toLocaleString('en-US');

test('defaults to 1 XBT and shows the rate line', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(AT);
  await page.goto('/convert');
  await expect(page.getByLabel('XBT', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Sats')).toHaveValue('100,000,000');
  await expect(page.getByLabel('USD')).toHaveValue('851.99');
  await expect(page.locator('#convert-rate')).toHaveText('1 XBT = $851.99 · 1 USD = 117,372 sats · price updated 2 min ago');
  await expect(page.locator('.credit')).toHaveText('Converted at the live USD price (USDT/USDC markets counted as $1); other currencies use today’s exchange rates.');
  await expect(page.locator('footer')).toContainText('Not financial advice.'); // said once, in the footer
  await expect(page.locator('nav.nav a[aria-current="page"]')).toHaveText('Converter');
  await expect(page.locator('.convert-card button')).toHaveCount(0); // no quick-amount buttons
  expect(errors).toEqual([]);
});

test('typing USD updates XBT and sats without reformatting the typed field', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/convert');
  const usd = page.getByLabel('USD');
  await usd.fill('');
  await usd.pressSequentially('100');
  await expect(page.getByLabel('XBT', { exact: true })).toHaveValue(xbt(100));
  await expect(page.getByLabel('XBT', { exact: true })).toHaveValue('0.11737268');
  await expect(page.getByLabel('Sats')).toHaveValue('11,737,268');
  await expect(usd).toHaveValue('100');
  await usd.blur();
  await expect(usd).toHaveValue('100.00');
});

test('typing sats and XBT converts the other fields', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/convert');
  await page.getByLabel('Sats').fill('1');
  await expect(page.getByLabel('XBT', { exact: true })).toHaveValue('0.00000001');
  await page.getByLabel('XBT', { exact: true }).fill('0.123456789');
  await expect(page.getByLabel('Sats')).toHaveValue('12,345,679');
});

test('invalid text shows no conversion and too-large shows a message', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/convert');
  await page.getByLabel('USD').fill('12abc');
  await expect(page.getByLabel('XBT', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Sats')).toHaveValue('');
  await expect(page.locator('#convert-msg')).toContainText('Enter a number');
  await page.getByLabel('USD').fill('-5');
  await expect(page.getByLabel('Sats')).toHaveValue('');
  await page.getByLabel('XBT', { exact: true }).fill('21000001');
  await expect(page.locator('#convert-msg')).toHaveText('Too large');
  await expect(page.getByLabel('Sats')).toHaveValue('');
  await expect(page.getByLabel('USD')).toHaveValue('');
  await page.getByLabel('XBT', { exact: true }).fill('');
  await expect(page.locator('#convert-msg')).toHaveText('');
});

test('without a price the inputs are disabled with a note', async ({ page }) => {
  await page.route('**/api/snapshot', (r) => r.fulfill({ json: JSON.parse(readFileSync(new URL('../fixtures/snapshot-empty.json', import.meta.url), 'utf8')) }));
  await page.goto('/convert');
  await expect(page.getByLabel('XBT', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('USD')).toBeDisabled();
  await expect(page.locator('#convert-msg')).toHaveText('Waiting for the first price.');
});

test('offline notice when the server is unreachable, inputs stay disabled', async ({ page }) => {
  await page.route('**/api/snapshot', (r) => r.fulfill({ status: 503, json: { error: 'x' } }));
  await page.goto('/convert');
  await expect(page.locator('#notice-offline')).toBeVisible();
  await expect(page.getByLabel('Sats')).toBeDisabled();
});

test('refreshes the price every 30 s and recomputes from the last edited field', async ({ page }) => {
  let price = P;
  await page.route('**/api/snapshot', (r) => {
    const s = structuredClone(snap);
    s.price.usd = price;
    return r.fulfill({ json: s });
  });
  await page.clock.install({ time: AT });
  await page.goto('/convert');
  await page.getByLabel('USD').fill('100');
  await expect(page.getByLabel('Sats')).toHaveValue('11,737,268');
  price = 1000;
  await page.clock.runFor(31_000);
  await expect(page.getByLabel('XBT', { exact: true })).toHaveValue('0.1');
  await expect(page.getByLabel('Sats')).toHaveValue('10,000,000');
});

test('makes only same-origin requests', async ({ page }) => {
  const foreign = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:4173/')) foreign.push(r.url()); });
  await page.goto('/convert');
  await page.waitForLoadState('networkidle');
  expect(foreign).toEqual([]);
});

const fx = JSON.parse(readFileSync(new URL('../fixtures/fx.json', import.meta.url), 'utf8'));

test('world currencies: 18 rows of 1 XBT and sats per unit, with the rate source credited', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/convert');
  const rows = page.locator('#world-body tr');
  await expect(rows).toHaveCount(18);
  await expect(rows.first().locator('th')).toHaveText('Euro EUR');
  const eur = P * fx.rates.EUR;
  await expect(rows.first().locator('td').first()).toHaveText(`€${eur.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  await expect(rows.first().locator('td').nth(1)).toHaveText(Math.floor(1e8 / eur).toLocaleString('en-US'));
  await expect(rows.first().locator('.fiat-sym')).toHaveText('€'); // symbol drawn in the body font
  await expect(rows.nth(2).locator('th')).toHaveText('Japanese Yen JPY');
  await expect(rows.nth(2).locator('td').first()).toHaveText(`¥${Math.round(P * fx.rates.JPY).toLocaleString('en-US')}`);
  await expect(rows.last().locator('th')).toHaveText('UAE Dirham AED');
  await expect(page.locator('#world-source')).toContainText('Rates by ExchangeRate-API');
  await expect(page.locator('#world-source a')).toHaveAttribute('href', 'https://www.exchangerate-api.com');
});

test('world currencies say so when the rates are unavailable', async ({ page }) => {
  await page.route('**/api/fx', (r) => r.fulfill({ status: 503, body: '{"error":"temporarily unavailable"}' }));
  await page.goto('/convert');
  await expect(page.locator('#world-source')).toHaveText('Exchange rates are unavailable right now.');
  await expect(page.locator('#world-body tr')).toHaveCount(0);
});

test('desktop: world currencies on the left, the right column level with it; phones put the converter column first', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/convert');
  const world = await page.locator('.world-card').boundingBox();
  const top = await page.locator('.convert-card').boundingBox();
  expect(world.x).toBeLessThan(top.x);
  expect(Math.abs(world.y - top.y)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  // phones: Converter, Exchanges, Moving averages, World currencies
  const ys = await Promise.all(['.convert-card', '.markets-card', '.ma-card', '.world-card'].map(async (s) => (await page.locator(s).boundingBox()).y));
  expect(ys).toEqual([...ys].sort((a, b) => a - b));
});

test('exchanges list every market, link only Neoxa, and explain the gaps', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/convert');
  const rows = page.locator('#markets-body tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('th')).toHaveText(['NonKYC BTCB2/USDT', 'Neoxa XBT/USDC ↗', 'Neoxa XBT/USDT ↗*']);
  await expect(rows.nth(0).locator('a')).toHaveCount(0); // no link for NonKYC
  await expect(rows.nth(1).locator('a')).toHaveAttribute('href', 'https://neoxa.exchange/trade/BTCB2_USDC');
  await expect(rows.nth(2).locator('a')).toHaveAttribute('href', 'https://neoxa.exchange/trade/BTCB2_USDT');
  await expect(rows.nth(0).locator('td')).toHaveText(['$849.52', '847.10 / 851.30', '$766.92K']);
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText('—');
  await expect(page.locator('#markets-note')).toContainText('no bid or ask');
  await expect(page.locator('#markets-note')).toContainText('too little volume to count toward the site’s price');
  await expect(page.locator('#markets-body')).not.toContainText('BTC)'); // no BTC-quoted market
});

test('moving averages: 50- and 200-day averages of daily closes and the price against them', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await page.goto('/convert');
  for (const k of ['ma.50', 'ma.200']) await expect(page.locator(`[data-k="${k}"]`)).toHaveText(/^\$[\d,]+\.\d\d$|^In \d+ days?$/);
  await expect(page.locator('[data-k="ma.ratio50"]')).toHaveText(/^\d+\.\d\d×$|^In \d+ days?$/);
  await expect(page.locator('.ma-card .row dt')).toHaveText(['50-day average', '200-day average', 'Price / 50-day average', 'Price / 200-day average']);
});

test('moving averages say when they start while the price history is too short', async ({ page }) => {
  const day = 86_400, start = Date.UTC(2026, 8, 1, 12) / 1000;
  const points = Array.from({ length: 42 }, (_, i) => [start + i * day, 600 + i]);
  await page.route('**/api/history?series=price**', (r) => r.fulfill({ json: { series: 'price', range: 'all', source: 'test', points } }));
  await page.goto('/convert');
  await expect(page.locator('[data-k="ma.50"]')).toHaveText('In 8 days');
  await expect(page.locator('[data-k="ma.ratio50"]')).toHaveText('In 8 days');
  await expect(page.locator('[data-k="ma.200"]')).toHaveText('In 158 days');
  await expect(page.locator('[data-k="ma.ratio200"]')).toHaveText('In 158 days');
});

test('desktop right column: converter, exchanges, moving averages, ending level with world currencies', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/convert');
  await expect(page.locator('#world-body tr')).toHaveCount(18);
  const ys = await Promise.all(['.convert-card', '.markets-card', '.ma-card'].map(async (s) => (await page.locator(s).boundingBox()).y));
  expect(ys).toEqual([...ys].sort((a, b) => a - b));
  const world = await page.locator('.world-card').boundingBox();
  expect(world.x).toBeLessThan((await page.locator('.markets-card').boundingBox()).x);
  const ma = await page.locator('.ma-card').boundingBox();
  expect(Math.abs((world.y + world.height) - (ma.y + ma.height))).toBeLessThan(1); // same bottom line
});

test('while the first price loads the converter says so calmly, then unlocks', async ({ page }) => {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/api/snapshot', async (route) => { await held; await route.continue(); });
  await page.goto('/convert');
  await expect(page.locator('#convert-rate')).toHaveText('Loading the live price…');
  await expect(page.locator('#convert-msg')).toHaveText(''); // no red warning on a normal load
  await expect(page.getByLabel('XBT', { exact: true })).toBeDisabled();
  release();
  await expect(page.getByLabel('XBT', { exact: true })).toBeEnabled();
  await expect(page.locator('#convert-rate')).toContainText('1 XBT = $');
});

test('a failed first request is retried at once, not after 30 s', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/snapshot', async (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 503, json: { error: 'temporarily unavailable' } });
    return route.continue();
  });
  await page.goto('/convert');
  await expect(page.getByLabel('XBT', { exact: true })).toBeEnabled({ timeout: 4000 });
  expect(calls).toBe(2);
});
