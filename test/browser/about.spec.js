import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
const FRESH = snapshot.sources.chain.fetchedAt + 30_000;

test('About ends with Network history and Sources and status, filled from the snapshot', async ({ page }) => {
  await page.clock.setFixedTime(FRESH);
  await page.goto('/about');
  const titles = await page.locator('main .card h2').allTextContents();
  expect(titles.slice(-2)).toEqual(['Network history', 'Sources and status']);
  await expect(page.locator('#upgrades li')).toHaveCount(2);
  await expect(page.locator('[data-k="chain.source"]')).toHaveText('mempool.guide');
  await expect(page.locator('[data-k="chain.crossCheck"]')).toHaveText('cross-checked with mempool.kilombino.com');
  await expect(page.locator('[data-k="status.line"]')).toHaveText('All sources OK');
  await expect(page.locator('.about-status a[href="https://mempool.guide"]')).toHaveCount(1);
});

test('About status reports stale chain data', async ({ page }) => {
  await page.clock.setFixedTime(snapshot.sources.chain.fetchedAt + 15 * 60_000);
  await page.goto('/about');
  await expect(page.locator('[data-k="status.line"]')).toContainText('Chain data stale');
});

test('About status says the server is unreachable when the snapshot fails', async ({ page }) => {
  await page.route('**/api/snapshot', (r) => r.fulfill({ status: 503, body: '{}' }));
  await page.goto('/about');
  await expect(page.locator('[data-k="status.line"]')).toHaveText('Server unreachable');
});

test('About explains what the block card counts and what it does not', async ({ page }) => {
  await page.goto('/about');
  const item = page.locator('.about-sources li', { hasText: 'What’s in your block?' });
  await expect(item).toContainText('OP_RETURN outputs');
  await expect(item).toContainText('inscription-style envelopes');
  await expect(item).toContainText('multisig are not counted');
});

test('About links the B2B Node Census where it names it as a source', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('.about-sources a[href="https://github.com/LionThunderFingers/Bitcoin-Node-census"]')).toHaveText('B2B Node Census');
});
