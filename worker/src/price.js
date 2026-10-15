import { fetchJson } from './http.js';
import { num, nonNeg, validPrice, ValidationError } from './validate.js';

// Best bid / ask when a market publishes them (order books); null otherwise.
function optionalPrice(v) {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

export function parseNonkyc(tickerId) {
  return (json) => {
    if (!Array.isArray(json)) throw new ValidationError('nonkyc: not an array');
    const t = json.find((x) => x && x.ticker_id === tickerId);
    if (!t) throw new ValidationError(`nonkyc: ${tickerId} missing`);
    return {
      price: validPrice(t.last_price, 'price'),
      volBase: nonNeg(t.base_volume, 'base_volume'),
      volUsd: nonNeg(t.target_volume, 'target_volume'),
      high: validPrice(t.high, 'high'),
      low: validPrice(t.low, 'low'),
      changePct: num(t.change_percent, 'change_percent'),
      bid: optionalPrice(t.bid),
      ask: optionalPrice(t.ask),
    };
  };
}

export function parseNeoxa(pair) {
  return (json) => {
    if (!Array.isArray(json?.tickers)) throw new ValidationError('neoxa: no tickers');
    const t = json.tickers.find((x) => x && x.pair === pair);
    if (!t) throw new ValidationError(`neoxa: ${pair} missing`);
    return {
      price: validPrice(t.lastPrice, 'price'),
      volBase: nonNeg(t.volume24h, 'volume24h'),
      volUsd: nonNeg(t.quoteVolume24h, 'quoteVolume24h'),
      high: validPrice(t.high24h, 'high24h'),
      low: validPrice(t.low24h, 'low24h'),
      changePct: num(t.changePercent24h, 'changePercent24h'),
      // Neoxa's markets are automated pools: no order book, so no bid or ask.
      bid: null,
      ask: null,
    };
  };
}

// USD-stablecoin markets only (USDT and USDC treated as $1). No BTC-quoted markets.
// Labels use each exchange's own name for the coin (Neoxa shows BTCB2 as XBT).
// `link`: the market's page, shown on the Converter tab (owner's choice: Neoxa only).
// `inPrice: false`: shown in the markets list but kept out of the site's price
// (too thin: a $10K/day market could swing the average or trip "markets disagree").
const NEOXA = 'https://neoxa.exchange/api/exchange/tickers';
export const VENUES = [
  { id: 'nonkyc:BTCB2_USDT', label: 'NonKYC BTCB2/USDT', url: 'https://api.nonkyc.io/api/v2/tickers', parse: parseNonkyc('BTCB2_USDT') },
  { id: 'neoxa:BTCB2_USDC', label: 'Neoxa XBT/USDC', url: NEOXA, parse: parseNeoxa('BTCB2_USDC'), link: 'https://neoxa.exchange/trade/BTCB2_USDC' },
  { id: 'neoxa:BTCB2_USDT', label: 'Neoxa XBT/USDT', url: NEOXA, parse: parseNeoxa('BTCB2_USDT'), link: 'https://neoxa.exchange/trade/BTCB2_USDT', inPrice: false },
];

export async function fetchQuotes(fetchFn, nowMs) {
  const ts = Math.floor(nowMs / 1000);
  const pages = new Map(); // one request per URL (both Neoxa markets share a ticker page)
  const page = (url) => {
    if (!pages.has(url)) pages.set(url, fetchJson(fetchFn, url));
    return pages.get(url);
  };
  return Promise.all(VENUES.map(async (v) => {
    const base = { venue: v.id, label: v.label, link: v.link ?? null, inPrice: v.inPrice !== false };
    try {
      return { ...base, ok: true, ts, ...v.parse(await page(v.url)) };
    } catch (err) {
      return { ...base, ok: false, error: err?.message ?? 'failed' };
    }
  }));
}

export function aggregate(quotes) {
  const ok = quotes.filter((q) => q && q.ok && q.inPrice !== false);
  if (ok.length === 0) return null;
  const prices = ok.map((q) => q.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const top = ok.reduce((a, b) => (b.volUsd > a.volUsd ? b : a));
  const marketsDisagree = ok.length > 1 && (max - min) / min > 0.10;
  const weights = ok.map((q) => Math.max(q.volUsd, 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weighted = (pick) => (ok.length === 1
    ? pick(ok[0])
    : ok.reduce((sum, q, i) => sum + pick(q) * weights[i], 0) / totalWeight);
  return {
    price: marketsDisagree ? top.price : weighted((q) => q.price),
    marketsDisagree,
    volBase: ok.reduce((s, q) => s + q.volBase, 0),
    volUsd: ok.reduce((s, q) => s + q.volUsd, 0),
    high: top.high,
    low: top.low,
    changePct: marketsDisagree ? top.changePct : weighted((q) => q.changePct),
    venues: ok.map((q) => ({ label: q.label, price: q.price, volUsd: q.volUsd })),
  };
}
