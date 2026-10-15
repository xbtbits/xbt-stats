import { test, expect } from '@playwright/test';

const FRESH = 1791660035000;
const PAGES = ['/', '/charts', '/nodes', '/convert', '/mining', '/about'];

for (const width of [320, 375, 640, 768, 1280]) {
  for (const path of PAGES) {
    test(`no sideways scrolling on ${path} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(FRESH);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

test('keyboard focus is visible', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe('none');
  const width = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth));
  expect(width).toBeGreaterThan(0);
});

test('numbers use even-width digits', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const widths = await page.evaluate(() => {
    const make = (cls, t) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = t;
      document.body.append(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    return {
      hero: [make('num hero-price', '111111'), make('num hero-price', '888888')],
      stat: [make('num', '111111'), make('num', '888888')],
    };
  });
  expect(Math.abs(widths.hero[0] - widths.hero[1])).toBeLessThan(0.5);
  expect(Math.abs(widths.stat[0] - widths.stat[1])).toBeLessThan(0.5);
});

test('the browser only talks to this site', async ({ page, baseURL }) => {
  const origins = new Set();
  page.on('request', (r) => origins.add(new URL(r.url()).origin));
  await page.clock.setFixedTime(FRESH);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect([...origins]).toEqual([new URL(baseURL).origin]);
});

test('manifest and icons load', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('XBT Stats');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  expect((await request.get('/icons/icon-180.png')).status()).toBe(200);
});

test('hashrate counter stays on one line on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const m = await page.evaluate(() => {
    const dd = document.querySelector('.counter [data-k="mining.hashrate"]');
    const cs = getComputedStyle(dd);
    return { text: dd.textContent, h: dd.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight), over: dd.scrollWidth - dd.clientWidth,
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(m.text).toContain('PH/s');
  expect(m.h).toBeLessThanOrEqual(m.lh * 1.6);
  expect(m.over).toBeLessThanOrEqual(0);
  expect(m.scroll).toBeLessThanOrEqual(0);
});

for (const path of [...PAGES, '/404']) {
  test(`LED logo is drawn and keeps its name on ${path}`, async ({ page }) => {
    await page.goto(path);
    const logo = page.locator('.wordmark');
    await expect(logo).toHaveClass(/\bled\b/);
    await expect(logo.locator('canvas')).toHaveAttribute('aria-hidden', 'true');
    await expect(logo).toHaveAccessibleName('XBT Stats');
    await expect(page.getByRole('link', { name: 'XBT Stats' })).toHaveAttribute('href', '/');
  });
}

test('every page footer links the public source code', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('footer a[href="https://github.com/xbtbits/xbt-stats"]')).toHaveText('Source code');
  }
});

test('tab icons load on every page', async ({ page, request }) => {
  for (const src of ['/favicon.ico', '/icons/favicon.svg']) expect((await request.get(src)).status()).toBe(200);
  for (const path of [...PAGES, '/404']) {
    await page.goto(path);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/icons/favicon.svg');
    await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', '/favicon.ico');
  }
});

test('About is cards like the other tabs, with the price-history start and the exchange-link note', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('main .card h2')).toHaveText(['About XBT Stats', 'Where the numbers come from', 'Check it yourself', 'Privacy', 'Disclaimer', 'Network history', 'Sources and status']);
  await expect(page.locator('#upgrades li')).toHaveCount(2);
  await expect(page.locator('[data-k="history.blocksSinceSwitch"]')).not.toHaveText('—');
  // desktop: sources on the left, the four short cards on the right, both columns ending level
  await page.setViewportSize({ width: 1440, height: 900 });
  const src = await page.locator('.about-sources').boundingBox();
  const intro = await page.locator('.about-intro').boundingBox();
  const last = await page.locator('.about-disclaimer').boundingBox();
  expect(src.x).toBeLessThan(intro.x);
  expect(Math.abs(src.y - intro.y)).toBeLessThan(1);
  expect(Math.abs((src.y + src.height) - (last.y + last.height))).toBeLessThan(1);
  await expect(page.locator('main')).toContainText('Price history starts Sep 1, 2026');
  await expect(page.locator('main')).not.toContainText('starts on the day this site began recording');
  await expect(page.locator('main')).toContainText('The two Neoxa markets are the only links on this site to an exchange.');
});

test('page not found: LED 404 over a live gold code shimmer, still for reduce-motion', async ({ page }) => {
  await page.goto('/404');
  await expect(page.locator('h1')).toHaveText(/404\s+Page not found/i);
  await expect(page.locator('.nf-led')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.nf-bg')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(page.locator('.nf')).toHaveAttribute('data-motion', 'live');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.nf')).toHaveAttribute('data-motion', 'still');
});

// Serves the dashboard with the donation address replaced (whatever the shipped one is).
async function withAddress(page, value) {
  await page.route('**/', async (r) => {
    if (new URL(r.request().url()).pathname !== '/') return r.continue();
    const res = await r.fetch();
    r.fulfill({ response: res, body: (await res.text()).replace(/data-address="[^"]*"/, `data-address="${value}"`) });
  });
}

test('dashboard donation card: "coming soon" without an address, then address, copy and QR once one is set', async ({ page, context }) => {
  await withAddress(page, '');
  await page.goto('/');
  const card = page.locator('#donate');
  await expect(card).toHaveAttribute('data-state', 'pending');
  await expect(card.locator('#donate-address')).toHaveText('Donation address coming soon');
  await expect(card.locator('.donate-copy')).toBeDisabled();
  await expect(card.locator('.donate-qr')).toBeHidden();
  await expect(card).toContainText('XBT (BLAKE2b) chain only.');

  const sample = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'; // test value, never shipped
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.unrouteAll();
  await withAddress(page, sample);
  await page.reload();
  await expect(card).toHaveAttribute('data-state', 'ready');
  await expect(card.locator('#donate-address')).toHaveText(sample);
  await expect(card.locator('.donate-qr')).toBeVisible();
  await card.locator('.donate-copy').click();
  await expect(card.locator('.donate-copy')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sample);
});

test('dashboard donation card ignores a value that is not an address', async ({ page }) => {
  await withAddress(page, 'PASTE ADDRESS HERE');
  await page.goto('/');
  await expect(page.locator('#donate')).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('.donate-qr')).toBeHidden();
});

test('Network history lives on About, the donation card on the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#h-history')).toHaveCount(0);
  await expect(page.locator('#donate')).toHaveCount(1);
  await page.goto('/about');
  await expect(page.locator('#donate')).toHaveCount(0);
});

test('donation address box shows a whole long (bc1p) address on one line on desktop', async ({ page }) => {
  const taproot = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'; // test value, never shipped
  await page.setViewportSize({ width: 1440, height: 900 });
  await withAddress(page, taproot);
  await page.goto('/');
  const box = page.locator('#donate-address');
  await expect(box).toHaveText(taproot);
  expect(await box.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await expect(page.locator('.donate-warn')).toHaveText('XBT (BLAKE2b) chain only.');
  expect(await page.locator('.donate-warn').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(234, 180, 72)');
});

test('the dashboard ships the owner\'s donation address, ready to copy and scan', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#donate');
  await expect(card).toHaveAttribute('data-state', 'ready');
  await expect(card.locator('#donate-address')).toHaveText('bc1q0m70hu6z59l2kffwwk0sfdd0f94z9y6gjzta2s');
  await expect(card.locator('.donate-copy')).toBeEnabled();
  await expect(card.locator('.donate-qr')).toBeVisible();
});
