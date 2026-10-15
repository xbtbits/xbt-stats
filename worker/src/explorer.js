import { fetchJson } from './http.js';
import { num, nonNeg, positive, validTip, ValidationError } from './validate.js';
import * as calc from './calc.js';

export const EXPLORERS = [
  { name: 'mempool.guide', base: 'https://mempool.guide/api' },
  { name: 'mempool.kilombino.com', base: 'https://mempool.kilombino.com/api' },
];

export const PATHS = {
  tip: '/blocks/tip/height',
  blocks: '/v1/blocks',
  difficulty: '/v1/difficulty-adjustment',
  hashrate: '/v1/mining/hashrate/3d',
  pools: '/v1/mining/pools/24h',
  rewards: '/v1/mining/reward-stats/144',
  fees: '/v1/fees/recommended',
  mempool: '/mempool',
  mempoolBlocks: '/v1/fees/mempool-blocks',
};

export async function fetchExplorerRaw(fetchFn, explorer) {
  const keys = Object.keys(PATHS);
  const values = await Promise.all(keys.map((k) => fetchJson(fetchFn, explorer.base + PATHS[k])));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

// mempool projects up to 8 blocks; the last one holds everything that's left.
export function blocksToClear(mempoolBlocks) {
  if (!Array.isArray(mempoolBlocks)) throw new ValidationError('mempool-blocks: not an array');
  if (mempoolBlocks.length === 0) return 0;
  const full = mempoolBlocks.slice(0, -1).map((b) => nonNeg(b?.blockVSize, 'blockVSize'));
  const last = nonNeg(mempoolBlocks.at(-1)?.blockVSize, 'blockVSize');
  const capacity = full.length ? Math.max(...full) : 0;
  if (capacity === 0) return 1;
  return full.length + Math.max(1, Math.ceil(last / capacity));
}

function optional(read) {
  try { return read(); } catch { return null; }
}

export function parseChain(raw, lastGoodTip) {
  const tip = validTip(raw?.tip, lastGoodTip);
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) throw new ValidationError('blocks: empty');
  if (Math.abs(num(raw.blocks[0]?.height, 'block height') - tip) > 2) throw new ValidationError('tip: does not match newest block');
  if (!Array.isArray(raw.pools?.pools)) throw new ValidationError('pools: missing');
  const d = raw.difficulty ?? {};
  const h = raw.hashrate ?? {};
  return {
    tip,
    tipTime: positive(raw.blocks[0]?.timestamp, 'tipTime'),
    avgBlockSeconds: positive(d.adjustedTimeAvg, 'adjustedTimeAvg') / 1000,
    difficulty: positive(h.currentDifficulty, 'currentDifficulty'),
    hashrate: positive(h.currentHashrate, 'currentHashrate'),
    diffChangePct: num(d.difficultyChange, 'difficultyChange'),
    lastDiffChangePct: num(d.previousRetarget, 'previousRetarget'),
    blocksToRetarget: nonNeg(d.remainingBlocks, 'remainingBlocks'),
    retargetEta: positive(d.estimatedRetargetDate, 'estimatedRetargetDate'),
    nextRetargetHeight: positive(d.nextRetargetHeight, 'nextRetargetHeight'),
    // Extras for the Charts tab: missing or junk values become null instead of failing the whole chain fetch.
    lastBlockTxs: optional(() => nonNeg(raw.blocks[0]?.tx_count, 'tx_count')),
    avgBlockSizeBytes: optional(() => raw.blocks.reduce((sum, b) => sum + nonNeg(b?.size, 'block size'), 0) / raw.blocks.length),
    blocks24h: nonNeg(raw.pools.blockCount, 'blockCount'),
    pools: raw.pools.pools.map((p) => ({
      name: String(p?.name ?? 'Unknown').slice(0, 40),
      blocks: nonNeg(p?.blockCount, 'pool blockCount'),
    })),
    rewards: {
      totalReward: nonNeg(raw.rewards?.totalReward, 'totalReward'),
      totalFee: nonNeg(raw.rewards?.totalFee, 'totalFee'),
      totalTx: nonNeg(raw.rewards?.totalTx, 'totalTx'),
    },
    fees: {
      fastest: nonNeg(raw.fees?.fastestFee, 'fastestFee'),
      halfHour: nonNeg(raw.fees?.halfHourFee, 'halfHourFee'),
      hour: nonNeg(raw.fees?.hourFee, 'hourFee'),
    },
    mempool: {
      count: nonNeg(raw.mempool?.count, 'mempool count'),
      vsize: nonNeg(raw.mempool?.vsize, 'mempool vsize'),
      totalFeeSats: nonNeg(raw.mempool?.total_fee, 'mempool total_fee'),
    },
    blocksToClear: blocksToClear(raw.mempoolBlocks),
  };
}

export async function fetchChain(fetchFn, lastGoodTip) {
  const errors = [];
  for (const explorer of EXPLORERS) {
    try {
      const raw = await fetchExplorerRaw(fetchFn, explorer);
      return { source: explorer.name, chain: parseChain(raw, lastGoodTip), errors };
    } catch (err) {
      errors.push(`${explorer.name}: ${err?.message ?? 'failed'}`);
    }
  }
  return { source: null, chain: null, errors };
}

export async function crossCheckTip(fetchFn, usedSource) {
  const other = EXPLORERS.find((e) => e.name !== usedSource) ?? EXPLORERS[1];
  try {
    const tip = num(await fetchJson(fetchFn, other.base + PATHS.tip, { timeoutMs: 4000 }), 'tip');
    return { name: other.name, tip };
  } catch {
    return { name: other.name, tip: null };
  }
}

export function tipsDisagree(a, b) {
  return a != null && b != null && Math.abs(a - b) > 2;
}

export function topPools(pools, total, limit = 8) {
  const share = (blocks) => (total > 0 ? (blocks / total) * 100 : 0);
  const sorted = [...pools].sort((a, b) => b.blocks - a.blocks);
  const top = sorted.slice(0, limit).map((p) => ({ name: p.name, blocks: p.blocks, share: share(p.blocks) }));
  const otherBlocks = sorted.slice(limit).reduce((sum, p) => sum + p.blocks, 0);
  if (otherBlocks > 0) top.push({ name: 'Other', blocks: otherBlocks, share: share(otherBlocks) });
  return top;
}

export function buildChainSections(c, nowMs) {
  const supplySats = calc.supplyAt(c.tip);
  return {
    chain: {
      height: c.tip,
      tipTime: c.tipTime,
      avgBlockSeconds: c.avgBlockSeconds,
      supplySats,
      percentIssued: calc.percentIssued(supplySats),
      splitHeight: calc.SPLIT_HEIGHT,
      switchHeight: calc.SWITCH_HEIGHT,
      switchTime: calc.SWITCH_TIME,
      blocksSinceSwitch: c.tip - calc.SWITCH_HEIGHT,
      lastBlockTxs: c.lastBlockTxs,
      avgBlockSizeBytes: c.avgBlockSizeBytes,
    },
    difficulty: {
      difficulty: c.difficulty,
      epoch: calc.epochOf(c.tip),
      changePct: c.diffChangePct,
      lastChangePct: c.lastDiffChangePct,
      blocksToRetarget: c.blocksToRetarget,
      retargetEta: c.retargetEta,
      nextRetargetHeight: c.nextRetargetHeight,
    },
    mining: {
      hashrate: c.hashrate,
      subsidySats: calc.subsidyAt(c.tip),
      blocks24h: c.blocks24h,
      tx144: c.rewards.totalTx,
      fees144Sats: c.rewards.totalFee,
      feesPctOfReward: calc.feesPctOfReward(c.rewards.totalReward, c.rewards.totalFee),
    },
    pools: topPools(c.pools, c.blocks24h),
    fees: { ...c.fees },
    mempool: { ...c.mempool, blocksToClear: c.blocksToClear },
    halving: {
      ...calc.halvingInfo(c.tip, c.avgBlockSeconds, nowMs),
      future: calc.futureHalvings(c.tip, c.avgBlockSeconds, nowMs, 6),
    },
    supply: {
      milestones: calc.supplyMilestones(c.tip, c.avgBlockSeconds, nowMs),
      remainingSats: calc.remainingSats(c.tip),
    },
  };
}
