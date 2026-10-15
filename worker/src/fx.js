import { fetchJson, UpstreamError } from './http.js';
import { ValidationError } from './validate.js';

// Exchange rates for the "XBT in world currencies" card: USD -> each currency, daily.
export const FX_CURRENCIES = [
  ['EUR', 'Euro'], ['GBP', 'British Pound'], ['JPY', 'Japanese Yen'], ['CNY', 'Chinese Yuan'],
  ['INR', 'Indian Rupee'], ['CAD', 'Canadian Dollar'], ['AUD', 'Australian Dollar'], ['CHF', 'Swiss Franc'],
  ['KRW', 'Korean Won'], ['BRL', 'Brazilian Real'], ['MXN', 'Mexican Peso'], ['ZAR', 'South African Rand'],
  ['TRY', 'Turkish Lira'], ['ARS', 'Argentine Peso'], ['NGN', 'Nigerian Naira'], ['SGD', 'Singapore Dollar'],
  ['HKD', 'Hong Kong Dollar'], ['AED', 'UAE Dirham'],
];

const DAY = 86_400;
const STALE_AFTER = 3 * DAY; // the sources update daily; older than this, try the other one

// Primary: ExchangeRate-API's open endpoint (free, no key; its terms ask for a credit link).
// Backup: the public-domain Currency API.
export const FX_SOURCES = [
  {
    name: 'ExchangeRate-API',
    home: 'https://www.exchangerate-api.com',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: (d) => {
      if (d?.result !== 'success' || d.base_code !== 'USD') throw new ValidationError('fx: not a USD success response');
      return { rates: d.rates, updatedSec: d.time_last_update_unix };
    },
  },
  {
    name: 'Currency API',
    home: 'https://github.com/fawazahmed0/exchange-api',
    url: 'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
    parse: (d) => {
      const rates = Object.fromEntries(Object.entries(d?.usd ?? {}).map(([k, v]) => [k.toUpperCase(), v]));
      return { rates, updatedSec: Date.parse(`${d?.date}T00:00:00Z`) / 1000 };
    },
  },
];

// Picks our currencies out of a parsed response; every rate must be a positive number.
export function pickRates(rates) {
  const out = {};
  for (const [code] of FX_CURRENCIES) {
    const v = rates?.[code];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new ValidationError(`fx: bad rate ${code}`);
    out[code] = v;
  }
  return out;
}

export async function fetchFx(fetchFn, nowSec = Math.floor(Date.now() / 1000)) {
  for (const src of FX_SOURCES) {
    try {
      const { rates, updatedSec } = src.parse(await fetchJson(fetchFn, src.url));
      if (!Number.isFinite(updatedSec) || updatedSec < nowSec - STALE_AFTER) throw new ValidationError('fx: stale');
      return {
        base: 'USD',
        source: { name: src.name, url: src.home },
        updatedAt: updatedSec * 1000,
        currencies: FX_CURRENCIES.map(([code, name]) => ({ code, name })),
        rates: pickRates(rates),
      };
    } catch {
      // try the next source
    }
  }
  throw new UpstreamError('all exchange-rate sources failed');
}
