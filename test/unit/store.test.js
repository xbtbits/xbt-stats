import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordQuotes, rollup, priceHistory, getJson, putJson, recordHealth, getHealth,
  updatePriceSummary, getPriceSummary, PRICE_RANGES, refreshSeries24h, statsFromSeries,
} from '../../worker/src/store.js';
import { fakeD1 } from '../helpers/fake-d1.js';

const NOW = 1_791_660_000; // seconds
const q = (ts, venue, price, volUsd) => ({
  ok: true, ts, venue, label: venue, price, volBase: 1, volUsd, high: price + 10, low: price - 10, changePct: -1,
});

test('kv round trip', async () => {
  const db = fakeD1();
  assert.equal(await getJson(db, 'missing'), null);
  await putJson(db, 'a', { x: 1 });
  assert.deepEqual(await getJson(db, 'a'), { x: 1 });
});

test('recordQuotes skips failed venues', async () => {
  const db = fakeD1();
  const n = await recordQuotes(db, [q(NOW, 'a', 100, 10), { ok: false, venue: 'b' }]);
  assert.equal(n, 1);
  const { results } = await db.prepare('SELECT COUNT(*) AS n FROM price_points').all();
  assert.equal(results[0].n, 1);
});

test('history 1d is volume-weighted per timestamp', async () => {
  const db = fakeD1();
  await recordQuotes(db, [q(NOW - 600, 'a', 100, 1), q(NOW - 600, 'b', 200, 3), q(NOW, 'a', 110, 0)]);
  assert.deepEqual(await priceHistory(db, '1d', NOW), [[NOW - 600, 175], [NOW, 110]]);
  await assert.rejects(priceHistory(db, '2y', NOW), /bad range/);
});

test('rollup writes hourly averages and prunes 5-minute rows older than 30 days', async () => {
  const db = fakeD1();
  const hour = Math.floor(NOW / 3600) * 3600;
  await recordQuotes(db, [
    q(hour - 3600, 'a', 100, 1), q(hour - 3300, 'a', 120, 1), // previous hour -> 110
    q(hour + 60, 'a', 500, 1),                                  // current hour, not rolled yet
    q(NOW - 31 * 86400, 'a', 1, 1),                             // too old
  ]);
  await rollup(db, NOW);
  const { results } = await db.prepare('SELECT ts, price FROM price_hourly ORDER BY ts').all();
  assert.deepEqual(results.map((r) => [r.ts, r.price]), [[hour - 3600, 110]]);
  const old = await db.prepare('SELECT COUNT(*) AS n FROM price_points WHERE ts < ?').bind(NOW - 30 * 86400).first();
  assert.equal(old.n, 0);
});

test('1m and all fall back to 5-minute points while history is young', async () => {
  const db = fakeD1();
  await recordQuotes(db, [q(NOW - 600, 'a', 100, 1), q(NOW, 'a', 110, 1)]);
  assert.deepEqual(await priceHistory(db, '1m', NOW), [[NOW - 600, 100], [NOW, 110]]);
  assert.deepEqual(await priceHistory(db, 'all', NOW), [[NOW - 600, 100], [NOW, 110]]);
});

test('long ranges show the last 24 hours at full 5-minute detail', async () => {
  const db = fakeD1();
  const hour = Math.floor(NOW / 3600) * 3600;
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?), (?, ?)').bind(hour - 7200, 100, hour - 3600, 110).run();
  await recordQuotes(db, [q(hour - 3300, 'a', 999, 1), q(hour + 60, 'a', 120, 1)]);
  const expected = [[hour - 3300, 999], [hour + 60, 120]];
  assert.deepEqual(await priceHistory(db, '1m', NOW), expected);
  assert.deepEqual(await priceHistory(db, '7d', NOW), expected);
});

test('older hours are hourly averages drawn at mid-hour, then the 5-minute tail', async () => {
  const db = fakeD1();
  const old = Math.floor(NOW / 3600) * 3600 - 3 * 86400;
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?), (?, ?), (?, ?)')
    .bind(old - 9 * 86400, 1, old, 100, old + 3600, 110).run();
  await recordQuotes(db, [q(old + 600, 'a', 999, 1), q(NOW - 600, 'a', 120, 1)]); // old+600 is already rolled
  assert.deepEqual(await priceHistory(db, '7d', NOW), [[old + 1800, 100], [old + 5400, 110], [NOW - 600, 120]]);
});

test('30d and 3m use hourly mid-hour points then the 5-minute tail', async () => {
  const db = fakeD1();
  const hour = Math.floor(NOW / 3600) * 3600;
  const old = hour - 20 * 86400;
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?), (?, ?)').bind(old, 100, old + 3600, 110).run();
  await db.prepare('INSERT INTO price_daily (ts, price) VALUES (?, ?)').bind(Math.floor(old / 86400) * 86400, 5).run();
  await recordQuotes(db, [q(NOW - 600, 'a', 120, 1)]);
  const expected = [[old + 1800, 100], [old + 5400, 110], [NOW - 600, 120]];
  assert.deepEqual(await priceHistory(db, '30d', NOW), expected);
  assert.deepEqual(await priceHistory(db, '3m', NOW), expected);
});

test('1y uses daily mid-day rows, then hourly, then 5-minute, without overlaps', async () => {
  const db = fakeD1();
  const today = Math.floor(NOW / 86400) * 86400;
  const d1 = today - 200 * 86400;
  const d2 = d1 + 86400;
  const h = d2 + 86400; // hourly row on the day after the last daily row
  await db.prepare('INSERT INTO price_daily (ts, price) VALUES (?, ?), (?, ?), (?, ?)')
    .bind(d1, 10, d2, 20, today - 400 * 86400, 1).run(); // last one is outside 1y
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?), (?, ?), (?, ?)')
    .bind(d1 + 3600, 777, h, 30, h + 3600, 40).run(); // first one is covered by a daily row
  await recordQuotes(db, [q(h + 600, 'a', 888, 1), q(NOW - 600, 'a', 50, 1)]); // h+600 already rolled
  assert.deepEqual(await priceHistory(db, '1y', NOW), [
    [d1 + 43200, 10], [d2 + 43200, 20], [h + 1800, 30], [h + 5400, 40], [NOW - 600, 50],
  ]);
});

test('rollup writes a daily row for a complete day and is idempotent', async () => {
  const db = fakeD1();
  const today = Math.floor(NOW / 86400) * 86400;
  const y = today - 86400;
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?), (?, ?), (?, ?)')
    .bind(y, 100, y + 3600, 120, today + 3600, 999).run(); // today is incomplete
  await rollup(db, NOW);
  await rollup(db, NOW);
  const { results } = await db.prepare('SELECT ts, price FROM price_daily ORDER BY ts').all();
  assert.deepEqual(results.map((r) => [r.ts, r.price]), [[y, 110]]);
});

test('every accepted range works, including 1m and all aliases', async () => {
  const db = fakeD1();
  await recordQuotes(db, [q(NOW, 'a', 110, 1)]);
  for (const r of PRICE_RANGES) assert.deepEqual(await priceHistory(db, r, NOW), [[NOW, 110]], r);
  assert.deepEqual(PRICE_RANGES, ['1h', '1d', '7d', '1m', 'ytd', '1y', '5y', 'all', '30d', '3m', '10y']);
});

test('refreshSeries24h stores one volume-weighted 5-minute series, drawn at each bucket\'s last sample', async () => {
  const db = fakeD1();
  await recordQuotes(db, [
    q(NOW - 86401, 'a', 1, 1),                               // older than 24h: left out
    q(NOW - 600, 'a', 100, 1), q(NOW - 600, 'b', 200, 3), q(NOW - 590, 'a', 110, 0), // one bucket
    q(NOW, 'a', 120, 1),
  ]);
  const series = await refreshSeries24h(db, NOW);
  assert.deepEqual(series, { computedAt: NOW, points: [[NOW - 590, 162], [NOW, 120]] });
  assert.deepEqual(await getJson(db, 'series:24h'), series);
});

test('statsFromSeries: first point (if it reaches back 24h), max and min', () => {
  const start = NOW - 86400;
  assert.deepEqual(statsFromSeries([[start + 200, 900], [NOW - 3600, 1000], [NOW, 850]], NOW), { price24hAgo: 900, high24h: 1000, low24h: 850 });
  // History younger than 24h has no 24h-ago price yet.
  assert.deepEqual(statsFromSeries([[start + 4000, 900], [NOW, 850]], NOW), { price24hAgo: null, high24h: 900, low24h: 850 });
  assert.deepEqual(statsFromSeries([], NOW), { price24hAgo: null, high24h: null, low24h: null });
});

test('updatePriceSummary uses the window stats it is given and otherwise keeps the previous ones', async () => {
  const db = fakeD1();
  await updatePriceSummary(db, [q(NOW - 60, 'a', 100, 1)], NOW - 60, { price24hAgo: 90, high24h: 110, low24h: 80 });
  const s = await updatePriceSummary(db, [q(NOW, 'a', 120, 1)], NOW);
  assert.deepEqual([s.price24hAgo, s.high24h, s.low24h], [90, 110, 80]);
  assert.equal(s.quotes[0].price, 120);
  assert.equal(s.ath.usd, 120);
});

test('1d is the stored 24h series plus the raw tail since it was computed', async () => {
  const db = fakeD1();
  await putJson(db, 'series:24h', { computedAt: NOW - 120, points: [[NOW - 90000, 0], [NOW - 86000, 1], [NOW - 200, 2]] });
  await recordQuotes(db, [q(NOW - 300, 'a', 777, 1), q(NOW - 60, 'a', 3, 1), q(NOW, 'a', 4, 1)]);
  assert.deepEqual(await priceHistory(db, '1d', NOW), [[NOW - 86000, 1], [NOW - 200, 2], [NOW - 60, 3], [NOW, 4]]);
});

test('layered ranges use the stored 24h series without overlaps', async () => {
  const db = fakeD1();
  const hour = Math.floor(NOW / 3600) * 3600;
  const h1 = hour - 86400 - 7200;
  const h2 = h1 + 3600; // the last complete hour before the 24h window
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?), (?, ?)').bind(h1, 100, h2, 110).run();
  await putJson(db, 'series:24h', { computedAt: NOW - 120, points: [[NOW - 86500, 120], [NOW - 3000, 125]] });
  await recordQuotes(db, [
    q(NOW - 87000, 'a', 555, 1), // between the last hourly row and the series start
    q(NOW - 3000, 'a', 777, 1),  // already inside the stored series
    q(NOW - 60, 'a', 130, 1),    // tail
  ]);
  assert.deepEqual(await priceHistory(db, '7d', NOW), [
    [h1 + 1800, 100], [h2 + 1800, 110], [NOW - 87000, 555], [NOW - 86500, 120], [NOW - 3000, 125], [NOW - 60, 130],
  ]);
});

test('a stored series older than a day is ignored in favour of raw points', async () => {
  const db = fakeD1();
  await putJson(db, 'series:24h', { computedAt: NOW - 2 * 86400, points: [[NOW - 2 * 86400, 5]] });
  await recordQuotes(db, [q(NOW - 600, 'a', 100, 1), q(NOW, 'a', 110, 1)]);
  assert.deepEqual(await priceHistory(db, '1d', NOW), [[NOW - 600, 100], [NOW, 110]]);
});

test('price summary keeps newest quote per venue, ath and history start', async () => {
  const db = fakeD1();
  const run = async (ts, quotes) => { await recordQuotes(db, quotes); return updatePriceSummary(db, quotes, ts); };
  // Venues agree within 10%, so the price is the volume-weighted mean: (100 + 105) / 2 = 102.5.
  await run(NOW - 600, [q(NOW - 600, 'a', 100, 1), q(NOW - 600, 'b', 105, 1)]);
  const s = await run(NOW, [q(NOW, 'a', 90, 1), { ok: false, venue: 'b', label: 'b', error: 'down' }]);
  assert.deepEqual(s.quotes.map((x) => [x.venue, x.ts, x.price]).sort(), [['a', NOW, 90], ['b', NOW - 600, 105]]);
  assert.deepEqual(s.ath, { usd: 102.5, at: (NOW - 600) * 1000 });
  assert.equal(s.historySince, NOW - 600);
  assert.deepEqual(await getPriceSummary(db), s);
});

test('price summary with nothing ok keeps previous values', async () => {
  const db = fakeD1();
  const s = await updatePriceSummary(db, [{ ok: false, venue: 'a' }], NOW);
  assert.deepEqual(s, { quotes: [], markets: [], price24hAgo: null, high24h: null, low24h: null, ath: null, historySince: null });
});

test('health tracks the last success per part', async () => {
  const db = fakeD1();
  const t = NOW * 1000;
  assert.equal((await getHealth(db, t)).ok, false);
  await recordHealth(db, 'chain', true, t);
  await recordHealth(db, 'price', true, t);
  assert.equal((await getHealth(db, t)).ok, true);
  await recordHealth(db, 'price', false, t + 60_000);
  const h = await getHealth(db, t + 60_000);
  assert.equal(h.ok, true); // last ok 1 min ago is still fresh
  assert.deepEqual(h.price, { ok: false, at: t + 60_000, lastOkAt: t });
  assert.equal((await getHealth(db, t + 21 * 60_000)).ok, false);
});

test('1h is volume-weighted raw points from the last hour only', async () => {
  const db = fakeD1();
  await recordQuotes(db, [q(NOW - 3700, 'a', 90, 1), q(NOW - 3600, 'a', 100, 1), q(NOW - 60, 'a', 100, 1), q(NOW - 60, 'b', 200, 3), q(NOW, 'a', 110, 1)]);
  assert.deepEqual(await priceHistory(db, '1h', NOW), [[NOW - 3600, 100], [NOW - 60, 175], [NOW, 110]]);
});

test('ytd starts at 00:00 UTC on Jan 1 and uses daily rows when the year is past 90 days', async () => {
  const db = fakeD1();
  const jan1 = Date.UTC(2026, 0, 1) / 1000;
  const today = Math.floor(NOW / 86400) * 86400;
  await db.prepare('INSERT INTO price_daily (ts, price) VALUES (?, ?), (?, ?), (?, ?)')
    .bind(jan1 - 86400, 1, jan1, 10, jan1 + 86400, 20).run(); // Dec 31 is last year
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?), (?, ?)')
    .bind(jan1 + 3600, 777, today - 3 * 86400, 30).run(); // the first is covered by the daily rows
  await recordQuotes(db, [q(NOW - 600, 'a', 50, 1)]);
  assert.deepEqual(await priceHistory(db, 'ytd', NOW), [
    [jan1 + 43200, 10], [jan1 + 86400 + 43200, 20], [today - 3 * 86400 + 1800, 30], [NOW - 600, 50],
  ]);
});

test('ytd right after New Year only shows the new year', async () => {
  const db = fakeD1();
  const jan1 = Date.UTC(2027, 0, 1) / 1000;
  const now = jan1 + 1800;
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?)').bind(jan1 - 3600, 5).run();
  await recordQuotes(db, [q(jan1 - 600, 'a', 99, 1), q(jan1, 'a', 100, 1), q(jan1 + 600, 'a', 110, 1)]);
  assert.deepEqual(await priceHistory(db, 'ytd', now), [[jan1, 100], [jan1 + 600, 110]]);
});

test('ytd early in the year uses hourly rows, not daily ones', async () => {
  const db = fakeD1();
  const jan1 = Date.UTC(2027, 0, 1) / 1000;
  const now = jan1 + 40 * 86400;
  await db.prepare('INSERT INTO price_daily (ts, price) VALUES (?, ?)').bind(jan1 + 86400, 1).run();
  await db.prepare('INSERT INTO price_hourly (ts, price) VALUES (?, ?)').bind(jan1 + 86400, 70).run();
  await recordQuotes(db, [q(now - 600, 'a', 80, 1)]);
  assert.deepEqual(await priceHistory(db, 'ytd', now), [[jan1 + 86400 + 1800, 70], [now - 600, 80]]);
});
