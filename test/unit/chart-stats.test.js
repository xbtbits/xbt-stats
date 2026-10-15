import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashPriceUsd, chartHeader, HEADER_SERIES } from '../../site/js/chart-stats.js';
import { fmtRelative, fmtDayMonth, fmtKb } from '../../site/js/format.js';

const snap = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
const NOW = 1791660035000;
const texts = (series, s = snap) => chartHeader(series, s, NOW).map((x) => [x.label, x.text]);

test('fmtRelative: days and hours, hours and minutes, minutes', () => {
  const H = 3_600_000;
  assert.equal(fmtRelative(6 * 24 * H + 16 * H + 30_000), '~6d 16h');
  assert.equal(fmtRelative(5 * H + 12 * 60_000), '~5h 12m');
  assert.equal(fmtRelative(12 * 60_000 + 5000), '~12m');
  assert.equal(fmtRelative(-5000), '~0m');
  assert.equal(fmtRelative(null), '—');
  assert.equal(fmtRelative(NaN), '—');
});

test('fmtDayMonth and fmtKb', () => {
  assert.equal(fmtDayMonth(1792261237408, 'UTC'), 'Oct 17');
  assert.equal(fmtDayMonth(null), '—');
  assert.equal(fmtKb(438000), '438 kB');
  assert.equal(fmtKb(null), '—');
});

test('hash price: worked example in USD per TH per day', () => {
  // (3.125 + 0.00277053) XBT x 169.41176 blocks/day x $851.99 / 43,296.3 TH
  const v = hashPriceUsd({
    mining: { hashrate: 43296303440072940, subsidySats: 312500000, fees144Sats: 39895655 },
    chain: { avgBlockSeconds: 510 }, price: { usd: 851.9869956632151 },
  });
  const expected = ((312500000 + 39895655 / 144) / 1e8) * (86400 / 510) * 851.9869956632151 / (43296303440072940 / 1e12);
  assert.ok(Math.abs(v - expected) < 1e-12);
  assert.ok(Math.abs(v - 10.43) < 0.01, String(v));
  assert.equal(hashPriceUsd({ mining: { hashrate: 0, subsidySats: 1, fees144Sats: 1 }, chain: { avgBlockSeconds: 1 }, price: { usd: 1 } }), null);
  assert.equal(hashPriceUsd({}), null);
  assert.equal(hashPriceUsd(null), null);
});

test('hashrate header', () => {
  assert.deepEqual(texts('hashrate'), [
    ['Hashrate (current)', '43.30 PH/s'], ['Hash price', '$10.43 /TH/day'], ['Blocks (24h)', '153'], ['Largest pool (24h)', 'AlphaPool (34.0%)'],
  ]);
});

test('difficulty header, with coloured changes', () => {
  assert.deepEqual(texts('difficulty'), [
    ['Difficulty', '21.85 E'], ['Epoch', '484'], ['Epoch progress', '41.1%'], ['Retarget block', '977,760'],
    ['Blocks to retarget', '1,188'], ['Retarget ETA', 'Oct 17 (~6d 23h)'], ['Estimated change', '▲ +17.48%'], ['Previous change', '▲ +9.97%'],
  ]);
  const h = chartHeader('difficulty', snap, NOW);
  assert.equal(h[6].dir, 'up');
  const down = chartHeader('difficulty', { ...snap, difficulty: { ...snap.difficulty, changePct: -3 } }, NOW);
  assert.deepEqual([down[6].text, down[6].dir], ['▼ −3.00%', 'down']);
});

test('fees header', () => {
  assert.deepEqual(texts('fees'), [
    ['Avg fees per block', '0.0028 XBT'], ['Total fees (144 blocks)', '0.399 XBT ($340)'],
    ['Fees vs reward', '0.09%'], ['Block subsidy value', '$2,662'],
  ]);
});

test('mempool header', () => {
  assert.deepEqual(texts('mempool'), [
    ['Pending txs', '1,957'], ['Mempool size', '2.34 vMB'], ['Blocks to clear', '12'],
    ['Next block', '2 sat/vB'], ['30 min', '1.5 sat/vB'], ['1 hour', '1 sat/vB'],
  ]);
});

test('block size header', () => {
  assert.deepEqual(texts('blocksize'), [['Avg block size', '438 kB'], ['Txs in last block', '62'], ['Avg txs per block', '237']]);
});

test('every header value is a dash when the snapshot is missing or empty', () => {
  assert.deepEqual(HEADER_SERIES, ['hashrate', 'difficulty', 'fees', 'mempool', 'blocksize']);
  for (const series of HEADER_SERIES) {
    for (const s of [null, {}, JSON.parse(readFileSync(new URL('../fixtures/snapshot-empty.json', import.meta.url), 'utf8'))]) {
      const h = chartHeader(series, s, NOW);
      assert.ok(h.length >= 3);
      for (const x of h) assert.equal(x.text, '—', `${series} ${x.label}`);
    }
  }
});

test('largest pool ignores Other', () => {
  const s = { ...snap, pools: [{ name: 'Other', blocks: 90, share: 60 }, { name: 'Zed', blocks: 40, share: 26.67 }, { name: 'Y', blocks: 20, share: 13.33 }] };
  assert.equal(chartHeader('hashrate', s, NOW)[3].text, 'Zed (26.7%)');
  assert.equal(chartHeader('hashrate', { ...snap, pools: [{ name: 'Other', blocks: 1, share: 100 }] }, NOW)[3].text, '—');
});
