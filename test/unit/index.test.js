import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, runPriceJob } from '../../worker/src/index.js';
import { getJson } from '../../worker/src/store.js';
import { fakeD1 } from '../helpers/fake-d1.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import { explorerRaw, explorerRoutes, PRIMARY, BACKUP } from '../helpers/explorer-fixture.js';
import { nonkycBody, neoxaBody, NONKYC_URL, NEOXA_URL } from '../helpers/price-fixture.js';
import { candleRoutes, D0, HOURLY_CANDLES_URL, DAILY_CANDLES_URL } from '../helpers/candle-fixture.js';
import { censusRoutes, CENSUS, DATA_URL } from '../helpers/nodes-fixture.js';
import { blockRoutes } from '../helpers/block-fixture.js';

const NOW = 1_791_660_030_000;

function setup(routes = {}) {
  const fetchFn = fakeFetch({
    ...explorerRoutes(PRIMARY, explorerRaw()),
    [`${BACKUP}/blocks/tip/height`]: 976572,
    [NONKYC_URL]: nonkycBody(),
    [NEOXA_URL]: neoxaBody(),
    ...candleRoutes(),
    ...routes,
  });
  const pending = [];
  const env = { DB: fakeD1(), ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
  const ctx = { waitUntil: (p) => pending.push(p) };
  const worker = createWorker({ fetchFn, now: () => NOW });
  const get = (path, init) => worker.fetch(new Request(`https://xbt.test${path}`, init), env, ctx);
  return { fetchFn, env, ctx, worker, get, pending };
}

test('non-API paths go to static assets', async () => {
  const { get } = setup();
  assert.equal(await (await get('/')).text(), 'asset');
});

test('snapshot is JSON with a 30 s public cache header', async () => {
  const { get } = setup();
  const res = await get('/api/snapshot');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal((await res.json()).chain.height, 976572);
});

test('query strings share one cached snapshot', async () => {
  const { get, fetchFn } = setup();
  await get('/api/snapshot?x=1');
  const calls = fetchFn.calls.length;
  await get('/api/snapshot?x=2&y=3');
  await get('/api/snapshot');
  assert.equal(fetchFn.calls.length, calls);
});

test('history validates series and range', async () => {
  const { get } = setup();
  assert.equal((await get('/api/history?series=evil&range=1m')).status, 400);
  assert.equal((await get('/api/history?series=price&range=2y')).status, 400);
  const long = await get('/api/history?series=price&range=10y');
  assert.equal(long.status, 200);
  assert.equal(long.headers.get('cache-control'), 'public, max-age=3600');
  const price = await get('/api/history?series=price&range=7d');
  assert.equal(price.status, 200);
  assert.equal(price.headers.get('cache-control'), 'public, max-age=300');
  assert.deepEqual(await price.json(), { series: 'price', range: '7d', source: 'recorded', points: [] });
});

test('chain history is proxied and cached for an hour', async () => {
  const { get } = setup({
    [`${PRIMARY}/v1/mining/hashrate/1m`]: { hashrates: [{ timestamp: 1789000000, avgHashrate: 4e16 }], difficulty: [] },
  });
  const res = await get('/api/history?series=hashrate&range=1m&junk=1');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  assert.deepEqual(await res.json(), { series: 'hashrate', range: '1m', source: 'mempool.guide', points: [[1789000000, 4e16]] });
});

test('unknown API path, wrong method, upstream failure', async () => {
  const { get } = setup();
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/snapshot', { method: 'POST' })).status, 405);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  let res;
  try {
    res = await get('/api/history?series=fees&range=1m'); // no fee routes in the fake
  } finally {
    console.error = original;
  }
  assert.equal(res.status, 503);
  assert.match(errors.join('\n'), /api error \/api\/history/);
  assert.deepEqual(await res.json(), { error: 'temporarily unavailable' });
});

test('health and the price cron job', async () => {
  const { get, worker, env, ctx, pending } = setup();
  assert.equal((await (await get('/api/health')).json()).ok, false);
  await worker.scheduled({ scheduledTime: NOW, cron: '* * * * *' }, env, ctx);
  await Promise.all(pending);
  assert.equal((await getJson(env.DB, 'health:price')).ok, true);
  await get('/api/snapshot');
  const health = await (await get('/api/health')).json();
  assert.equal(health.ok, true);
  const snapshotJson = await (await get('/api/snapshot')).json();
  assert.ok(snapshotJson.price && snapshotJson.price.usd > 0);
});

test('runPriceJob records both priced venues; the display-only market goes to the summary only', async () => {
  const { fetchFn, env } = setup();
  const quotes = await runPriceJob({ fetchFn, db: env.DB, nowMs: NOW });
  assert.deepEqual(quotes.map((q) => [q.label, q.ok, q.inPrice]), [['NonKYC BTCB2/USDT', true, true], ['Neoxa XBT/USDC', true, true], ['Neoxa XBT/USDT', true, false]]);
  assert.deepEqual((await getJson(env.DB, 'price:summary')).markets.map((m) => m.label), ['NonKYC BTCB2/USDT', 'Neoxa XBT/USDC', 'Neoxa XBT/USDT']);
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM price_points').all();
  assert.equal(results[0].n, 2);
});

test('a failing price job is logged and recorded as unhealthy', async () => {
  const { worker, env, ctx, pending } = setup();
  const brokenEnv = { ...env, DB: { ...env.DB, batch: async () => { throw new Error('d1 down'); } } };
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await worker.scheduled({ scheduledTime: NOW }, brokenEnv, ctx);
    await Promise.all(pending);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /price job failed/);
  assert.equal((await getJson(env.DB, 'health:price')).ok, false);
});

test('scheduled also refreshes chain health without any visitor', async () => {
  const { worker, env, ctx, pending } = setup();
  await worker.scheduled({ scheduledTime: NOW }, env, ctx);
  await Promise.all(pending);
  assert.equal((await getJson(env.DB, 'health:chain')).ok, true);
  assert.equal((await getJson(env.DB, 'chain:lastGood')).chain.tip, 976572);
});

test('concurrent snapshot cache misses share one build', async () => {
  const { get, fetchFn } = setup();
  const [a, b] = await Promise.all([get('/api/snapshot'), get('/api/snapshot')]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(fetchFn.calls.filter((u) => u === `${PRIMARY}/blocks/tip/height`).length, 1);
});

test('cron runs every minute: price, then the chain snapshot, stored for visitors', async () => {
  for (const at of [Date.UTC(2026, 9, 10, 19, 10, 0), Date.UTC(2026, 9, 10, 19, 11, 0)]) {
    const { worker, env, ctx, pending } = setup();
    await worker.scheduled({ scheduledTime: at, cron: '* * * * *' }, env, ctx);
    await Promise.all(pending);
    assert.equal((await getJson(env.DB, 'health:chain')).ok, true);
    assert.equal((await getJson(env.DB, 'health:price')).ok, true);
    const stored = await getJson(env.DB, 'snapshot:latest');
    assert.equal(stored.generatedAt, at);
    assert.equal(stored.chain.height, 976572);
    assert.ok(stored.price.usd > 0); // built after the price job, so it carries this minute's price
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM price_points WHERE ts = ?').bind(at / 1000).all();
    assert.equal(results[0].n, 2);
  }
});

test('visitors get the stored snapshot at once, without asking the explorers', async () => {
  const { worker, env, ctx, pending, fetchFn, get } = setup();
  await worker.scheduled({ scheduledTime: NOW - 30_000, cron: '* * * * *' }, env, ctx);
  await Promise.all(pending);
  const before = fetchFn.calls.length;
  const res = await get('/api/snapshot');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).generatedAt, NOW - 30_000);
  assert.equal(fetchFn.calls.length, before); // no explorer or market call on the visitor's request
});

test('a stored snapshot older than 2 minutes (cron stopped) is rebuilt on the request and stored', async () => {
  const { worker, env, ctx, pending, fetchFn, get } = setup();
  await worker.scheduled({ scheduledTime: NOW - 3 * 60_000, cron: '* * * * *' }, env, ctx);
  await Promise.all(pending);
  const before = fetchFn.calls.length;
  const body = await (await get('/api/snapshot')).json();
  assert.equal(body.generatedAt, NOW);
  assert.ok(fetchFn.calls.length > before);
  assert.equal((await getJson(env.DB, 'snapshot:latest')).generatedAt, NOW);
});

test('if D1 cannot be read, the snapshot is still built on the request', async () => {
  const { env, get } = setup();
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/FROM kv/i.test(sql) ? { bind: () => ({ first: async () => { throw new Error('d1 down'); }, all: async () => { throw new Error('d1 down'); } }) } : prepare(sql));
  const res = await get('/api/snapshot');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).chain.height, 976572);
});

test('price ranges: 1h and ytd, aliases still accepted, cache times by range', async () => {
  const { get } = setup();
  const ttl = { '1h': 60, '1d': 120, '7d': 300, '1m': 3600, ytd: 3600, '1y': 3600, '5y': 3600, all: 3600, '30d': 3600, '3m': 3600, '10y': 3600 };
  for (const [range, maxAge] of Object.entries(ttl)) {
    const res = await get(`/api/history?series=price&range=${range}`);
    assert.equal(res.status, 200, range);
    assert.equal(res.headers.get('cache-control'), `public, max-age=${maxAge}`, range);
    assert.equal((await res.json()).range, range);
  }
});

test('scheduled backfills price history once, after the price job', async () => {
  const { worker, env, ctx, pending, fetchFn } = setup();
  await worker.scheduled({ scheduledTime: NOW, cron: '* * * * *' }, env, ctx);
  await Promise.all(pending);
  assert.deepEqual(await getJson(env.DB, 'backfill:v1'), { at: NOW, daily: 2, hourly: 3 });
  const summary = await getJson(env.DB, 'price:summary');
  assert.equal(summary.historySince, D0);
  assert.equal(summary.quotes.length, 2); // the price job's quotes are kept
  assert.ok(fetchFn.calls.indexOf(HOURLY_CANDLES_URL) > fetchFn.calls.indexOf(NEOXA_URL));
  const before = fetchFn.calls.length;
  await worker.scheduled({ scheduledTime: NOW + 60_000, cron: '* * * * *' }, env, ctx);
  await Promise.all(pending);
  const later = fetchFn.calls.slice(before);
  assert.equal(later.includes(DAILY_CANDLES_URL) || later.includes(HOURLY_CANDLES_URL), false);
});

test('a failed backfill is logged, leaves backfill:v1 unset and retries next run', async () => {
  const { worker, env, ctx, pending } = setup({ [HOURLY_CANDLES_URL]: { status: 503, body: 'down' } });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await worker.scheduled({ scheduledTime: NOW, cron: '* * * * *' }, env, ctx);
    await Promise.all(pending);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /backfill failed/);
  assert.equal(await getJson(env.DB, 'backfill:v1'), null);
  assert.equal((await getJson(env.DB, 'health:price')).ok, true);

  const retry = setup();
  await retry.worker.scheduled({ scheduledTime: NOW + 60_000, cron: '* * * * *' }, env, retry.ctx);
  await Promise.all(retry.pending);
  assert.equal(await getJson(env.DB, 'backfill:v1'), null); // throttled: one attempt per 15 minutes
  await retry.worker.scheduled({ scheduledTime: NOW + 15 * 60_000, cron: '* * * * *' }, env, retry.ctx);
  await Promise.all(retry.pending);
  assert.deepEqual(await getJson(env.DB, 'backfill:v1'), { at: NOW + 15 * 60_000, daily: 2, hourly: 3 });
});

test('5th-minute price runs compute the 24h series, window stats and roll-ups; other minutes do not', async () => {
  const seed = async (db, t) => {
    await db.prepare('INSERT INTO price_points (ts, venue, label, price, vol_base, vol_usd, high, low, change_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(t - 86400 + 30, 'x', 'x', 900, 1, 1, 900, 900, 0, t - 3600, 'x', 'x', 1000, 1, 1, 1000, 1000, 0).run();
  };
  const at10 = Date.UTC(2026, 9, 10, 19, 10, 0);
  const at11 = at10 + 60_000;
  {
    const { fetchFn, env } = setup();
    await seed(env.DB, at10 / 1000);
    await runPriceJob({ fetchFn, db: env.DB, nowMs: at10 });
    const series = await getJson(env.DB, 'series:24h');
    assert.equal(series.computedAt, at10 / 1000);
    assert.deepEqual(series.points[0], [at10 / 1000 - 86400 + 30, 900]);
    const s = await getJson(env.DB, 'price:summary');
    assert.equal(s.price24hAgo, 900);
    assert.equal(s.high24h, 1000);
    assert.ok(s.low24h > 840 && s.low24h < 860);
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM price_hourly').all();
    assert.equal(results[0].n, 1);
  }
  {
    const { fetchFn, env } = setup();
    await seed(env.DB, at11 / 1000);
    await runPriceJob({ fetchFn, db: env.DB, nowMs: at11 });
    assert.equal(await getJson(env.DB, 'series:24h'), null);
    const s = await getJson(env.DB, 'price:summary');
    assert.deepEqual([s.price24hAgo, s.high24h, s.low24h], [null, null, null]);
    assert.equal(s.quotes.length, 2); // quotes still update every minute
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM price_hourly').all();
    assert.equal(results[0].n, 0);
  }
});

test('a failing 5-minute roll-up still updates the price summary and health', async () => {
  const { fetchFn, env } = setup();
  const at10 = Date.UTC(2026, 9, 10, 12, 10, 0);
  const db = env.DB;
  const brokenDb = {
    ...db,
    prepare: (sql) => {
      if (sql.includes('INSERT OR REPLACE INTO price_hourly')) throw new Error('d1 hiccup');
      return db.prepare(sql);
    },
  };
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await runPriceJob({ fetchFn, db: brokenDb, nowMs: at10 });
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /5-minute price work failed/);
  assert.equal((await getJson(db, 'health:price')).ok, true);
  assert.ok((await getJson(db, 'price:summary')).quotes.length > 0);
});

test('/api/nodes: census counts, cached 10 minutes under one key, not part of the cron', async () => {
  const { get, fetchFn, worker, env, ctx, pending } = setup(censusRoutes());
  const res = await get('/api/nodes');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=600');
  const body = await res.json();
  assert.equal(body.reachable, 962);
  assert.equal(body.stable.count, 825);
  const calls = fetchFn.calls.length;
  assert.equal((await get('/api/nodes?x=1')).status, 200);
  assert.equal((await get('/api/nodes')).status, 200);
  assert.equal(fetchFn.calls.length, calls);
  const before = fetchFn.calls.length;
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 10, 19, 10, 0), cron: '* * * * *' }, env, ctx);
  await Promise.all(pending);
  assert.equal(fetchFn.calls.slice(before).some((u) => u.startsWith(CENSUS)), false);
});

test('/api/nodes is 503 when the census is down', async () => {
  const { get } = setup({ ...censusRoutes(), [DATA_URL]: { status: 502, body: 'bad gateway' } });
  const original = console.error;
  console.error = () => {};
  let res;
  try {
    res = await get('/api/nodes');
  } finally {
    console.error = original;
  }
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'temporarily unavailable' });
});

test('/api/block: the newest block scanned for data, cached 60 s under one key', async () => {
  const { get, fetchFn } = setup(blockRoutes(PRIMARY));
  const res = await get('/api/block');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const body = await res.json();
  assert.equal(body.height, 976800);
  assert.deepEqual(body.opReturn, { outputs: 1, bytes: 42, txs: [1], txBytes: [42] });
  assert.equal(body.weights.length, 3);
  assert.equal(body.envelopes, 1);
  const calls = fetchFn.calls.length;
  assert.equal((await get('/api/block?x=1')).status, 200);
  assert.equal(fetchFn.calls.length, calls);
});

test('/api/block is 503 when no explorer can serve the block', async () => {
  const { get } = setup();
  const original = console.error;
  console.error = () => {};
  let res;
  try {
    res = await get('/api/block');
  } finally {
    console.error = original;
  }
  assert.equal(res.status, 503);
});
