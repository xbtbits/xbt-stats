import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyCloses, movingAverage, maAt } from '../../site/js/ma.js';

const D = 86_400;
const T0 = 20_000 * D; // a UTC day start

test('dailyCloses takes the last value of each UTC day, ascending', () => {
  const pts = [[T0 + 10, 1], [T0 + 500, 2], [T0 + D + 5, 3], [T0 + 2 * D - 1, 4], [T0 + 3 * D, 5]];
  assert.deepEqual(dailyCloses(pts), [[T0, 2], [T0 + D, 4], [T0 + 3 * D, 5]]);
});

test('dailyCloses of nothing is empty', () => {
  assert.deepEqual(dailyCloses([]), []);
});

test('movingAverage averages the last N closes once N exist', () => {
  const closes = [[T0, 3], [T0 + D, 6], [T0 + 2 * D, 9], [T0 + 3 * D, 12]];
  assert.deepEqual(movingAverage(closes, 3), [[T0 + 2 * D, 6], [T0 + 3 * D, 9]]);
});

test('movingAverage with too little history is empty', () => {
  assert.deepEqual(movingAverage([[T0, 1], [T0 + D, 2]], 3), []);
});

test('maAt finds the MA of the day containing the timestamp, else null', () => {
  const ma = [[T0 + 2 * D, 6], [T0 + 3 * D, 9]];
  assert.equal(maAt(ma, T0 + 2 * D + 3600), 6);
  assert.equal(maAt(ma, T0 + 3 * D), 9);
  assert.equal(maAt(ma, T0 + D), null);
  assert.equal(maAt(ma, T0 + 4 * D), null);
  assert.equal(maAt([], T0), null);
});

test('bucketAverage thins a dense series by averaging and keeps the newest point exactly', async () => {
  const { bucketAverage } = await import('../../site/js/ma.js');
  const pts = Array.from({ length: 101 }, (_, i) => [i, i % 2 ? 10 : 0]);
  const out = bucketAverage(pts, 11);
  assert.ok(out.length <= 11);
  assert.deepEqual(out.at(-1), [100, 0]);
  assert.deepEqual(out[0], [4.5, 5]); // first ten points averaged
  assert.equal(bucketAverage(pts.slice(0, 5), 11).length, 5); // already fits: unchanged
});

test('trimZeros drops needless trailing zeros only', async () => {
  const { trimZeros } = await import('../../site/js/ma.js');
  assert.equal(trimZeros('50.00 PH/s'), '50 PH/s');
  assert.equal(trimZeros('47.50 PH/s'), '47.5 PH/s');
  assert.equal(trimZeros('0.0075 XBT'), '0.0075 XBT');
  assert.equal(trimZeros('0.010 XBT'), '0.01 XBT');
  assert.equal(trimZeros('600 kB'), '600 kB');
  assert.equal(trimZeros('2.50 vMB'), '2.5 vMB');
  assert.equal(trimZeros('20.00 E'), '20 E');
});
