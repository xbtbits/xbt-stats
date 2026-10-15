const DAY = 86_400;
const dayStart = (ts) => Math.floor(ts / DAY) * DAY;

// Last value of each UTC day, ascending: [[dayStartSec, close], ...].
export function dailyCloses(points) {
  const out = [];
  for (const [ts, v] of points) {
    if (!Number.isFinite(ts) || !Number.isFinite(v)) continue;
    const day = dayStart(ts);
    const last = out[out.length - 1];
    if (last && last[0] === day) last[1] = v;
    else out.push([day, v]);
  }
  return out;
}

// Mean of the last `days` closes, for every day that has that many: [[dayStartSec, ma], ...].
export function movingAverage(closes, days) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i][1];
    if (i >= days) sum -= closes[i - days][1];
    if (i >= days - 1) out.push([closes[i][0], sum / days]);
  }
  return out;
}

// The MA of the day containing ts, or null when that day has none.
export function maAt(ma, ts) {
  const day = dayStart(ts);
  let lo = 0;
  let hi = ma.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ma[mid][0] === day) return ma[mid][1];
    if (ma[mid][0] < day) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

// Thins a dense series to at most `maxPoints` by averaging runs of neighbouring points
// (time and value). The newest point is kept exactly, so the chart still ends on today's
// value. Series that already fit are returned unchanged.
export function bucketAverage(points, maxPoints) {
  if (!(maxPoints >= 2) || points.length <= maxPoints) return points;
  const size = Math.ceil((points.length - 1) / (maxPoints - 1));
  const out = [];
  for (let i = 0; i < points.length - 1; i += size) {
    const run = points.slice(i, Math.min(i + size, points.length - 1));
    out.push([run.reduce((s, p) => s + p[0], 0) / run.length, run.reduce((s, p) => s + p[1], 0) / run.length]);
  }
  out.push(points.at(-1));
  return out;
}

// Axis labels without needless trailing zeros: "50.00 PH/s" -> "50 PH/s", "47.50 PH/s" -> "47.5 PH/s".
export function trimZeros(label) {
  return String(label).replace(/(\d)\.(\d*?)0+(?=\D|$)/, (m, d, keep) => (keep ? `${d}.${keep}` : d));
}
