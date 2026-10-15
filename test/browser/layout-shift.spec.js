import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snap = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url)));
const FRESH = snap.price.updatedAt + 60_000; // the fixtures' own "now": no stale-data notices
// Real-sized lists: the dashboard's top 8 pools + Other, and 15 pools on the Mining page.
const POOLS = Array.from({ length: 8 }, (_, i) => ({ name: `Pool ${i + 1}`, blocks: 30 - i * 3, share: 12 - i })).concat({ name: 'Other', blocks: 9, share: 4 });
const HISTORY_POOLS = Array.from({ length: 15 }, (_, i) => [`Pool ${i + 1}`, 60 - i * 4, i % 2 ? 0 : 20, []]);

// Pages must not jump while they load: cards keep the size they will have once the numbers,
// lists and charts arrive. Scripts and every /api answer are held back so the first paint
// happens before either, like a real visit on a slow connection.
const PAGES = ['/', '/charts', '/nodes', '/mining', '/convert', '/about'];
const LIMIT = 0.02; // cumulative layout shift; 0.1 is where browsers call a page "poor"

for (const width of [1280, 390]) {
  for (const path of PAGES) {
    test(`${path} at ${width}px does not jump while its data loads`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        window.__shifts = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__shifts.push({ value: e.value, nodes: e.sources.map((s) => s.node && (s.node.id || s.node.className || s.node.tagName)).join(' | ') });
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.clock.setFixedTime(FRESH);
      // Scripts arrive late too (as over a real network), so the browser paints the bare page
      // HTML first: anything only the scripts add would show up as a jump.
      await page.route('**/js/**', async (route) => { await new Promise((r) => setTimeout(r, 300)); await route.continue(); });
      await page.route('**/api/**', async (route) => {
        await new Promise((r) => setTimeout(r, 700));
        const url = new URL(route.request().url());
        if (url.pathname === '/api/snapshot') return route.fulfill({ json: { ...snap, pools: POOLS } });
        if (url.pathname === '/api/history' && url.searchParams.get('series') === 'pools') {
          return route.fulfill({ json: { series: 'pools', range: url.searchParams.get('range'), source: 'test', points: HISTORY_POOLS } });
        }
        return route.continue();
      });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      const shifts = await page.evaluate(() => window.__shifts);
      const total = shifts.reduce((sum, s) => sum + s.value, 0);
      expect(total, JSON.stringify(shifts.filter((s) => s.value > 0.001))).toBeLessThan(LIMIT);
    });
  }
}
