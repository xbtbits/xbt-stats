import { test, expect } from '@playwright/test';

const PAGES = { '/': '/', '/charts': '/charts', '/convert': '/convert', '/mining': '/mining', '/nodes': '/nodes', '/about': '/about' };
const meta = (page, sel) => page.locator(sel).first().getAttribute('content');

for (const [path, canonical] of Object.entries(PAGES)) {
  test(`${path} has link-preview tags pointing at xbtstats.com`, async ({ page, request }) => {
    // Crawlers read the page as served: the home page later swaps its tab title for the live price.
    const servedTitle = /<title>(.*?)<\/title>/.exec(await (await request.get(path)).text())[1];
    await page.goto(path);
    const url = `https://xbtstats.com${canonical}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', url);
    expect(await meta(page, 'meta[property="og:url"]')).toBe(url);
    expect(await meta(page, 'meta[property="og:type"]')).toBe('website');
    expect(await meta(page, 'meta[property="og:site_name"]')).toBe('XBT Stats');
    expect(await meta(page, 'meta[property="og:title"]')).toBe(servedTitle);
    expect(await meta(page, 'meta[property="og:description"]')).toBe(await meta(page, 'meta[name="description"]'));
    expect(await meta(page, 'meta[property="og:image"]')).toBe('https://xbtstats.com/og.png');
    expect(await meta(page, 'meta[property="og:image:width"]')).toBe('1200');
    expect(await meta(page, 'meta[property="og:image:height"]')).toBe('630');
    expect(await meta(page, 'meta[property="og:image:alt"]')).toBeTruthy();
    expect(await meta(page, 'meta[name="twitter:card"]')).toBe('summary_large_image');
  });
}

test('the preview image is a 1200 x 630 PNG', async ({ request }) => {
  const res = await request.get('/og.png');
  expect(res.status()).toBe(200);
  const b = await res.body();
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1200, 630]);
});
