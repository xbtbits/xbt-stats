import { fetchChain, crossCheckTip, tipsDisagree, buildChainSections } from './explorer.js';
import { aggregate } from './price.js';
import { getPriceSummary, getJson, putJson, recordHealth } from './store.js';
import { COIN } from './calc.js';

const LAST_GOOD_KEY = 'chain:lastGood';
const FRESH_QUOTE_SECONDS = 15 * 60;
const EMPTY_SECTIONS = {
  chain: null, difficulty: null, mining: null, pools: null, fees: null,
  mempool: null, halving: null, supply: null,
};

const MARKET_MAX_AGE = 3600;

export async function buildPrice(db, nowMs, supplySats) {
  const nowSec = Math.floor(nowMs / 1000);
  const summary = await getPriceSummary(db);
  const latest = summary?.quotes ?? [];
  if (latest.length === 0) return null;
  const fresh = latest.filter((q) => nowSec - q.ts <= FRESH_QUOTE_SECONDS);
  const newest = Math.max(...latest.map((q) => q.ts));
  const use = fresh.length > 0 ? fresh : latest.filter((q) => q.ts === newest);
  const agg = aggregate(use.map((q) => ({ ...q, ok: true })));
  const hasDay = summary.price24hAgo != null;
  let ath = summary.ath;
  if (!ath || agg.price > ath.usd) ath = { usd: agg.price, at: nowMs };
  return {
    usd: agg.price,
    changePct24h: hasDay ? ((agg.price - summary.price24hAgo) / summary.price24hAgo) * 100 : agg.changePct,
    high24h: hasDay && summary.high24h != null ? Math.max(summary.high24h, agg.price) : agg.high,
    low24h: hasDay && summary.low24h != null ? Math.min(summary.low24h, agg.price) : agg.low,
    volBase24h: agg.volBase,
    volUsd24h: agg.volUsd,
    ath,
    marketCapUsd: supplySats != null ? (agg.price * supplySats) / COIN : null,
    venues: agg.venues,
    // Every market seen in the last hour, busiest first (some are display-only).
    markets: (summary.markets ?? []).filter((m) => nowSec - m.ts <= MARKET_MAX_AGE)
      .sort((a, b) => b.volUsd - a.volUsd)
      .map(({ label, link, inPrice, price, bid, ask, volUsd, ts }) => ({ label, link, inPrice, price, bid, ask, volUsd, updatedAt: ts * 1000 })),
    marketsDisagree: agg.marketsDisagree,
    updatedAt: Math.max(...use.map((q) => q.ts)) * 1000,
    historySince: summary.historySince != null ? summary.historySince * 1000 : null,
  };
}

// A D1 failure must never take the live chain data down with it.
async function safeD1(fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    console.error('d1 error', err?.message ?? err);
    return fallback;
  }
}

export async function buildSnapshot({ fetchFn, db, nowMs }) {
  const lastGood = await safeD1(() => getJson(db, LAST_GOOD_KEY));
  const live = await fetchChain(fetchFn, lastGood?.chain?.tip ?? null);
  await safeD1(() => recordHealth(db, 'chain', live.chain != null, nowMs));

  let chain = null;
  let source = null;
  let fetchedAt = null;
  let usedFallback = false;
  let crossCheck = null;
  if (live.chain) {
    ({ chain, source } = live);
    fetchedAt = nowMs;
    crossCheck = await crossCheckTip(fetchFn, source);
    await safeD1(() => putJson(db, LAST_GOOD_KEY, { chain, source, fetchedAt }));
  } else if (lastGood) {
    ({ chain, source, fetchedAt } = lastGood);
    usedFallback = true;
  }

  const sections = chain ? buildChainSections(chain, nowMs) : EMPTY_SECTIONS;
  const price = await safeD1(() => buildPrice(db, nowMs, sections.chain?.supplySats ?? null));
  return {
    v: 1,
    generatedAt: nowMs,
    flags: {
      usedFallback,
      sourcesDisagree: chain != null && crossCheck != null && tipsDisagree(chain.tip, crossCheck.tip),
      marketsDisagree: price?.marketsDisagree ?? false,
    },
    sources: { chain: source ? { name: source, fetchedAt } : null, crossCheck, errors: live.errors },
    ...sections,
    price,
  };
}

// The every-minute cron builds the snapshot and stores it, so a visitor gets it from D1 at
// once instead of waiting on the explorers (several seconds, up to ~15 s when one is slow).
export const STORED_KEY = 'snapshot:latest';
export const STORED_FRESH_MS = 2 * 60_000;

// The stored snapshot, or null when it's missing or too old (the cron has stopped), so the
// caller builds one instead.
export async function storedSnapshot(db, nowMs) {
  const s = await safeD1(() => getJson(db, STORED_KEY));
  return s && typeof s.generatedAt === 'number' && nowMs - s.generatedAt <= STORED_FRESH_MS ? s : null;
}

export async function refreshSnapshot({ fetchFn, db, nowMs }) {
  const snapshot = await buildSnapshot({ fetchFn, db, nowMs });
  await safeD1(() => putJson(db, STORED_KEY, snapshot));
  return snapshot;
}
