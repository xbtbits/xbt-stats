import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../../worker/src/snapshot.js';
import { recordQuotes, updatePriceSummary, getJson, refreshSeries24h, statsFromSeries } from '../../worker/src/store.js';
import { fakeD1 } from '../helpers/fake-d1.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import { explorerRaw, explorerRoutes, PRIMARY, BACKUP } from '../helpers/explorer-fixture.js';

const NOW = 1_791_660_030_000;
const NOW_S = Math.floor(NOW / 1000);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

function quotes(ts) {
  return [
    { ok: true, ts, venue: 'nonkyc:BTCB2_USDT', label: 'NonKYC BTCB2/USDT', price: 849.52, volBase: 862.1255, volUsd: 766921.9755, high: 930, low: 839.07, changePct: -3 },
    { ok: true, ts, venue: 'neoxa:BTCB2_USDC', label: 'Neoxa BTCB2/USDC', price: 858, volBase: 339.05801216, volUsd: 314650.22834067, high: 1087, low: 835.2, changePct: -3.878792478006718 },
  ];
}

// Mirrors a 5th-minute price run: record, refresh the 24h series, update the summary with its stats.
async function seed(db, qs, ts) {
  await recordQuotes(db, qs);
  const stats = statsFromSeries((await refreshSeries24h(db, ts)).points, ts);
  await updatePriceSummary(db, qs, ts, stats);
}

function liveFetch(backupTip = 976572) {
  return fakeFetch({ ...explorerRoutes(PRIMARY, explorerRaw()), [`${BACKUP}/blocks/tip/height`]: backupTip });
}

test('happy path: live chain, fresh quotes, cross-check agrees', async () => {
  const db = fakeD1();
  await seed(db, quotes(NOW_S - 60), NOW_S - 60);
  const s = await buildSnapshot({ fetchFn: liveFetch(), db, nowMs: NOW });
  assert.equal(s.v, 1);
  assert.equal(s.generatedAt, NOW);
  assert.deepEqual(s.flags, { usedFallback: false, sourcesDisagree: false, marketsDisagree: false });
  assert.deepEqual(s.sources.chain, { name: 'mempool.guide', fetchedAt: NOW });
  assert.deepEqual(s.sources.crossCheck, { name: 'mempool.kilombino.com', tip: 976572 });
  assert.equal(s.chain.height, 976572);
  close(s.price.usd, 851.9869956632151);
  close(s.price.marketCapUsd, 851.9869956632151 * 20114290.625);
  assert.equal(s.price.updatedAt, (NOW_S - 60) * 1000);
  assert.deepEqual(s.price.venues.map((v) => v.label), ['NonKYC BTCB2/USDT', 'Neoxa BTCB2/USDC']);
  assert.equal((await getJson(db, 'chain:lastGood')).chain.tip, 976572);
  assert.equal((await getJson(db, 'health:chain')).ok, true);
});

test('tips more than 2 blocks apart set sourcesDisagree', async () => {
  const s = await buildSnapshot({ fetchFn: liveFetch(976565), db: fakeD1(), nowMs: NOW });
  assert.equal(s.flags.sourcesDisagree, true);
});

test('both explorers down uses last good data with its original time', async () => {
  const db = fakeD1();
  await buildSnapshot({ fetchFn: liveFetch(), db, nowMs: NOW - 900_000 });
  const s = await buildSnapshot({ fetchFn: fakeFetch({}), db, nowMs: NOW });
  assert.equal(s.flags.usedFallback, true);
  assert.deepEqual(s.sources.chain, { name: 'mempool.guide', fetchedAt: NOW - 900_000 });
  assert.equal(s.chain.height, 976572);
  assert.equal(s.sources.errors.length, 2);
  assert.equal((await getJson(db, 'health:chain')).ok, false);
});

test('cold start with nothing returns nulls', async () => {
  const s = await buildSnapshot({ fetchFn: fakeFetch({}), db: fakeD1(), nowMs: NOW });
  for (const k of ['chain', 'difficulty', 'mining', 'pools', 'fees', 'mempool', 'halving', 'supply', 'price']) {
    assert.equal(s[k], null, k);
  }
  assert.equal(s.sources.chain, null);
  assert.equal(s.sources.crossCheck, null);
  assert.deepEqual(s.flags, { usedFallback: false, sourcesDisagree: false, marketsDisagree: false });
});

test('stale quotes still show the last price with its age', async () => {
  const db = fakeD1();
  await seed(db, quotes(NOW_S - 1800), NOW_S - 1800);
  const s = await buildSnapshot({ fetchFn: liveFetch(), db, nowMs: NOW });
  assert.equal(s.price.updatedAt, (NOW_S - 1800) * 1000);
  assert.equal(s.price.venues.length, 2); // every venue quote sharing the newest timestamp
});

test('24h change comes from recorded history when available', async () => {
  const db = fakeD1();
  await seed(db, quotes(NOW_S - 86400 - 60).map((q) => ({ ...q, price: 900, volUsd: 1 })), NOW_S - 86400 - 60);
  await seed(db, quotes(NOW_S - 60), NOW_S - 60);
  const s = await buildSnapshot({ fetchFn: liveFetch(), db, nowMs: NOW });
  close(s.price.changePct24h, ((851.9869956632151 - 900) / 900) * 100);
  assert.deepEqual(s.price.ath, { usd: 900, at: (NOW_S - 86400 - 60) * 1000 });
});

test('null 24h high/low in the summary fall back to venue values, never 0', async () => {
  const db = fakeD1();
  await seed(db, quotes(NOW_S - 60), NOW_S - 60);
  const summary = await getJson(db, 'price:summary');
  await db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('price:summary', JSON.stringify({ ...summary, price24hAgo: 900, high24h: null, low24h: null })).run();
  const s = await buildSnapshot({ fetchFn: liveFetch(), db, nowMs: NOW });
  assert.equal(s.price.high24h, 930); // top-volume venue, not 0
  assert.equal(s.price.low24h, 839.07);
});

test('a throwing D1 does not take down the live chain sections', async () => {
  const db = { prepare() { throw new Error('d1 down'); }, batch() { throw new Error('d1 down'); } };
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  let s;
  try {
    s = await buildSnapshot({ fetchFn: liveFetch(), db, nowMs: NOW });
  } finally {
    console.error = original;
  }
  assert.equal(s.chain.height, 976572);
  assert.equal(s.price, null);
  assert.match(errors.join('\n'), /d1 error d1 down/);
});
