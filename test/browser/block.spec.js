import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
const FRESH = snapshot.generatedAt + 5_000;

test('the block card sits where Next halving was, before the halving cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.grid > .card h2')).toHaveText([
    'Blockchain', 'Difficulty', 'Mining', 'Mining pools (24h)', 'Fees and mempool',
    'What’s in your block?', 'Next halving', 'Future halvings', 'Future supply',
  ]);
});

test('the block card draws the block map and the plain facts', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/');
  const card = page.locator('#block-card');
  await expect(card.locator('.block-legend span')).toHaveText(['XBT transactions', 'OP_RETURN data']);
  const map = card.locator('canvas.block-map');
  await expect(map).toHaveAttribute('data-tiles', '181');
  await expect(map).toHaveAttribute('data-data-tiles', '3');
  await expect(map).toHaveAttribute('aria-label', 'Block 976,572: 181 transactions, 3 with an OP_RETURN data output. Each tile is one transaction, sized by its share of the block.');
  await expect(card.locator('[data-b="title"]')).toHaveText('Block 976,572');
  await expect(card.locator('[data-b="age"]')).toHaveText('4 min ago');
  await expect(card.locator('[data-b="txs"]')).toHaveText('181');
  await expect(card.locator('[data-b="opReturn"]')).toHaveText('3 · 135 B');
  await expect(card.locator('[data-b="share"]')).toHaveText('0.04%');
  await expect(card.locator('[data-b="envelopes"]')).toHaveText('0');
});

test('the share of block is white, the colour of OP_RETURN data in the legend', async ({ page }) => {
  await page.goto('/');
  const share = page.locator('#block-card [data-b="share"]');
  await expect(share).toHaveText('0.04%');
  const color = (el) => getComputedStyle(el).color;
  const legend = await page.locator('#block-card .block-legend span.d').evaluate((e) => getComputedStyle(e, '::before').backgroundColor);
  expect(await share.evaluate(color)).toBe(legend);
});

test('the share bar uses the price chart\'s LED blocks: 5 px squares on a 6 px grid, as many as fit', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const bar = page.locator('#block-card .ledbar');
    const barBox = await bar.boundingBox();
    const blocks = bar.locator('i');
    await expect(blocks).toHaveCount(Math.floor((barBox.width + 1) / 6));
    const a = await blocks.nth(0).boundingBox();
    const b = await blocks.nth(1).boundingBox();
    expect([a.width, a.height, b.x - a.x]).toEqual([5, 5, 6]);
    await expect(bar.locator('i.d')).toHaveCount(0); // 0.04% fills no whole block
    await expect(blocks.last().locator('.tick')).toHaveCount(1);
  }
});

test('the block map is drawn in the price chart\'s LED blocks: whole 5 px blocks on a 6 px grid', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const map = page.locator('#block-card canvas.block-map');
    await expect(map).toHaveAttribute('data-tiles', '181');
    const box = await map.boundingBox();
    expect((Math.round(box.width) + 1) % 6).toBe(0);
    expect((Math.round(box.height) + 1) % 6).toBe(0);
    const leds = Number(await map.getAttribute('data-leds'));
    expect(leds).toBe(((Math.round(box.width) + 1) / 6) * ((Math.round(box.height) + 1) / 6));
    expect(Number(await map.getAttribute('data-data-leds'))).toBeGreaterThan(0);
  }
});

test('on a computer the map sits beside the facts and the card keeps its neighbours\' height', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('#block-card canvas.block-map')).toHaveAttribute('data-tiles', '181');
  const map = await page.locator('#block-card canvas.block-map').boundingBox();
  const facts = await page.locator('#block-card .block-facts').boundingBox();
  expect(map.x + map.width).toBeLessThanOrEqual(facts.x);
  const fees = await page.locator('section[aria-labelledby="h-fees"]').boundingBox();
  const card = await page.locator('#block-card').boundingBox();
  expect(card.height).toBe(fees.height); // same row, same height
  expect(card.height).toBeLessThan(380);
});

test('on a phone the map sits above the facts at full width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await expect(page.locator('#block-card canvas.block-map')).toHaveAttribute('data-tiles', '181');
  const map = await page.locator('#block-card canvas.block-map').boundingBox();
  const facts = await page.locator('#block-card .block-facts').boundingBox();
  expect(map.y + map.height).toBeLessThanOrEqual(facts.y);
  expect(facts.width - map.width).toBeGreaterThanOrEqual(0); // whole LEDs only, so up to 5 px narrower
  expect(facts.width - map.width).toBeLessThan(6);
  expect(Math.abs((map.x - facts.x) - (facts.x + facts.width - map.x - map.width))).toBeLessThanOrEqual(1); // centred
});

test('the block card shows dashes and no squares when the block is unavailable', async ({ page }) => {
  await page.route('**/api/block', (r) => r.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }));
  await page.goto('/');
  const card = page.locator('#block-card');
  await expect(card.locator('[data-b="share"]')).toHaveText('—');
  await expect(card.locator('[data-b="opReturn"]')).toHaveText('—');
  await expect(card.locator('canvas.block-map')).toHaveAttribute('data-tiles', '0');
});

for (const width of [390, 430]) {
  test(`the block card fits a ${width}px phone without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('#block-card canvas.block-map')).toHaveAttribute('data-tiles', '181');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
