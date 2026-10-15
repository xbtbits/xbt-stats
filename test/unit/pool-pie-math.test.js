import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolBands, pieModel, locate } from '../../site/js/pool-pie-math.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('poolBands: DATUM miners, other miners and pool-built, smallest first', () => {
  const bands = poolBands(['A', 20, 15, [['m1', 8], ['m2', 4]]]);
  assert.deepEqual(bands.map((b) => [b.label, b.blocks, b.datum]), [
    ['Other miners', 3, true], ['m2', 4, true], ['Built by the pool', 5, false], ['m1', 8, true],
  ]);
  near(bands[0].in, 0);
  near(bands.at(-1).out, 1);
  near(bands[1].in, 3 / 20); // each ring's share of the slice area is its share of the blocks
  near(bands[1].out, 7 / 20);
});

test('poolBands: Stratum-only pool is one pool-built band; no miner data is one unknown band', () => {
  assert.deepEqual(poolBands(['S', 4, 0, []]).map((b) => [b.label, b.blocks, b.datum]), [['Built by the pool', 4, false]]);
  assert.deepEqual(poolBands(['K', 4]).map((b) => [b.label, b.blocks, b.datum]), [[null, 4, null]]);
});

test('pieModel: slices from 12 o\'clock sized by blocks, DATUM share per block', () => {
  const m = pieModel([['A', 30, 27, [['m', 27]]], ['B', 10, 0, []]]);
  assert.equal(m.total, 40);
  near(m.datumPct, 67.5);
  near(m.slices[0].a0, 0);
  near(m.slices[0].a1, 1.5 * Math.PI);
  near(m.slices[1].a1, 2 * Math.PI);
  near(m.slices[0].datumPct, 90);
});

test('pieModel: DATUM share unknown when the explorer has no miner data', () => {
  assert.equal(pieModel([['A', 3], ['B', 1]]).datumPct, null);
  assert.equal(pieModel([]).total, 0);
  assert.equal(pieModel([]).datumPct, null);
});

test('locate: angle and area share find the slice and ring', () => {
  const m = pieModel([['A', 30, 20, [['m1', 20]]], ['B', 10, 0, []]]);
  const a = locate(m, 0.1, 0.9); // early in A, near the rim: biggest ring (m1)
  assert.equal(a.slice.name, 'A');
  assert.equal(a.band.label, 'm1');
  assert.equal(locate(m, 0.1, 0.1).band.label, 'Built by the pool');
  assert.equal(locate(m, 1.8 * Math.PI, 0.5).slice.name, 'B');
  assert.equal(locate(m, 0.1, 1.2), null); // outside the ring
  assert.equal(locate(pieModel([]), 0.1, 0.5), null);
});
