import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillHistory, backfillOnce } from '../../worker/src/backfill.js';
import { getJson, putJson } from '../../worker/src/store.js';
import { fakeD1 } from '../helpers/fake-d1.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import {
  candleRoutes, dailyCandlesBody, hourlyCandlesBody, D0, H0, DAILY_CANDLES_URL, HOURLY_CANDLES_URL,
} from '../helpers/candle-fixture.js';

const NOW = Date.UTC(2026, 9, 10, 19, 20); // ms
const rows = async (db, table) => (await db.prepare(`SELECT ts, price FROM ${table} ORDER BY ts`).all()).results.map((r) => [r.ts, r.price]);

test('backfill inserts valid daily and hourly closes and skips junk candles', async () => {
  const db = fakeD1();
  const counts = await backfillHistory({ fetchFn: fakeFetch(candleRoutes()), db, nowMs: NOW });
  assert.deepEqual(counts, { daily: 2, hourly: 3 });
  assert.deepEqual(await rows(db, 'price_daily'), [[D0, 500], [D0 + 86400, 900]]);
  assert.deepEqual(await rows(db, 'price_hourly'), [[H0, 800], [H0 + 3600, 1200], [H0 + 10800, 1100]]);
});

test('backfill sets ath from the highest hourly close (mid-hour) and the history start', async () => {
  const db = fakeD1();
  await backfillHistory({ fetchFn: fakeFetch(candleRoutes()), db, nowMs: NOW });
  const s = await getJson(db, 'price:summary');
  assert.deepEqual(s.ath, { usd: 1200, at: (H0 + 3600) * 1000 + 1_800_000 });
  assert.equal(s.historySince, D0);
  assert.deepEqual(s.quotes, []);
});

test('backfill is idempotent', async () => {
  const db = fakeD1();
  await backfillHistory({ fetchFn: fakeFetch(candleRoutes()), db, nowMs: NOW });
  const summary = await getJson(db, 'price:summary');
  const again = await backfillHistory({ fetchFn: fakeFetch(candleRoutes()), db, nowMs: NOW });
  assert.deepEqual(again, { daily: 0, hourly: 0 });
  assert.equal((await rows(db, 'price_daily')).length, 2);
  assert.equal((await rows(db, 'price_hourly')).length, 3);
  assert.deepEqual(await getJson(db, 'price:summary'), summary);
});

test('backfill never overwrites rows we already have', async () => {
  const db = fakeD1();
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?)').bind(H0 + 3600, 1000).run();
  await db.prepare('INSERT INTO price_daily (ts, price) VALUES (?, ?)').bind(D0, 450).run();
  const counts = await backfillHistory({ fetchFn: fakeFetch(candleRoutes()), db, nowMs: NOW });
  assert.deepEqual(counts, { daily: 1, hourly: 2 });
  assert.deepEqual(await rows(db, 'price_hourly'), [[H0, 800], [H0 + 3600, 1000], [H0 + 10800, 1100]]);
  assert.deepEqual(await rows(db, 'price_daily'), [[D0, 450], [D0 + 86400, 900]]);
});

test('backfill merges into an existing summary and keeps its other fields', async () => {
  const db = fakeD1();
  const quote = { ts: 1791660000, venue: 'a', label: 'a', price: 850, volBase: 1, volUsd: 1, high: 900, low: 800, changePct: -1 };
  const base = { quotes: [quote], price24hAgo: 870, high24h: 900, low24h: 800 };
  await putJson(db, 'price:summary', { ...base, ath: { usd: 1500, at: 1 }, historySince: 1791000000 });
  await backfillHistory({ fetchFn: fakeFetch(candleRoutes()), db, nowMs: NOW });
  assert.deepEqual(await getJson(db, 'price:summary'), { ...base, ath: { usd: 1500, at: 1 }, historySince: D0 });

  const db2 = fakeD1();
  await putJson(db2, 'price:summary', { ...base, ath: { usd: 1000, at: 2 }, historySince: D0 - 86400 });
  await backfillHistory({ fetchFn: fakeFetch(candleRoutes()), db: db2, nowMs: NOW });
  assert.deepEqual(await getJson(db2, 'price:summary'), {
    ...base, ath: { usd: 1200, at: (H0 + 3600) * 1000 + 1_800_000 }, historySince: D0 - 86400,
  });
});

test('a failed candle request fails the backfill and writes nothing', async () => {
  const db = fakeD1();
  const fetchFn = fakeFetch({ ...candleRoutes(), [HOURLY_CANDLES_URL]: { status: 503, body: 'down' } });
  await assert.rejects(backfillHistory({ fetchFn, db, nowMs: NOW }), /HTTP 503/);
  assert.deepEqual(await rows(db, 'price_daily'), []);
  assert.equal(await getJson(db, 'price:summary'), null);
});

test('a malformed candle response is rejected', async () => {
  const db = fakeD1();
  const fetchFn = fakeFetch({ ...candleRoutes(), [HOURLY_CANDLES_URL]: { success: false } });
  await assert.rejects(backfillHistory({ fetchFn, db, nowMs: NOW }), /candles/);
});

const routesWith = ({ daily, hourly }) => ({
  [DAILY_CANDLES_URL]: { ...dailyCandlesBody(), ...(daily ? { candles: daily } : {}) },
  [HOURLY_CANDLES_URL]: { ...hourlyCandlesBody(), ...(hourly ? { candles: hourly } : {}) },
});
const c = (time, close, extra = {}) => ({ time, open: close, high: close, low: close, close, volume: 3, ...extra });

test('an empty or all-invalid response is a failure, not a success', async () => {
  for (const candles of [[], [c(D0, 'x')]]) {
    const db = fakeD1();
    const fetchFn = fakeFetch(routesWith({ daily: candles, hourly: candles }));
    await assert.rejects(backfillHistory({ fetchFn, db, nowMs: NOW }), /no valid candles/);
    assert.equal(await getJson(db, 'price:summary'), null);
  }
});

test('candles off their interval grid or with high below low are skipped', async () => {
  const db = fakeD1();
  const fetchFn = fakeFetch(routesWith({
    daily: [c(D0, 500), c(D0 + 86400 + 3600, 600), c(D0 + 2 * 86400, 700, { high: 600, low: 800 })],
    hourly: [c(H0, 800), c(H0 + 3600 + 60, 900), c(H0 + 7200, 1000, { high: 900, low: 1100 })],
  }));
  assert.deepEqual(await backfillHistory({ fetchFn, db, nowMs: NOW }), { daily: 1, hourly: 1 });
  assert.deepEqual(await rows(db, 'price_daily'), [[D0, 500]]);
  assert.deepEqual(await rows(db, 'price_hourly'), [[H0, 800]]);
});

async function quietly(fn) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try { await fn(); } finally { console.error = original; }
  return errors;
}

test('backfillOnce: an empty response is not marked done', async () => {
  const db = fakeD1();
  const errors = await quietly(() => backfillOnce({ fetchFn: fakeFetch(routesWith({ daily: [], hourly: [] })), db, nowMs: NOW }));
  assert.equal(await getJson(db, 'backfill:v1'), null);
  assert.deepEqual(await getJson(db, 'backfill:attempts'), { count: 1, lastAt: NOW });
  assert.match(errors.join('\n'), /backfill failed/);
});

test('backfillOnce: attempts at most once every 15 minutes', async () => {
  const db = fakeD1();
  const down = fakeFetch({});
  await quietly(() => backfillOnce({ fetchFn: down, db, nowMs: NOW }));
  const calls = down.calls.length;
  await quietly(() => backfillOnce({ fetchFn: down, db, nowMs: NOW + 14 * 60_000 }));
  assert.equal(down.calls.length, calls);
  assert.equal((await getJson(db, 'backfill:attempts')).count, 1);
  const up = fakeFetch(candleRoutes());
  await backfillOnce({ fetchFn: up, db, nowMs: NOW + 15 * 60_000 });
  assert.deepEqual(await getJson(db, 'backfill:v1'), { at: NOW + 15 * 60_000, daily: 2, hourly: 3 });
});

test('backfillOnce: gives up after 20 failed attempts and says so once', async () => {
  const db = fakeD1();
  await putJson(db, 'backfill:attempts', { count: 19, lastAt: NOW - 3_600_000 });
  const down = fakeFetch({});
  const errors = await quietly(() => backfillOnce({ fetchFn: down, db, nowMs: NOW }));
  assert.deepEqual(await getJson(db, 'backfill:attempts'), { count: 20, lastAt: NOW });
  assert.match(errors.join('\n'), /backfill gave up after 20 failed attempts/);
  const calls = down.calls.length;
  const later = await quietly(() => backfillOnce({ fetchFn: fakeFetch(candleRoutes()), db, nowMs: NOW + 86_400_000 }));
  assert.deepEqual(later, []);
  assert.equal(down.calls.length, calls);
  assert.equal(await getJson(db, 'backfill:v1'), null);
});
test('a low-volume hourly close is stored but never sets the ATH', async () => {
  const db = fakeD1();
  const fetchFn = fakeFetch(routesWith({ hourly: [c(H0, 800), c(H0 + 3600, 3000, { volume: 0.5 }), c(H0 + 7200, 1200, { volume: 1 })] }));
  await backfillHistory({ fetchFn, db, nowMs: NOW });
  assert.deepEqual(await rows(db, 'price_hourly'), [[H0, 800], [H0 + 3600, 3000], [H0 + 7200, 1200]]);
  assert.deepEqual((await getJson(db, 'price:summary')).ath, { usd: 1200, at: (H0 + 7200) * 1000 + 1_800_000 });
});

