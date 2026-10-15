export const PRIMARY = 'https://mempool.guide/api';
export const BACKUP = 'https://mempool.kilombino.com/api';

export function explorerRaw() {
  return {
    tip: 976572,
    blocks: [
      { height: 976572, timestamp: 1791659900, tx_count: 62, size: 436000 },
      { height: 976571, timestamp: 1791659390, tx_count: 58, size: 440000 },
    ],
    difficulty: {
      progressPercent: 41.07, difficultyChange: 17.48, estimatedRetargetDate: 1792261237408,
      remainingBlocks: 1188, remainingTime: 607181874, previousRetarget: 9.975, previousTime: 1791230424,
      nextRetargetHeight: 977760, timeAvg: 510000, adjustedTimeAvg: 510000, timeOffset: 0, expectedBlocks: 900,
    },
    hashrate: {
      hashrates: [{ timestamp: 1791590400, avgHashrate: 48767291263288220 }],
      difficulty: [],
      currentHashrate: 43296303440072940,
      currentDifficulty: 21846214529159510000,
    },
    pools: {
      blockCount: 153,
      pools: [
        { name: 'AlphaPool', blockCount: 52 }, { name: 'BravoPool', blockCount: 30 },
        { name: 'CharliePool', blockCount: 20 }, { name: 'DeltaPool', blockCount: 15 },
        { name: 'EchoPool', blockCount: 10 }, { name: 'FoxtrotPool', blockCount: 8 },
        { name: 'GolfPool', blockCount: 6 }, { name: 'HotelPool', blockCount: 5 },
        { name: 'IndiaPool', blockCount: 4 }, { name: 'JulietPool', blockCount: 3 },
      ],
    },
    rewards: { startBlock: 976429, endBlock: 976572, totalReward: '45039895655', totalFee: '39895655', totalTx: '34158' },
    fees: { fastestFee: 2, halfHourFee: 1.5, hourFee: 1, economyFee: 1, minimumFee: 1 },
    mempool: { count: 1957, vsize: 2342826, total_fee: 857347 },
    mempoolBlocks: [
      ...Array.from({ length: 7 }, () => ({ blockVSize: 198000 })),
      { blockVSize: 990000 },
    ],
  };
}

export function explorerRoutes(base, raw) {
  return {
    [`${base}/blocks/tip/height`]: raw.tip,
    [`${base}/v1/blocks`]: raw.blocks,
    [`${base}/v1/difficulty-adjustment`]: raw.difficulty,
    [`${base}/v1/mining/hashrate/3d`]: raw.hashrate,
    [`${base}/v1/mining/pools/24h`]: raw.pools,
    [`${base}/v1/mining/reward-stats/144`]: raw.rewards,
    [`${base}/v1/fees/recommended`]: raw.fees,
    [`${base}/mempool`]: raw.mempool,
    [`${base}/v1/fees/mempool-blocks`]: raw.mempoolBlocks,
  };
}
