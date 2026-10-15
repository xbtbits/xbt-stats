// Pure chain math for XBT. All coin amounts are integer satoshis.

export const SPLIT_HEIGHT = 961_632;
export const SWITCH_HEIGHT = 961_640;
export const SWITCH_TIME = 1_788_070_477; // block 961,640: 2026-08-30 06:14:37 UTC
export const HALVING_INTERVAL = 210_000;
export const RETARGET_INTERVAL = 2_016;
export const TARGET_SPACING = 600;
export const COIN = 100_000_000;
export const MAX_SUPPLY_SATS = 21_000_000 * COIN;
export const LAST_SUBSIDY_HEIGHT = 6_929_999;
const INITIAL_SUBSIDY = 50 * COIN;

export function subsidyAt(height) {
  const era = Math.floor(height / HALVING_INTERVAL);
  if (era >= 64) return 0;
  return Math.floor(INITIAL_SUBSIDY / 2 ** era);
}

export function supplyAt(height) {
  let total = 0;
  for (let start = 0; start <= height; start += HALVING_INTERVAL) {
    const subsidy = subsidyAt(start);
    if (subsidy === 0) break;
    const end = Math.min(height, start + HALVING_INTERVAL - 1);
    total += (end - start + 1) * subsidy;
  }
  return total;
}

export function percentIssued(supplySats) {
  return (supplySats / MAX_SUPPLY_SATS) * 100;
}

export function remainingSats(tip) {
  return supplyAt(LAST_SUBSIDY_HEIGHT) - supplyAt(tip);
}

export function epochOf(height) {
  return Math.floor(height / RETARGET_INTERVAL);
}

export function feesPctOfReward(totalRewardSats, totalFeeSats) {
  return totalRewardSats > 0 ? (totalFeeSats / totalRewardSats) * 100 : 0;
}

// Arrival estimate for `height`: the current average spacing until the next
// halving, then the 600-second target.
export function etaMs(tip, height, avgBlockSeconds, nowMs) {
  const blocks = Math.max(0, height - tip);
  const nextHalving = (Math.floor(tip / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
  const atAverage = Math.min(blocks, nextHalving - tip);
  return nowMs + (atAverage * avgBlockSeconds + (blocks - atAverage) * TARGET_SPACING) * 1000;
}

export function halvingInfo(tip, avgBlockSeconds, nowMs) {
  const height = (Math.floor(tip / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
  return {
    height,
    blocksLeft: height - tip,
    eta: etaMs(tip, height, avgBlockSeconds, nowMs),
    epochProgress: ((tip % HALVING_INTERVAL) / HALVING_INTERVAL) * 100,
    subsidyAfterSats: subsidyAt(height),
  };
}

export function futureHalvings(tip, avgBlockSeconds, nowMs, count = 6) {
  const first = Math.floor(tip / HALVING_INTERVAL) + 1;
  return Array.from({ length: count }, (_, i) => {
    const height = (first + i) * HALVING_INTERVAL;
    return { height, eta: etaMs(tip, height, avgBlockSeconds, nowMs), subsidyAfterSats: subsidyAt(height) };
  });
}

export function heightForSupply(targetSats) {
  let cumulative = 0;
  for (let start = 0; ; start += HALVING_INTERVAL) {
    const subsidy = subsidyAt(start);
    if (subsidy === 0) return null;
    if (cumulative + HALVING_INTERVAL * subsidy >= targetSats) {
      return start + Math.ceil((targetSats - cumulative) / subsidy) - 1;
    }
    cumulative += HALVING_INTERVAL * subsidy;
  }
}

const MILESTONE_BASIS_POINTS = [9600, 9900, 9990, 10000];

export function supplyMilestones(tip, avgBlockSeconds, nowMs) {
  return MILESTONE_BASIS_POINTS.map((bp) => {
    const height = bp === 10000 ? LAST_SUBSIDY_HEIGHT : heightForSupply((MAX_SUPPLY_SATS / 10000) * bp);
    const reached = height <= tip;
    return { pct: bp / 100, height, reached, eta: reached ? null : etaMs(tip, height, avgBlockSeconds, nowMs) };
  });
}
