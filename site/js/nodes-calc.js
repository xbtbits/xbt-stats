// Pure helpers for the Nodes page.
const DAY = 86_400;
const SPAN = { '7d': 7 * DAY, '1m': 30 * DAY, '3m': 90 * DAY, '6m': 182 * DAY, '1y': 365 * DAY, '5y': 1825 * DAY, '10y': 3650 * DAY };
export const NODE_RANGES = ['7d', '1m', '3m', '6m', 'ytd', '1y', '5y', '10y', 'all'];

const ok = (n) => typeof n === 'number' && Number.isFinite(n);

// History points [[tsSec, ...], ...] within the range before the newest point.
// YTD starts at Jan 1 (UTC) of the newest point's year.
export function sliceHistory(points, range) {
  if (points.length === 0) return points;
  const newest = points.at(-1)[0];
  const from = range === 'ytd'
    ? Date.UTC(new Date(newest * 1000).getUTCFullYear(), 0, 1) / 1000
    : SPAN[range] ? newest - SPAN[range] : null;
  if (from == null) return points;
  return points.filter((p) => p[0] >= from);
}

export function shareOf(part, whole) {
  return ok(part) && ok(whole) && whole > 0 ? (part / whole) * 100 : null;
}

// Progress through the soft fork's activation window at chain height `height`.
export function windowProgress(height, start, end) {
  if (!ok(height) || !ok(start) || !ok(end) || end <= start) return { pct: null, remaining: null, complete: false };
  const pct = Math.max(0, Math.min(100, ((height - start) / (end - start)) * 100));
  const remaining = Math.max(0, Math.min(end - start, end - height));
  return { pct, remaining, complete: height >= end };
}

const SYNC = [['tip', 'At tip'], ['near', 'Near tip'], ['day', 'Within a day'], ['behind', 'Behind']];

export function syncShares(sync) {
  const counts = SYNC.map(([key]) => (ok(sync?.[key]) ? sync[key] : null));
  const total = counts.reduce((a, c) => a + (c ?? 0), 0);
  return SYNC.map(([key, label], i) => ({ key, label, count: counts[i], pct: total > 0 ? ((counts[i] ?? 0) / total) * 100 : 0 }));
}
