import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueAt, blockStyle } from '../../site/js/led-fill.js';

test('valueAt interpolates between neighbouring points', () => {
  const xs = [0, 10, 20], ys = [100, 200, 100];
  assert.equal(valueAt(xs, ys, 0), 100);
  assert.equal(valueAt(xs, ys, 5), 150);
  assert.equal(valueAt(xs, ys, 10), 200);
  assert.equal(valueAt(xs, ys, 15), 150);
  assert.equal(valueAt(xs, ys, 20), 100);
});

test('valueAt is null outside the data, on gaps and with no data', () => {
  assert.equal(valueAt([0, 10], [1, 2], -1), null);
  assert.equal(valueAt([0, 10], [1, 2], 11), null);
  assert.equal(valueAt([0, 10, 20], [1, null, 3], 5), null);
  assert.equal(valueAt([], [], 0), null);
  assert.equal(valueAt([5], [7], 5), 7);
});

test('blockStyle fades from bright gold at the line to dim bronze at the bottom', () => {
  assert.deepEqual(blockStyle(0), { rgb: [251, 204, 92], alpha: 0.8 });
  assert.deepEqual(blockStyle(1).rgb, [140, 110, 53]);
  assert.ok(Math.abs(blockStyle(1).alpha - 0.1) < 1e-9);
  assert.deepEqual(blockStyle(-1), blockStyle(0)); // clamped
  assert.ok(blockStyle(0.5).alpha < blockStyle(0.2).alpha);
});

test('blockStyle strength scales only the opacity', () => {
  assert.deepEqual(blockStyle(0.3, 0.5).rgb, blockStyle(0.3).rgb);
  assert.ok(Math.abs(blockStyle(0.3, 0.5).alpha - blockStyle(0.3).alpha / 2) < 1e-9);
});

test('valueAt on a step series holds the earlier value until the next point', () => {
  const xs = [0, 10, 20], ys = [100, 200, 300];
  assert.equal(valueAt(xs, ys, 5, true), 100);
  assert.equal(valueAt(xs, ys, 10, true), 200);
  assert.equal(valueAt(xs, ys, 19, true), 200);
  assert.equal(valueAt(xs, ys, 20, true), 300);
});
