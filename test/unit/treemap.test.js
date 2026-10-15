import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squarify } from '../../site/js/treemap.js';

const close = (a, b) => Math.abs(a - b) < 1e-6;

test('squarify fills the rectangle exactly, each tile with its own area, inside the bounds', () => {
  const W = 150, H = 190;
  const weights = [192116, 150000, 900, 1200, 600, 30, 4400, 5000, 777];
  const total = weights.reduce((s, x) => s + x, 0);
  const areas = weights.map((w, t) => ({ t, area: (w / total) * W * H })).sort((a, b) => b.area - a.area);
  const tiles = squarify(areas, W, H);
  assert.equal(tiles.length, weights.length);
  assert.ok(close(tiles.reduce((s, r) => s + r.w * r.h, 0), W * H));
  for (const r of tiles) {
    assert.ok(close(r.w * r.h, areas.find((a) => a.t === r.t).area));
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6);
  }
});

test('squarify keeps tiles close to square for equal areas', () => {
  const areas = Array.from({ length: 100 }, (_, t) => ({ t, area: 1 }));
  const worst = Math.max(...squarify(areas, 10, 10).map((r) => Math.max(r.w / r.h, r.h / r.w)));
  assert.ok(worst < 1.5, `worst aspect ${worst}`);
});

test('squarify handles a single transaction and no transactions', () => {
  assert.deepEqual(squarify([{ t: 0, area: 50 }], 10, 5), [{ t: 0, area: 50, x: 0, y: 0, w: 10, h: 5 }]);
  assert.deepEqual(squarify([], 10, 5), []);
});
