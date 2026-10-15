// Pure helpers for the mining calculator. No DOM in here.
import { parseAmount } from './convert-math.js';

export const UNITS = { 'GH/s': 1e9, 'TH/s': 1e12, 'PH/s': 1e15 };
export const PERIODS = [
  { key: 'day', label: 'Day', days: 1 },
  { key: 'week', label: 'Week', days: 7 },
  { key: 'month', label: 'Month (30 d)', days: 30 },
  { key: 'year', label: 'Year (365 d)', days: 365 },
];

const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const nonNeg = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export const parseNumber = parseAmount;

export function toHashesPerSecond(value, unit) {
  const mult = UNITS[unit];
  if (!mult || typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value * mult;
}

// The network side, from /api/snapshot; null until there is a usable one.
export function networkFromSnapshot(s) {
  const hashrate = s?.mining?.hashrate;
  const avgBlockSeconds = s?.chain?.avgBlockSeconds;
  const subsidySats = s?.mining?.subsidySats;
  const fees144Sats = s?.mining?.fees144Sats;
  const priceUsd = s?.price?.usd;
  if (![hashrate, avgBlockSeconds, priceUsd].every(pos) || !nonNeg(subsidySats)) return null;
  return {
    hashrate, avgBlockSeconds, subsidySats, priceUsd,
    avgFeeSats: nonNeg(fees144Sats) ? fees144Sats / 144 : 0,
    changePct: s?.difficulty?.changePct,
    halvingHeight: s?.halving?.height ?? null,
    halvingEta: s?.halving?.eta ?? null,
    subsidyAfterSats: nonNeg(s?.halving?.subsidyAfterSats) ? s.halving.subsidyAfterSats : null,
  };
}

// Daily figures; any figure whose inputs are bad is null. Whole result null with no usable hashrate or network.
export function estimate({ hps, watts, kwhUsd, feePct }, net) {
  if (!pos(hps) || !net || !pos(net.hashrate) || !pos(net.avgBlockSeconds)) return null;
  const share = hps / net.hashrate;
  const blocksPerDay = 86400 / net.avgBlockSeconds;
  const feeOk = nonNeg(feePct) && feePct < 100;
  const perDay = (subsidySats) => share * blocksPerDay * ((subsidySats + net.avgFeeSats) / 1e8) * (1 - feePct / 100);
  const xbtPerDay = feeOk ? perDay(net.subsidySats) : null;
  // After the next halving the subsidy drops; fees are assumed unchanged.
  const xbtPerDayAfter = feeOk && net.subsidyAfterSats != null ? perDay(net.subsidyAfterSats) : null;
  const revenuePerDay = xbtPerDay == null ? null : xbtPerDay * net.priceUsd;
  const revenuePerDayAfter = xbtPerDayAfter == null ? null : xbtPerDayAfter * net.priceUsd;
  const costPerDay = nonNeg(watts) && nonNeg(kwhUsd) ? (watts / 1000) * 24 * kwhUsd : null;
  const profitPerDay = revenuePerDay == null || costPerDay == null ? null : revenuePerDay - costPerDay;
  return {
    share, blocksPerDay, xbtPerDay, xbtPerDayAfter, revenuePerDay, revenuePerDayAfter, costPerDay, profitPerDay,
    soloDays: 1 / (share * blocksPerDay),
    overNetwork: share > 1,
  };
}

// Totals for a period. If the next halving falls inside it (daysToHalving between 0 and days),
// the days after the halving earn the lower reward.
export function forPeriod(e, days, daysToHalving = null) {
  if (!e) return null;
  const splits = daysToHalving != null && daysToHalving >= 0 && daysToHalving < days && e.xbtPerDayAfter != null;
  const before = splits ? daysToHalving : days;
  const after = days - before;
  const blend = (cur, next) => (cur == null ? null : cur * before + (after > 0 ? next * after : 0));
  const xbt = blend(e.xbtPerDay, e.xbtPerDayAfter);
  const revenue = blend(e.revenuePerDay, e.revenuePerDayAfter);
  const cost = e.costPerDay == null ? null : e.costPerDay * days;
  const profit = revenue == null || cost == null ? null : revenue - cost;
  return { xbt, revenue, cost, profit, spansHalving: splits };
}

export function formatSoloTime(days) {
  if (!pos(days) || !Number.isFinite(days)) return '—';
  if (days >= 730) return `≈ ${(days / 365).toFixed(1)} years`;
  if (days >= 1) return `≈ ${days.toFixed(1)} days`;
  if (days >= 1 / 24) return `≈ ${(days * 24).toFixed(1)} hours`;
  return `≈ ${Math.round(days * 1440)} minutes`;
}
