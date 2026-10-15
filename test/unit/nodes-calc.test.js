import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceHistory, windowProgress, syncShares, shareOf, NODE_RANGES } from '../../site/js/nodes-calc.js';

const DAY = 86_400;
const T = 1_791_669_630;
const hist = [
  [T - 40 * DAY, 70, 313, 0],
  [T - 20 * DAY, 300, 900, 100],
  [T - 7 * DAY, 900, 1700, 800],
  [T - 3 * DAY, 950, 1740, 810],
  [T, 962, 1745, 816],
];

test('node chart ranges run 7D to 10Y and ALL', () => {
  assert.deepEqual(NODE_RANGES, ['7d', '1m', '3m', '6m', 'ytd', '1y', '5y', '10y', 'all']);
});

test('sliceHistory keeps the span before the newest point; ALL keeps everything', () => {
  assert.deepEqual(sliceHistory(hist, 'all'), hist);
  assert.deepEqual(sliceHistory(hist, '7d'), hist.slice(2));
  assert.deepEqual(sliceHistory(hist, '1m'), hist.slice(1));
  assert.deepEqual(sliceHistory([], '7d'), []);
  assert.deepEqual(sliceHistory(hist, 'nope'), hist);
  // ranges longer than the history keep everything
  for (const r of ['3m', '6m', '1y', '5y', '10y']) assert.deepEqual(sliceHistory(hist, r), hist);
});

test('sliceHistory YTD starts at Jan 1 UTC of the newest point', () => {
  const jan1 = Date.UTC(2026, 0, 1) / 1000;
  const pts = [[jan1 - 10, 1], [jan1 + 10, 2], [jan1 + 5 * DAY, 3]];
  assert.deepEqual(sliceHistory(pts, 'ytd'), pts.slice(1));
});

test('windowProgress: share of the activation window, clamped, with blocks remaining', () => {
  assert.deepEqual(windowProgress(976572, 973440, 979920), { pct: (3132 / 6480) * 100, remaining: 3348, complete: false });
  assert.deepEqual(windowProgress(970000, 973440, 979920), { pct: 0, remaining: 6480, complete: false });
  assert.deepEqual(windowProgress(979920, 973440, 979920), { pct: 100, remaining: 0, complete: true });
  assert.deepEqual(windowProgress(990000, 973440, 979920), { pct: 100, remaining: 0, complete: true });
  assert.deepEqual(windowProgress(null, 973440, 979920), { pct: null, remaining: null, complete: false });
  assert.deepEqual(windowProgress(976572, 979920, 973440), { pct: null, remaining: null, complete: false });
});

test('syncShares: four buckets in order with their share of the total', () => {
  const s = syncShares({ tip: 945, near: 14, day: 1, behind: 2 });
  assert.deepEqual(s.map((x) => [x.key, x.label, x.count]), [
    ['tip', 'At tip', 945], ['near', 'Near tip', 14], ['day', 'Within a day', 1], ['behind', 'Behind', 2],
  ]);
  assert.ok(Math.abs(s[0].pct - (945 / 962) * 100) < 1e-9);
  assert.ok(Math.abs(s.reduce((a, x) => a + x.pct, 0) - 100) < 1e-9);
  assert.deepEqual(syncShares({ tip: 0, near: 0, day: 0, behind: 0 }).map((x) => x.pct), [0, 0, 0, 0]);
  assert.deepEqual(syncShares(null).map((x) => x.count), [null, null, null, null]);
});

test('shareOf is a percentage or null', () => {
  assert.ok(Math.abs(shareOf(816, 962) - 84.8232848) < 1e-6);
  assert.equal(shareOf(1, 0), null);
  assert.equal(shareOf(null, 962), null);
});
