import { fetchJson, UpstreamError } from './http.js';
import { num, ValidationError } from './validate.js';
import { EXPLORERS } from './explorer.js';
import { SWITCH_TIME, SWITCH_HEIGHT } from './calc.js';

export const CHAIN_SERIES = ['hashrate', 'difficulty', 'fees', 'mempool', 'blocksize', 'pools'];
export const CHAIN_RANGES = ['1d', '7d', '1m', '3m', 'ytd', '1y', '5y', '10y', 'all'];

const DAY = 86_400;
// Our range -> the explorer's interval. The chain only exists since the BLAKE2b switch,
// so the long ranges all reach back to it. Hashrate and difficulty are daily values, so
// their 1d/7d come from the 1m series and are cut down here (see sliceDaily).
const MINING = { '1d': '1m', '7d': '1m', '1m': '1m', '3m': '3m', ytd: '1y', '1y': '1y', '5y': 'all', '10y': 'all', all: 'all' };
const BLOCKS = { '1d': '24h', '7d': '1w', '1m': '1m', '3m': '3m', ytd: '1y', '1y': '1y', '5y': 'all', '10y': 'all', all: 'all' };
// The statistics API has no 'all'; 3m covers the chain so far (see docs/deploy.md).
const STATS = { '1d': '24h', '7d': '1w', '1m': '1m', '3m': '3m', ytd: '3m', '1y': '3m', '5y': '3m', '10y': '3m', all: '3m' };
const SHORT = { '1d': DAY, '7d': 7 * DAY };
const MINERS = 20; // DATUM miners kept per pool (the pie's rings)
// Newest point older than this means the explorer's data is stale. Difficulty only
// changes at retargets and pools have no times, so they are not checked.
const STALE_AFTER = { hashrate: 3 * DAY, fees: DAY, blocksize: DAY, mempool: DAY };

// Daily series (hashrate, difficulty) for 1d/7d: the points inside the window plus the
// one just before it, so a line always shows. Difficulty is a step, so that earlier
// value is moved to the window start (it was still in force then).
export function sliceDaily(points, range, nowSec, step = false) {
  const span = SHORT[range];
  if (!span) return points;
  const start = nowSec - span;
  const inside = points.filter((p) => p[0] >= start);
  const before = points.filter((p) => p[0] < start).at(-1);
  if (!before) return inside;
  return [step ? [start, before[1]] : before, ...inside];
}

async function fetchSeries(fetchFn, base, series, range, nowSec) {
  switch (series) {
    case 'hashrate': {
      const d = await fetchJson(fetchFn, `${base}/v1/mining/hashrate/${MINING[range]}`);
      return sliceDaily(d.hashrates.filter((p) => p.timestamp >= SWITCH_TIME)
        .map((p) => [num(p.timestamp, 'timestamp'), num(p.avgHashrate, 'avgHashrate')]), range, nowSec);
    }
    case 'difficulty': {
      const d = await fetchJson(fetchFn, `${base}/v1/mining/hashrate/${MINING[range]}`);
      return sliceDaily(d.difficulty.filter((p) => p.height >= SWITCH_HEIGHT)
        .map((p) => [num(p.time, 'time'), num(p.difficulty, 'difficulty')]), range, nowSec, true);
    }
    case 'fees': {
      const d = await fetchJson(fetchFn, `${base}/v1/mining/blocks/fees/${BLOCKS[range]}`);
      return d.filter((p) => p.avgHeight >= SWITCH_HEIGHT)
        .map((p) => [num(p.timestamp, 'timestamp'), num(p.avgFees, 'avgFees')]);
    }
    case 'blocksize': {
      const d = await fetchJson(fetchFn, `${base}/v1/mining/blocks/sizes-weights/${BLOCKS[range]}`);
      return d.sizes.filter((p) => p.avgHeight >= SWITCH_HEIGHT)
        .map((p) => [num(p.timestamp, 'timestamp'), num(p.avgSize, 'avgSize')])
        .sort((a, b) => a[0] - b[0]);
    }
    case 'mempool': {
      const d = await fetchJson(fetchFn, `${base}/v1/statistics/${STATS[range]}`);
      return d.filter((p) => p.added >= SWITCH_TIME)
        .map((p) => [num(p.added, 'added'), p.vsizes.reduce((sum, v) => sum + num(v, 'vsize'), 0)])
        .sort((a, b) => a[0] - b[0]);
    }
    case 'pools': {
      const d = await fetchJson(fetchFn, `${base}/v1/mining/pools/${BLOCKS[range]}`);
      // mempool.guide adds DATUM data: blocks whose template a miner built (minerBlockCount,
      // absent for pools with none) and the top miners. Other explorers have neither.
      const datum = d.pools.some((p) => p.minerBlockCount != null);
      return d.pools.map((p) => {
        const name = String(p.name).slice(0, 40), blocks = num(p.blockCount, 'blockCount');
        if (!datum) return [name, blocks];
        const minerBlocks = Math.min(blocks, p.minerBlockCount == null ? 0 : num(p.minerBlockCount, 'minerBlockCount'));
        const miners = (p.miners ?? []).slice(0, MINERS).map((m) => [String(m.name).slice(0, 40), num(m.blockCount, 'blockCount')]);
        return [name, blocks, minerBlocks, miners];
      });
    }
    default:
      throw new ValidationError(`bad series: ${series}`);
  }
}

export async function chainHistory(fetchFn, series, range, nowSec = Math.floor(Date.now() / 1000)) {
  if (!CHAIN_SERIES.includes(series)) throw new ValidationError(`bad series: ${series}`);
  if (!CHAIN_RANGES.includes(range)) throw new ValidationError(`bad range: ${range}`);
  // An explorer can answer with old data (a stale cache on its side), so a series whose
  // newest point is too old moves on to the next explorer; if all are old, the newest wins.
  const maxAge = STALE_AFTER[series];
  let best = null;
  // YTD: the year's series, cut to points since Jan 1 UTC (pools have no times).
  const ytdStart = Date.UTC(new Date(nowSec * 1000).getUTCFullYear(), 0, 1) / 1000;
  const fetchRange = async (base) => {
    const points = await fetchSeries(fetchFn, base, series, range, nowSec);
    return range === 'ytd' && series !== 'pools' ? points.filter((p) => p[0] >= ytdStart) : points;
  };
  for (const explorer of EXPLORERS) {
    try {
      const result = { source: explorer.name, points: await fetchRange(explorer.base) };
      const newest = result.points.at(-1)?.[0];
      if (maxAge == null || (newest != null && newest >= nowSec - maxAge)) return result;
      if (!best || (newest ?? 0) > (best.points.at(-1)?.[0] ?? 0)) best = result;
    } catch {
      // try the next explorer
    }
  }
  if (best) return best;
  throw new UpstreamError('all explorers failed');
}
