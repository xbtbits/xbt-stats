import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from '../../site/js/mining-math.js';

const snap = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
// Fixture network: hashrate 4.329630344007294e16 H/s, avg block 510 s, subsidy 312,500,000 sats,
// fees144Sats 39,895,655 (avg 277,053.16 sats/block), price $851.9869956632151.
const NET = m.networkFromSnapshot(snap);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('toHashesPerSecond converts GH/s, TH/s and PH/s', () => {
  assert.equal(m.toHashesPerSecond(1, 'GH/s'), 1e9);
  assert.equal(m.toHashesPerSecond(10, 'TH/s'), 1e13);
  assert.equal(m.toHashesPerSecond(2.5, 'PH/s'), 2.5e15);
  assert.equal(m.toHashesPerSecond(5, 'EH/s'), null);
  assert.equal(m.toHashesPerSecond(NaN, 'TH/s'), null);
});

test('networkFromSnapshot pulls the inputs and the average fee per block', () => {
  assert.equal(NET.hashrate, 43296303440072940);
  assert.equal(NET.avgBlockSeconds, 510);
  assert.equal(NET.subsidySats, 312500000);
  close(NET.avgFeeSats, 39895655 / 144);
  assert.equal(NET.priceUsd, snap.price.usd);
  assert.equal(m.networkFromSnapshot(null), null);
  assert.equal(m.networkFromSnapshot({ ...snap, price: { usd: null } }), null);
});

test('worked example: 10 TH/s, 3000 W, $0.08/kWh, 1% fee on the fixture', () => {
  const e = m.estimate({ hps: 1e13, watts: 3000, kwhUsd: 0.08, feePct: 1 }, NET);
  close(e.share, 2.3096660004337665e-4);          // 1e13 / 4.3296e16
  close(e.blocksPerDay, 169.41176470588235);      // 86400 / 510
  close(e.xbtPerDay, 0.12116099353042781);        // share x 169.41 x (3.125 + 0.0027705) x 0.99
  close(e.revenuePerDay, 103.22759086955944);     // x $851.99
  close(e.costPerDay, 5.76);                      // 3 kW x 24 h x $0.08
  close(e.profitPerDay, 103.22759086955944 - 5.76);
  close(e.soloDays, 25.55684578059861);           // 1 / (share x blocks/day)
  assert.equal(e.overNetwork, false);
});

test('periods multiply the daily figures by 1, 7, 30 and 365', () => {
  const e = m.estimate({ hps: 1e13, watts: 3000, kwhUsd: 0.08, feePct: 1 }, NET);
  const w = m.forPeriod(e, 7);
  close(w.xbt, e.xbtPerDay * 7);
  close(w.cost, 5.76 * 7);
  close(w.profit, e.profitPerDay * 7);
  assert.equal(m.forPeriod(null, 7), null);
  assert.deepEqual(m.PERIODS.map((p) => p.days), [1, 7, 30, 365]);
});

test('PH/s input scales earnings by 1000', () => {
  const a = m.estimate({ hps: m.toHashesPerSecond(10, 'TH/s'), watts: 1, kwhUsd: 1, feePct: 0 }, NET);
  const b = m.estimate({ hps: m.toHashesPerSecond(10, 'PH/s'), watts: 1, kwhUsd: 1, feePct: 0 }, NET);
  close(b.xbtPerDay, a.xbtPerDay * 1000);
});

test('guards: bad hashrate, power, price or network give null outputs', () => {
  const ok = { hps: 1e13, watts: 3000, kwhUsd: 0.08, feePct: 1 };
  for (const bad of [0, -1, NaN, null, Infinity]) {
    assert.equal(m.estimate({ ...ok, hps: bad }, NET), null, String(bad));
  }
  assert.equal(m.estimate(ok, null), null);
  assert.equal(m.estimate(ok, { ...NET, avgBlockSeconds: 0 }), null);
  assert.equal(m.estimate(ok, { ...NET, hashrate: 0 }), null);
  const noPower = m.estimate({ ...ok, watts: NaN }, NET);
  assert.ok(noPower.xbtPerDay > 0);
  assert.equal(noPower.costPerDay, null);
  assert.equal(noPower.profitPerDay, null);
  assert.equal(m.estimate({ ...ok, kwhUsd: -1 }, NET).costPerDay, null);
  assert.equal(m.estimate({ ...ok, feePct: 100 }, NET).xbtPerDay, null);
  assert.equal(m.estimate({ ...ok, feePct: -1 }, NET).xbtPerDay, null);
});

test('share above the whole network sets the warning flag', () => {
  const e = m.estimate({ hps: 1e17, watts: 1, kwhUsd: 1, feePct: 0 }, NET);
  assert.equal(e.overNetwork, true);
  assert.ok(e.share > 1);
});

test('formatSoloTime picks minutes, hours, days or years and dashes the impossible', () => {
  assert.equal(m.formatSoloTime(25.55684578059861), '≈ 25.6 days');
  assert.equal(m.formatSoloTime(12.34), '≈ 12.3 days');
  assert.equal(m.formatSoloTime(1), '≈ 1.0 days');
  assert.equal(m.formatSoloTime(0.5), '≈ 12.0 hours');
  assert.equal(m.formatSoloTime(0.01), '≈ 14 minutes');
  assert.equal(m.formatSoloTime(800), '≈ 2.2 years');
  assert.equal(m.formatSoloTime(Infinity), '—');
  assert.equal(m.formatSoloTime(NaN), '—');
  assert.equal(m.formatSoloTime(null), '—');
});

test('parseNumber accepts commas and decimals, rejects junk', () => {
  assert.equal(m.parseNumber('3,000'), 3000);
  assert.equal(m.parseNumber('0.08'), 0.08);
  assert.equal(m.parseNumber(''), null);
  assert.equal(m.parseNumber('-5'), null);
  assert.equal(m.parseNumber('1e3'), null);
});

test('the network carries the halving: height, date and the reward after it', () => {
  assert.equal(NET.halvingHeight, 1050000);
  assert.equal(NET.halvingEta, snap.halving.eta);
  assert.equal(NET.subsidyAfterSats, 156250000);
});

test('a period that spans the halving uses the lower reward for the days after it', () => {
  const e = m.estimate({ hps: 10e12, watts: 3000, kwhUsd: 0.08, feePct: 1 }, NET);
  // reward after the halving is (1.5625 + fees) instead of (3.125 + fees)
  const ratio = (NET.subsidyAfterSats + NET.avgFeeSats) / (NET.subsidySats + NET.avgFeeSats);
  assert.ok(Math.abs(e.xbtPerDayAfter - e.xbtPerDay * ratio) < 1e-12);
  const y = m.forPeriod(e, 365, 100); // halving in 100 days
  assert.ok(Math.abs(y.xbt - (e.xbtPerDay * 100 + e.xbtPerDayAfter * 265)) < 1e-9);
  assert.ok(Math.abs(y.cost - e.costPerDay * 365) < 1e-9);
  assert.ok(Math.abs(y.profit - (y.revenue - y.cost)) < 1e-9);
  assert.equal(y.spansHalving, true);
  const d = m.forPeriod(e, 1, 100); // halving is after this period
  assert.equal(d.xbt, e.xbtPerDay);
  assert.equal(d.spansHalving, false);
  const past = m.forPeriod(e, 7, -5); // halving already passed (reward in the snapshot is already lower)
  assert.equal(past.xbt, e.xbtPerDay * 7);
  assert.equal(past.spansHalving, false);
});
