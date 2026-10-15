// Pure helpers for the converter: parsing what people type, converting between
// XBT, sats and USD, and formatting the results. No DOM in here.
const SATS_PER_XBT = 1e8;
const MAX = { xbt: 21_000_000, sats: 2.1e15, usd: 1e13 };

const xbtFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
const satsFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Digits with one optional decimal point; thousands commas and spaces are ignored.
export function parseAmount(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[,\s]/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const xbtToSats = (x) => Math.round(x * SATS_PER_XBT);
export const satsToXbt = (s) => s / SATS_PER_XBT;
export const xbtToUsd = (x, price) => x * price;
export const usdToXbt = (u, price) => u / price;

export const formatXbt = (x) => xbtFmt.format(x);
export const formatSats = (s) => satsFmt.format(s);
export const formatUsd = (u) => usdFmt.format(u);

// field is 'xbt' | 'sats' | 'usd'. Returns all three numbers, or { error } when the input is over its limit.
export function convertFrom(field, value, price) {
  if (!(value <= MAX[field])) return { error: 'Too large' };
  if (field === 'xbt') return { xbt: value, sats: xbtToSats(value), usd: xbtToUsd(value, price) };
  if (field === 'sats') {
    const xbt = satsToXbt(value);
    return { xbt, sats: value, usd: xbtToUsd(xbt, price) };
  }
  const xbt = usdToXbt(value, price);
  return { xbt, sats: xbtToSats(xbt), usd: value };
}

// One XBT in a currency, with its usual symbol (en-US style: €, £, CA$, CHF …):
// whole units from 1,000 up, cents below. As [kind, text] pieces, kind 'symbol' or
// 'text', so the page can draw the symbol in another font; null if not a positive number.
export function fiatParts(amount, code) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const digits = amount >= 1000 ? 0 : 2;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits })
    .formatToParts(amount).map((p) => [p.type === 'currency' ? 'symbol' : 'text', p.value]);
}

export function formatFiat(amount, code) {
  return fiatParts(amount, code)?.map(([, v]) => v).join('') ?? '—';
}

// Whole sats one unit of a currency buys, given the XBT price in USD and USD -> currency rate.
export function satsPerUnit(priceUsd, rate) {
  if (!(priceUsd > 0) || !(rate > 0)) return null;
  return Math.floor(1e8 / (priceUsd * rate));
}
