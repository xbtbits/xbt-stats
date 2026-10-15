import { refreshSnapshot, storedSnapshot } from './snapshot.js';
import { chainHistory, CHAIN_SERIES, CHAIN_RANGES } from './history.js';
import {
  priceHistory, PRICE_RANGES, getHealth, recordQuotes, updatePriceSummary, rollup, recordHealth, refreshSeries24h, statsFromSeries,
} from './store.js';
import { fetchQuotes } from './price.js';
import { backfillOnce } from './backfill.js';
import { fetchNodes } from './nodes.js';
import { fetchFx } from './fx.js';
import { fetchLatestBlock } from './block.js';

const API_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function json(body, { status = 200, maxAge = 0 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...API_HEADERS, 'cache-control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store' },
  });
}

// Seconds; ranges not listed (longer than 7 days) are cached for an hour.
const PRICE_TTL = { '1h': 60, '1d': 120, '7d': 300 };
const CHAIN_TTL = { '1d': 300, '7d': 900 };

export const isFifthMinute = (nowMs) => new Date(nowMs).getUTCMinutes() % 5 === 0;

// Every minute: record quotes and update the summary (quotes, ATH).
// Every 5th minute also: roll-ups, the stored 24h series and the 24h window stats
// (keeps D1 rows read low; see docs/deploy.md "D1 budget").
export async function runPriceJob({ fetchFn, db, nowMs }) {
  const nowSec = Math.floor(nowMs / 1000);
  const quotes = await fetchQuotes(fetchFn, nowMs);
  // Only the markets that make up the price are stored and averaged; the rest are
  // kept for the markets list (in the summary row, no extra writes).
  const priced = quotes.filter((q) => q.inPrice);
  const written = await recordQuotes(db, priced);
  let stats;
  if (isFifthMinute(nowMs)) {
    // A failure here must not block the summary and health updates below.
    try {
      await rollup(db, nowSec);
      stats = statsFromSeries((await refreshSeries24h(db, nowSec)).points, nowSec);
    } catch (err) {
      console.error('5-minute price work failed', err?.message ?? err);
    }
  }
  await updatePriceSummary(db, priced, nowSec, stats, quotes);
  await recordHealth(db, 'price', written > 0, nowMs);
  return quotes;
}

export function createWorker({ fetchFn, now = () => Date.now() }) {
  // Canonical keys only (validated before use), so query strings can't bypass the cache.
  const memo = new Map();
  const inflight = new Map(); // key -> promise, so concurrent misses share one build
  const blockMemo = new Map(); // last scanned block, so each block is downloaded once

  async function cachedJson(key, maxAge, build, ctx) {
    const t = now();
    const hit = memo.get(key);
    if (hit && hit.expires > t) return json(hit.body, { maxAge });
    const cache = globalThis.caches?.default;
    const cacheKey = new Request(key);
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }
    let pending = inflight.get(key);
    if (!pending) {
      pending = build().finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const body = await pending;
    memo.set(key, { expires: t + maxAge * 1000, body });
    const res = json(body, { maxAge });
    if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method not allowed' }, { status: 405 });
      const nowMs = now();
      try {
        if (url.pathname === '/api/snapshot') {
          // Served from the copy the cron stores every minute; built here only if that's missing or stale.
          return await cachedJson(`${url.origin}/api/snapshot`, 30, async () => (await storedSnapshot(env.DB, nowMs))
            ?? refreshSnapshot({ fetchFn, db: env.DB, nowMs }), ctx);
        }
        if (url.pathname === '/api/history') {
          const series = url.searchParams.get('series');
          const range = url.searchParams.get('range');
          // v2: pools gained 24h/1w/1m ranges and DATUM fields; the version skips answers cached before.
          const key = `${url.origin}/api/history?series=${series}&range=${range}&v=2`;
          if (series === 'price' && PRICE_RANGES.includes(range)) {
            return await cachedJson(key, PRICE_TTL[range] ?? 3600, async () => ({
              series, range, source: 'recorded', points: await priceHistory(env.DB, range, Math.floor(nowMs / 1000)),
            }), ctx);
          }
          if (CHAIN_SERIES.includes(series) && CHAIN_RANGES.includes(range)) {
            return await cachedJson(key, CHAIN_TTL[range] ?? 3600,
              async () => ({ series, range, ...(await chainHistory(fetchFn, series, range, Math.floor(nowMs / 1000))) }), ctx);
          }
          return json({ error: 'bad series or range' }, { status: 400 });
        }
        if (url.pathname === '/api/nodes') {
          // Census data changes hourly; fetched on demand only (not in the cron).
          return await cachedJson(`${url.origin}/api/nodes`, 600, () => fetchNodes(fetchFn), ctx);
        }
        if (url.pathname === '/api/fx') {
          // Daily exchange rates for the world-currencies card; fetched on demand, cached an hour.
          return await cachedJson(`${url.origin}/api/fx`, 3600, () => fetchFx(fetchFn, Math.floor(nowMs / 1000)), ctx);
        }
        if (url.pathname === '/api/block') {
          // The newest block scanned for data; fetched on demand only (not in the cron).
          return await cachedJson(`${url.origin}/api/block`, 60, () => fetchLatestBlock(fetchFn, blockMemo), ctx);
        }
        if (url.pathname === '/api/health') return json(await getHealth(env.DB, nowMs));
        return json({ error: 'not found' }, { status: 404 });
      } catch (err) {
        console.error('api error', url.pathname, err?.message ?? err);
        return json({ error: 'temporarily unavailable' }, { status: 503 });
      }
    },

    async scheduled(controller, env, ctx) {
      const nowMs = controller?.scheduledTime ?? now();
      // Every minute: the price, then the snapshot built from it and stored for visitors (which
      // also keeps chain health and the last-good copy fresh), then the one-time history import.
      ctx.waitUntil(runPriceJob({ fetchFn, db: env.DB, nowMs }).catch(async (err) => {
        console.error('price job failed', err?.message ?? err);
        try { await recordHealth(env.DB, 'price', false, nowMs); } catch { /* D1 itself is down */ }
      }).then(() => refreshSnapshot({ fetchFn, db: env.DB, nowMs }).catch((err) => {
        console.error('snapshot job failed', err?.message ?? err);
      })).then(() => backfillOnce({ fetchFn, db: env.DB, nowMs })));
    },
  };
}

export default createWorker({ fetchFn: (url, init) => fetch(url, init) });
