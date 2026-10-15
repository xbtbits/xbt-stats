import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../../site/js/format.js';
import { summarize } from '../../site/js/summary.js';

test('missing values render as a dash', () => {
  for (const fn of [f.fmtInt, f.fmtUsd, f.fmtUsdCompact, f.fmtXbt, f.fmtPct, f.fmtHashrate, f.fmtDifficulty, f.fmtClock, f.fmtVsize, f.fmtSatVb, f.fmtDate, f.fmtAgo]) {
    assert.equal(fn(null), '—', fn.name);
    assert.equal(fn(undefined), '—', fn.name);
    assert.equal(fn(NaN), '—', fn.name);
  }
  assert.deepEqual(f.change(null), { text: '—', dir: 'flat' });
});

test('numbers, money and coins', () => {
  assert.equal(f.fmtInt(976572), '976,572');
  assert.equal(f.fmtNum(1201.18351216, 0), '1,201');
  assert.equal(f.fmtUsd(851.9869956632151), '$851.99');
  assert.equal(f.fmtUsdCompact(17137114039.490524), '$17.14B');
  assert.equal(f.fmtXbt(2011429062500000), '20,114,290.63 XBT');
  assert.equal(f.fmtXbt(312500000, 0, 8), '3.125 XBT');
  assert.equal(f.fmtPct(95.78233630952381), '95.78%');
});

test('changes always carry an arrow and a sign; tiny changes are flat', () => {
  assert.deepEqual(f.change(-2.4), { text: '▼ −2.40%', dir: 'down' });
  assert.deepEqual(f.change(17.48), { text: '▲ +17.48%', dir: 'up' });
  assert.deepEqual(f.change(-0.001), { text: '0.00%', dir: 'flat' });
  assert.deepEqual(f.change(0), { text: '0.00%', dir: 'flat' });
});

test('hashrate and difficulty scale units', () => {
  assert.equal(f.fmtHashrate(43296303440072940), '43.30 PH/s');
  assert.equal(f.fmtHashrate(1.5e18), '1.50 EH/s');
  assert.equal(f.fmtHashrate(999), '999.00 H/s');
  assert.equal(f.fmtDifficulty(21846214529159510000), '21.85 E');
  assert.equal(f.fmtDifficulty(132.72e12), '132.72 T');
});

test('times and dates', () => {
  assert.equal(f.fmtClock(245), '4:05');
  assert.equal(f.fmtClock(3725), '1:02:05');
  assert.equal(f.fmtClock(-5), '0:00');
  assert.equal(f.fmtAgo(30_000), 'just now');
  assert.equal(f.fmtAgo(15 * 60_000), '15 min ago');
  assert.equal(f.fmtAgo(2 * 3_600_000), '2 h ago');
  assert.equal(f.fmtAgo(3 * 86_400_000), '3 d ago');
  assert.equal(f.fmtDate(1829108310000, 'UTC'), 'Dec 18, 2027');
  assert.equal(f.fmtDate(5357107710000, 'UTC'), 'Oct 5, 2139');
});

test('mempool units', () => {
  assert.equal(f.fmtVsize(2342826), '2.34 vMB');
  assert.equal(f.fmtSatVb(1.5), '1.5 sat/vB');
  assert.equal(f.fmtSatVb(2), '2 sat/vB');
});

test('summaries describe the last value and the change over the range', () => {
  const fmt = (v) => `${v}`;
  assert.equal(summarize('Hashrate', [], fmt), 'Hashrate: no data yet.');
  assert.equal(summarize('Hashrate', [[1, 5]], fmt), 'Hashrate 5.');
  assert.equal(summarize('Hashrate', [[1, 100], [2, 112]], fmt), 'Hashrate 112, up 12.0% over this range.');
  assert.equal(summarize('Price', [[1, 100], [2, 90]], fmt), 'Price 90, down 10.0% over this range.');
  assert.equal(summarize('Price', [[1, 100], [2, 100.01]], fmt), 'Price 100.01, flat over this range.');
  // ten times or more reads as a multiple, not a huge percentage
  assert.equal(summarize('Mempool', [[1, 0.0134], [2, 2.15]], fmt), 'Mempool 2.15, up 160x over this range.');
  assert.equal(summarize('Nodes', [[1, 70], [2, 962]], fmt), 'Nodes 962, up 13.7x over this range.');
  assert.equal(summarize('Nodes', [[1, 100], [2, 999]], fmt), 'Nodes 999, up 899.0% over this range.');
  assert.equal(summarize('Nodes', [[1, 100], [2, 1000]], fmt), 'Nodes 1000, up 10.0x over this range.');
});

test('fmtDate never throws, even for out-of-range times or bad zones', () => {
  assert.equal(f.fmtDate(8.64e15 + 1), '—');
  assert.equal(f.fmtDate(1_791_660_000_000, 'Not/AZone'), '—');
});

test('changeLine: sign and colour carry direction, no dollar sign or arrow', () => {
  assert.deepEqual(f.changeLine(371.48, 0.45), { text: '+371.48 (0.45%)', dir: 'up' });
  assert.deepEqual(f.changeLine(-61.22, -6.87), { text: '−61.22 (−6.87%)', dir: 'down' });
  assert.deepEqual(f.changeLine(0, 0), { text: '0.00 (0.00%)', dir: 'flat' });
  assert.deepEqual(f.changeLine(-0.001, -0.0001), { text: '0.00 (0.00%)', dir: 'flat' });
  assert.deepEqual(f.changeLine(1234.5, 1.5), { text: '+1,234.50 (1.50%)', dir: 'up' });
  assert.deepEqual(f.changeLine(-20.9512, -2.4), { text: '−20.95 (−2.40%)', dir: 'down' });
  assert.deepEqual(f.changeLine(null, 1), { text: '—', dir: 'flat' });
  assert.deepEqual(f.changeLine(1, NaN), { text: '—', dir: 'flat' });
});

test('fmtDateTime for chart tooltips', () => {
  assert.equal(f.fmtDateTime(Date.UTC(2026, 9, 10, 5, 25), 'UTC'), 'Oct 10, 2026, 5:25 AM');
  assert.equal(f.fmtDateTime(null), '—');
  assert.equal(f.fmtDateTime(8.64e15 + 1), '—');
});

test('fmtAxisPrice: two decimals with thousands separators, no dollar sign', () => {
  assert.equal(f.fmtAxisPrice(82783.061), '82,783.06');
  assert.equal(f.fmtAxisPrice(850), '850.00');
  assert.equal(f.fmtAxisPrice(null), '—');
});

test('changeLine can format the amount with a series formatter (chain charts)', () => {
  const ph = (n) => `${(n / 1e15).toFixed(2)} PH/s`;
  assert.deepEqual(f.changeLine(4e15, 12, ph), { text: '+4.00 PH/s (12.00%)', dir: 'up' });
  assert.deepEqual(f.changeLine(-4e15, -12, ph), { text: '−4.00 PH/s (−12.00%)', dir: 'down' });
});

test('athTitle explains what the ATH is and when it was set', () => {
  assert.equal(f.athTitle(1789500000000, 1789000000000, 'UTC'), 'Highest hourly close since Sep 10, 2026 · set Sep 15, 2026');
  assert.equal(f.athTitle(1789500000000, null, 'UTC'), 'Highest hourly close · set Sep 15, 2026');
  assert.equal(f.athTitle(null, 1789000000000, 'UTC'), '');
});
