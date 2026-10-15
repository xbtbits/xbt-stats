import { fetchJson } from './http.js';
import { num, nonNeg, positive, validPrice, ValidationError } from './validate.js';
import { getJson, putJson } from './store.js';

// One-time import of price history from before our own recording began.
// Neoxa is the only source for that older history.
const BASE = 'https://neoxa.exchange/api/exchange/candles/BTCB2_USDC';
export const CANDLE_URLS = { daily: `${BASE}?interval=1d`, hourly: `${BASE}?interval=1h&limit=1000` };
export const BACKFILL_KEY = 'backfill:v1';
export const ATTEMPTS_KEY = 'backfill:attempts';
const SUMMARY_KEY = 'price:summary';
const RETRY_MS = 15 * 60_000;
const MAX_ATTEMPTS = 20;
const ATH_MIN_VOLUME = 1; // XBT traded in the hour

// A candle must sit on its interval grid (bucket start) and have high >= low.
function validCandle(c, step) {
  try {
    const time = positive(c?.time, 'time');
    if (!Number.isInteger(time) || time % step !== 0) return null;
    const high = positive(c.high, 'high');
    const low = positive(c.low, 'low');
    if (high < low) return null;
    positive(c.open, 'open');
    const volume = nonNeg(c.volume, 'volume');
    return { time, close: validPrice(c.close, 'close'), volume };
  } catch (err) {
    if (err instanceof ValidationError) return null; // skip just this candle
    throw err;
  }
}

function parseCandles(json, label, step) {
  if (json?.success !== true || !Array.isArray(json.candles)) throw new ValidationError(`${label} candles: bad response`);
  return json.candles.map((c) => validCandle(c, step)).filter(Boolean);
}

// INSERT OR IGNORE: rows we rolled up ourselves always win over imported ones.
async function insertCloses(db, table, candles) {
  if (candles.length === 0) return 0;
  const res = await db.prepare(
    `INSERT OR IGNORE INTO ${table} (ts, price)
     SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`,
  ).bind(JSON.stringify(candles.map((c) => [c.time, c.close]))).run();
  return num(res?.meta?.changes ?? 0, 'changes');
}

export async function backfillHistory({ fetchFn, db, nowMs }) {
  const nowSec = Math.floor(nowMs / 1000);
  const notFuture = (c) => c.time <= nowSec;
  const daily = parseCandles(await fetchJson(fetchFn, CANDLE_URLS.daily), 'daily', 86_400).filter(notFuture);
  const hourly = parseCandles(await fetchJson(fetchFn, CANDLE_URLS.hourly), 'hourly', 3_600).filter(notFuture);
  // An empty (or entirely changed) response must not be recorded as a success.
  if (daily.length + hourly.length === 0) throw new ValidationError('backfill: no valid candles');

  const counts = { daily: await insertCloses(db, 'price_daily', daily), hourly: await insertCloses(db, 'price_hourly', hourly) };

  // ATH is the highest hourly close with at least 1 XBT traded: thin early markets
  // make intraday highs and near-empty hours misleading. Every valid candle is still stored.
  const prev = (await getJson(db, SUMMARY_KEY)) ?? { quotes: [], ath: null, historySince: null };
  let ath = prev.ath ?? null;
  const top = hourly.filter((c) => c.volume >= ATH_MIN_VOLUME)
    .reduce((best, c) => (!best || c.close > best.close ? c : best), null);
  if (top && (!ath || top.close > ath.usd)) ath = { usd: top.close, at: top.time * 1000 + 1_800_000 }; // mid-hour
  const times = [...daily, ...hourly].map((c) => c.time);
  if (prev.historySince != null) times.push(prev.historySince);
  const historySince = times.length ? Math.min(...times) : null;
  await putJson(db, SUMMARY_KEY, { ...prev, ath, historySince });
  return counts;
}

// Runs from the cron until it succeeds once. At most one attempt every 15 minutes,
// and it gives up (logging that once) after 20 failed attempts.
export async function backfillOnce({ fetchFn, db, nowMs }) {
  let attempts;
  try {
    if (await getJson(db, BACKFILL_KEY)) return null;
    attempts = (await getJson(db, ATTEMPTS_KEY)) ?? { count: 0, lastAt: null };
    if (attempts.count >= MAX_ATTEMPTS) return null;
    if (attempts.lastAt != null && nowMs - attempts.lastAt < RETRY_MS) return null;
    attempts = { count: attempts.count + 1, lastAt: nowMs };
    await putJson(db, ATTEMPTS_KEY, attempts);
    const counts = await backfillHistory({ fetchFn, db, nowMs });
    const done = { at: nowMs, ...counts };
    await putJson(db, BACKFILL_KEY, done);
    return done;
  } catch (err) {
    console.error('backfill failed', err?.message ?? err);
    if (attempts?.count >= MAX_ATTEMPTS) console.error(`backfill gave up after ${MAX_ATTEMPTS} failed attempts`);
    return null;
  }
}
