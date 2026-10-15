import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainHistory, sliceDaily } from '../../worker/src/history.js';
import { fakeFetch } from '../helpers/fake-fetch.js';

const P = 'https://mempool.guide/api';
const B = 'https://mempool.kilombino.com/api';

test('hashrate and difficulty drop pre-switch history', async () => {
  const body = {
    hashrates: [{ timestamp: 1788000000, avgHashrate: 9e20 }, { timestamp: 1789000000, avgHashrate: 4e16 }],
    difficulty: [{ time: 1787000000, height: 961000, difficulty: 1e14 }, { time: 1790000000, height: 973728, difficulty: 2e19 }],
  };
  const f = fakeFetch({ [`${P}/v1/mining/hashrate/all`]: body });
  assert.deepEqual(await chainHistory(f, 'hashrate', 'all'), { source: 'mempool.guide', points: [[1789000000, 4e16]] });
  assert.deepEqual((await chainHistory(f, 'difficulty', 'all')).points, [[1790000000, 2e19]]);
});

test('fees use avgFees and drop pre-switch blocks', async () => {
  const f = fakeFetch({ [`${P}/v1/mining/blocks/fees/1m`]: [
    { avgHeight: 961000, timestamp: 1787000000, avgFees: 5, USD: 1 },
    { avgHeight: 970651, timestamp: 1789059094, avgFees: 148579, USD: 204 },
  ] });
  assert.deepEqual((await chainHistory(f, 'fees', '1m')).points, [[1789059094, 148579]]);
});

test('mempool sums fee buckets, sorts ascending, maps all to 3m', async () => {
  const f = fakeFetch({ [`${B}/v1/statistics/3m`]: [
    { added: 1791662400, vsizes: [100, 200] },
    { added: 1789072200, vsizes: [50] },
  ] });
  const r = await chainHistory(f, 'mempool', 'all');
  assert.equal(r.source, 'mempool.kilombino.com'); // primary 404s in this fake
  assert.deepEqual(r.points, [[1789072200, 50], [1791662400, 300]]);
});

test('pools without miner data are name/blocks pairs; 1d is 24h, 7d is 1w, 1m is 1m', async () => {
  const body = { blockCount: 10, pools: [{ name: 'A', blockCount: 7 }, { name: 'B', blockCount: 3 }] };
  const f = fakeFetch({
    [`${P}/v1/mining/pools/24h`]: body,
    [`${P}/v1/mining/pools/1w`]: { ...body, pools: [{ name: 'C', blockCount: 9 }] },
    [`${P}/v1/mining/pools/1m`]: { ...body, pools: [{ name: 'D', blockCount: 40 }] },
  });
  assert.deepEqual((await chainHistory(f, 'pools', '1d')).points, [['A', 7], ['B', 3]]);
  assert.deepEqual((await chainHistory(f, 'pools', '7d')).points, [['C', 9]]);
  assert.deepEqual((await chainHistory(f, 'pools', '1m')).points, [['D', 40]]);
});

test('pools with miner data add DATUM blocks and the top miners', async () => {
  const miners = Array.from({ length: 25 }, (_, i) => ({ name: `M${i}`, blockCount: 1 }));
  const f = fakeFetch({ [`${P}/v1/mining/pools/24h`]: { blockCount: 40, pools: [
    { name: 'A', blockCount: 30, minerBlockCount: 28, miners },
    { name: 'B', blockCount: 6, minerBlockCount: 9, miners: [{ name: 'y'.repeat(60), blockCount: 2 }] }, // more than the pool found: capped
    { name: 'S', blockCount: 4 }, // no DATUM miners: 0
  ] } });
  const [a, b, s] = (await chainHistory(f, 'pools', '1d')).points;
  assert.deepEqual(a.slice(0, 3), ['A', 30, 28]);
  assert.equal(a[3].length, 20);
  assert.deepEqual(a[3][0], ['M0', 1]);
  assert.deepEqual(b.slice(0, 3), ['B', 6, 6]);
  assert.equal(b[3][0][0].length, 40);
  assert.deepEqual(s, ['S', 4, 0, []]);
});

test('bad series or range throws, both explorers down throws', async () => {
  await assert.rejects(chainHistory(fakeFetch({}), 'price', '1m'), /bad series/);
  await assert.rejects(chainHistory(fakeFetch({}), 'hashrate', '2y'), /bad range/);
  await assert.rejects(chainHistory(fakeFetch({}), 'hashrate', '1m'), /all explorers failed/);
});

test('blocksize uses avgSize in bytes, drops pre-switch blocks and sorts ascending', async () => {
  const f = fakeFetch({ [`${P}/v1/mining/blocks/sizes-weights/3m`]: {
    sizes: [
      { avgHeight: 970651, timestamp: 1789059094, avgSize: 440000 },
      { avgHeight: 961000, timestamp: 1787000000, avgSize: 1200000 },
      { avgHeight: 965000, timestamp: 1788500000, avgSize: 430000 },
    ],
    weights: [],
  } });
  assert.deepEqual(await chainHistory(f, 'blocksize', '3m'),
    { source: 'mempool.guide', points: [[1788500000, 430000], [1789059094, 440000]] });
});

test('blocksize falls back to the backup explorer', async () => {
  const f = fakeFetch({ [`${B}/v1/mining/blocks/sizes-weights/1m`]: {
    sizes: [{ avgHeight: 970651, timestamp: 1789059094, avgSize: 440000 }], weights: [],
  } });
  const r = await chainHistory(f, 'blocksize', '1m');
  assert.equal(r.source, 'mempool.kilombino.com');
  assert.deepEqual(r.points, [[1789059094, 440000]]);
});

test('new ranges map to the explorer intervals', async () => {
  const calls = [];
  const f = async (url) => { calls.push(String(url)); return new Response('[]', { headers: { 'content-type': 'application/json' } }); };
  for (const range of ['1d', '7d', '1y', '5y', '10y']) {
    await chainHistory(f, 'fees', range).catch(() => {});
    await chainHistory(f, 'mempool', range).catch(() => {});
  }
  const fees = calls.filter((u) => u.startsWith(`${P}/v1/mining/blocks/fees/`)).map((u) => u.split('/').pop());
  const stats = calls.filter((u) => u.startsWith(`${P}/v1/statistics/`)).map((u) => u.split('/').pop());
  assert.deepEqual(fees, ['24h', '1w', '1y', 'all', 'all']);
  assert.deepEqual(stats, ['24h', '1w', '3m', '3m', '3m']);
});

test('1d/7d of a daily series keep the window plus the point before it', () => {
  const D = 86_400, now = 100 * D;
  const pts = [[90 * D, 1], [95 * D, 2], [99 * D + 10, 3], [100 * D - 10, 4]];
  assert.deepEqual(sliceDaily(pts, '1d', now), [[95 * D, 2], [99 * D + 10, 3], [100 * D - 10, 4]]);
  assert.deepEqual(sliceDaily(pts, '7d', now), [[90 * D, 1], [95 * D, 2], [99 * D + 10, 3], [100 * D - 10, 4]]);
  // a step series (difficulty) moves the earlier value to the window start
  assert.deepEqual(sliceDaily([[90 * D, 5]], '1d', now, true), [[99 * D, 5]]);
  assert.deepEqual(sliceDaily(pts, '1m', now), pts); // longer ranges untouched
});

test('hashrate 1d is cut from the 1m series', async () => {
  const D = 86_400, now = 1791700000;
  const body = { hashrates: [{ timestamp: now - 3 * D, avgHashrate: 1 }, { timestamp: now - 2 * D, avgHashrate: 2 }, { timestamp: now - 3600, avgHashrate: 3 }], difficulty: [] };
  const f = fakeFetch({ [`${P}/v1/mining/hashrate/1m`]: body });
  assert.deepEqual((await chainHistory(f, 'hashrate', '1d', now)).points, [[now - 2 * D, 2], [now - 3600, 3]]);
});

test('a stale answer moves on to the backup explorer; if both are stale the newer wins', async () => {
  const now = 1791700000;
  const fees = (ts) => [{ timestamp: ts, avgHeight: 976000, avgFees: 100 }];
  const stale = fakeFetch({ [`${P}/v1/mining/blocks/fees/1y`]: fees(now - 40 * 86_400), [`${B}/v1/mining/blocks/fees/1y`]: fees(now - 600) });
  assert.equal((await chainHistory(stale, 'fees', '1y', now)).source, 'mempool.kilombino.com');
  const both = fakeFetch({ [`${P}/v1/mining/blocks/fees/1y`]: fees(now - 5 * 86_400), [`${B}/v1/mining/blocks/fees/1y`]: fees(now - 40 * 86_400) });
  const r = await chainHistory(both, 'fees', '1y', now);
  assert.equal(r.source, 'mempool.guide');
  assert.equal(r.points[0][0], now - 5 * 86_400);
});

test('YTD uses the year interval and keeps only points since Jan 1 UTC', async () => {
  const now = Date.UTC(2026, 9, 11) / 1000, jan1 = Date.UTC(2026, 0, 1) / 1000;
  const fees = [{ timestamp: jan1 - 100, avgHeight: 970000, avgFees: 1 }, { timestamp: now - 600, avgHeight: 976000, avgFees: 2 }];
  const f = fakeFetch({ [`${P}/v1/mining/blocks/fees/1y`]: fees });
  assert.deepEqual((await chainHistory(f, 'fees', 'ytd', now)).points, [[now - 600, 2]]);
});
