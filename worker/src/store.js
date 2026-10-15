import { ValidationError } from './validate.js';
import { aggregate } from './price.js';

const DAY = 86_400;
const AGG = 'SELECT ts, SUM(price * MAX(vol_usd, 1)) / SUM(MAX(vol_usd, 1)) AS price FROM price_points';
const SUMMARY_KEY = 'price:summary';
const SERIES_KEY = 'series:24h';
// The last three ('30d' = '1m', '3m', '10y') stay accepted as aliases: the v1 API is additive-only.
export const PRICE_RANGES = ['1h', '1d', '7d', '1m', 'ytd', '1y', '5y', 'all', '30d', '3m', '10y'];
const SPAN_DAYS = { '7d': 7, '30d': 30, '1m': 30, '3m': 90, '1y': 365, '5y': 1825, '10y': 3650 };
const DAILY_AFTER_DAYS = 90; // spans longer than this use the daily layer for older history

export async function getJson(db, key) {
  const row = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  return row ? JSON.parse(row.v) : null;
}

export async function putJson(db, key, value) {
  await db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(key, JSON.stringify(value)).run();
}

export async function recordQuotes(db, quotes) {
  const ok = quotes.filter((q) => q && q.ok);
  if (ok.length === 0) return 0;
  await db.batch(ok.map((q) => db
    .prepare('INSERT OR REPLACE INTO price_points (ts, venue, label, price, vol_base, vol_usd, high, low, change_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(q.ts, q.venue, q.label, q.price, q.volBase, q.volUsd, q.high, q.low, q.changePct)));
  return ok.length;
}

// Idempotent: re-rolls the last three completed hours each run.
export async function rollup(db, nowSec) {
  const hourStart = Math.floor(nowSec / 3600) * 3600;
  await db.prepare(
    `INSERT OR REPLACE INTO price_hourly (ts, price)
     SELECT (ts / 3600) * 3600 AS h, AVG(price) FROM (${AGG} WHERE ts >= ? AND ts < ? GROUP BY ts) GROUP BY h`,
  ).bind(hourStart - 3 * 3600, hourStart).run();
  // Daily averages for the last two complete UTC days, from the hourly rows.
  const todayStart = Math.floor(nowSec / DAY) * DAY;
  await db.prepare(
    `INSERT OR REPLACE INTO price_daily (ts, price)
     SELECT (ts / 86400) * 86400 AS d, AVG(price) FROM price_hourly WHERE ts >= ? AND ts < ? GROUP BY d`,
  ).bind(todayStart - 2 * DAY, todayStart).run();
  await db.prepare('DELETE FROM price_points WHERE ts < ?').bind(nowSec - 30 * DAY).run();
}

// One query, every 5th minute: the last 24 hours as volume-weighted 5-minute buckets,
// each drawn at its last sample's time. Stored in kv so 1d charts and the window
// stats never rescan the raw rows.
export async function refreshSeries24h(db, nowSec) {
  const { results } = await db.prepare(
    `SELECT (ts / 300) * 300 AS b, MAX(ts) AS t, SUM(price * MAX(vol_usd, 1)) / SUM(MAX(vol_usd, 1)) AS price
     FROM price_points WHERE ts >= ? GROUP BY b ORDER BY b`,
  ).bind(nowSec - DAY).all();
  const series = { computedAt: nowSec, points: results.map((r) => [r.t, r.price]) };
  await putJson(db, SERIES_KEY, series);
  return series;
}

// 24h window stats from the stored series. The 24h-ago price needs history that
// reaches back to the window start (within 10 minutes); younger history has none.
export function statsFromSeries(points, nowSec) {
  if (!points.length) return { price24hAgo: null, high24h: null, low24h: null };
  const prices = points.map((p) => p[1]);
  return {
    price24hAgo: points[0][0] <= nowSec - DAY + 600 ? points[0][1] : null,
    high24h: Math.max(...prices),
    low24h: Math.min(...prices),
  };
}

// Called by the price job after recordQuotes. Keeps the newest quote per venue
// (so one failed venue keeps its last value) and an incrementally maintained
// all-time high and history start. The 24h window stats are replaced only when
// `stats` is given (every 5th minute); otherwise the previous ones are kept.
// `markets`: every fetched market (priced or display-only) for the markets list.
export async function updatePriceSummary(db, quotes, nowSec, stats, markets = quotes) {
  const prev = (await getJson(db, SUMMARY_KEY)) ?? { quotes: [], ath: null, historySince: null };
  const ok = quotes.filter((q) => q && q.ok);
  const byVenue = new Map(prev.quotes.map((q) => [q.venue, q]));
  for (const q of ok) {
    byVenue.set(q.venue, {
      ts: q.ts, venue: q.venue, label: q.label, price: q.price, volBase: q.volBase,
      volUsd: q.volUsd, high: q.high, low: q.low, changePct: q.changePct,
    });
  }
  const marketsByVenue = new Map((prev.markets ?? []).map((m) => [m.venue, m]));
  for (const q of markets.filter((m) => m && m.ok)) {
    marketsByVenue.set(q.venue, {
      ts: q.ts, venue: q.venue, label: q.label, link: q.link ?? null, inPrice: q.inPrice !== false,
      price: q.price, bid: q.bid ?? null, ask: q.ask ?? null, volUsd: q.volUsd,
    });
  }
  let ath = prev.ath;
  const now = aggregate(ok);
  if (now && (!ath || now.price > ath.usd)) ath = { usd: now.price, at: ok[0].ts * 1000 };
  const summary = {
    quotes: [...byVenue.values()],
    markets: [...marketsByVenue.values()],
    price24hAgo: prev.price24hAgo ?? null,
    high24h: prev.high24h ?? null,
    low24h: prev.low24h ?? null,
    ...(stats ?? {}),
    ath,
    historySince: prev.historySince ?? (ok.length ? ok[0].ts : null),
  };
  await putJson(db, SUMMARY_KEY, summary);
  return summary;
}

export async function getPriceSummary(db) {
  return getJson(db, SUMMARY_KEY);
}

async function rawPoints(db, since, before = Number.MAX_SAFE_INTEGER) {
  const { results } = await db.prepare(`${AGG} WHERE ts >= ? AND ts < ? GROUP BY ts ORDER BY ts`).bind(since, before).all();
  return results.map((r) => [r.ts, r.price]);
}

// The most recent stretch, from `from` to now: the stored 24h series plus a live raw
// tail since it was computed (and raw rows for any gap before the series starts).
// Falls back to raw rows only when the series is missing (cold start).
async function recentPoints(db, from) {
  const series = await getJson(db, SERIES_KEY);
  if (!series) return rawPoints(db, from);
  const seriesStart = series.computedAt - DAY;
  const gap = from < seriesStart ? await rawPoints(db, from, seriesStart) : [];
  const stored = series.points.filter((p) => p[0] >= Math.max(from, seriesStart));
  const tail = await rawPoints(db, Math.max(from, series.computedAt + 1));
  return [...gap, ...stored, ...tail];
}

function rangeStart(range, nowSec) {
  if (range === 'all') return 0;
  if (range === 'ytd') return Date.UTC(new Date(nowSec * 1000).getUTCFullYear(), 0, 1) / 1000;
  return nowSec - SPAN_DAYS[range] * DAY;
}

export async function priceHistory(db, range, nowSec) {
  if (range === '1h') return rawPoints(db, nowSec - 3600);
  if (range === '1d') return recentPoints(db, nowSec - DAY);
  if (!PRICE_RANGES.includes(range)) throw new ValidationError(`bad range: ${range}`);
  const since = rangeStart(range, nowSec);
  // The last 24 hours always use full raw (per-run) detail; only complete older periods are averaged.
  const recentStart = Math.max(since, nowSec - DAY);
  let cursor = since;
  const points = [];
  if (nowSec - since > DAILY_AFTER_DAYS * DAY) {
    const { results } = await db.prepare('SELECT ts, price FROM price_daily WHERE ts >= ? AND ts + 86400 <= ? ORDER BY ts')
      .bind(since, recentStart).all();
    for (const r of results) points.push([r.ts + 43200, r.price]); // drawn at mid-day
    if (results.length) cursor = results.at(-1).ts + DAY;
  }
  const { results } = await db.prepare('SELECT ts, price FROM price_hourly WHERE ts >= ? AND ts + 3600 <= ? ORDER BY ts')
    .bind(cursor, recentStart).all();
  for (const r of results) points.push([r.ts + 1800, r.price]); // drawn at mid-hour
  if (results.length) cursor = results.at(-1).ts + 3600;
  points.push(...(await recentPoints(db, cursor)));
  return points;
}

export async function recordHealth(db, part, ok, nowMs) {
  const key = `health:${part}`;
  const prev = (await getJson(db, key)) ?? {};
  await putJson(db, key, { ok, at: nowMs, lastOkAt: ok ? nowMs : prev.lastOkAt ?? null });
}

export async function getHealth(db, nowMs) {
  const chain = await getJson(db, 'health:chain');
  const price = await getJson(db, 'health:price');
  const fresh = (p, maxMs) => p?.lastOkAt != null && nowMs - p.lastOkAt <= maxMs;
  return { ok: fresh(chain, 10 * 60_000) && fresh(price, 20 * 60_000), chain, price };
}
