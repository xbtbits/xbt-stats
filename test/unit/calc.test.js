import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '../../worker/src/calc.js';

test('subsidy follows the 210,000-block halving schedule', () => {
  assert.equal(calc.subsidyAt(0), 5_000_000_000);
  assert.equal(calc.subsidyAt(209_999), 5_000_000_000);
  assert.equal(calc.subsidyAt(210_000), 2_500_000_000);
  assert.equal(calc.subsidyAt(976_572), 312_500_000);
  assert.equal(calc.subsidyAt(6_929_999), 1);
  assert.equal(calc.subsidyAt(6_930_000), 0);
});

test('chain data confirms 3.125 XBT subsidy at the current era', () => {
  // reward-stats/144 at heights 976,439-976,582 (recorded 2026-10-10)
  const totalReward = 45_039_895_655;
  const totalFee = 39_895_655;
  assert.equal((totalReward - totalFee) / 144, calc.subsidyAt(976_500));
});

test('supply counts blocks 0..h inclusive', () => {
  assert.equal(calc.supplyAt(-1), 0);
  assert.equal(calc.supplyAt(0), 5_000_000_000);
  assert.equal(calc.supplyAt(209_999), 1_050_000_000_000_000);
  assert.equal(calc.supplyAt(210_000), 1_050_002_500_000_000);
  assert.equal(calc.supplyAt(976_572), 2_011_429_062_500_000); // 20,114,290.625 XBT
  assert.equal(calc.supplyAt(6_929_999), 2_099_999_997_690_000);
  assert.equal(calc.supplyAt(7_000_000), 2_099_999_997_690_000);
});

test('percent issued, remaining, epoch, fees share', () => {
  assert.equal(calc.percentIssued(2_011_429_062_500_000), 95.78233630952381);
  assert.equal(calc.remainingSats(976_572), 88_570_935_190_000);
  assert.equal(calc.epochOf(976_572), 484);
  assert.equal(calc.feesPctOfReward(45_039_895_655, 39_895_655), 0.08857848007818614);
  assert.equal(calc.feesPctOfReward(0, 0), 0);
});

test('eta uses the average until the next halving, then 600 s', () => {
  assert.equal(calc.etaMs(976_572, 1_050_000, 510, 0), 37_448_280_000);
  assert.equal(calc.etaMs(976_572, 1_260_000, 510, 0), 163_448_280_000);
  assert.equal(calc.etaMs(976_572, 976_000, 510, 5), 5); // already passed
});

test('halving info and future halvings', () => {
  const h = calc.halvingInfo(976_572, 510, 0);
  assert.deepEqual(h, {
    height: 1_050_000, blocksLeft: 73_428, eta: 37_448_280_000,
    epochProgress: 65.03428571428572, subsidyAfterSats: 156_250_000,
  });
  const f = calc.futureHalvings(976_572, 510, 0);
  assert.equal(f.length, 6);
  assert.deepEqual(f.map((x) => x.height), [1_050_000, 1_260_000, 1_470_000, 1_680_000, 1_890_000, 2_100_000]);
  assert.deepEqual(f.map((x) => x.eta), [37_448_280_000, 163_448_280_000, 289_448_280_000, 415_448_280_000, 541_448_280_000, 667_448_280_000]);
  assert.deepEqual(f.map((x) => x.subsidyAfterSats), [156_250_000, 78_125_000, 39_062_500, 19_531_250, 9_765_625, 4_882_812]);
});

test('supply milestones', () => {
  assert.equal(calc.heightForSupply(2_016_000_000_000_000), 991_199);
  const m = calc.supplyMilestones(976_572, 510, 0);
  assert.deepEqual(m, [
    { pct: 96, height: 991_199, reached: false, eta: 7_459_770_000 },
    { pct: 99, height: 1_411_199, reached: false, eta: 254_167_680_000 },
    { pct: 99.9, height: 2_094_959, reached: false, eta: 664_423_680_000 },
    { pct: 100, height: 6_929_999, reached: false, eta: 3_565_447_680_000 },
  ]);
  const later = calc.supplyMilestones(1_000_000, 510, 0);
  assert.deepEqual(later[0], { pct: 96, height: 991_199, reached: true, eta: null });
});
