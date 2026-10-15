// Stat headers for the Charts page: pure builders from /api/snapshot. No DOM in here.
import * as f from './format.js';

export const HEADER_SERIES = ['hashrate', 'difficulty', 'fees', 'mempool', 'blocksize'];

const DASH = '—';
const ok = (n) => typeof n === 'number' && Number.isFinite(n);
const EPOCH_BLOCKS = 2016;

// USD earned per TH/s per day: blocks per day x (subsidy + average fees) x price / network TH.
export function hashPriceUsd(s) {
  const hashrate = s?.mining?.hashrate;
  const avgBlockSeconds = s?.chain?.avgBlockSeconds;
  const subsidy = s?.mining?.subsidySats;
  const fees144 = s?.mining?.fees144Sats;
  const price = s?.price?.usd;
  if (!(hashrate > 0) || !(avgBlockSeconds > 0) || !(price > 0) || !ok(subsidy) || !ok(fees144)) return null;
  const xbtPerBlock = (subsidy + fees144 / 144) / 1e8;
  return (xbtPerBlock * (86_400 / avgBlockSeconds) * price) / (hashrate / 1e12);
}

function largestPool(pools) {
  const real = (pools ?? []).filter((p) => p.name !== 'Other' && ok(p.share));
  if (real.length === 0) return DASH;
  const top = real.reduce((a, b) => (b.share > a.share ? b : a));
  return `${top.name} (${f.fmtPct(top.share, 1)})`;
}

const item = (label, text, dir) => (dir ? { label, text, dir } : { label, text });
const change = (label, pct) => { const c = f.change(pct); return item(label, c.text, c.dir); };
const usdOf = (sats, price) => (ok(sats) && ok(price) ? (sats / 1e8) * price : null);

const BUILDERS = {
  hashrate: (s) => {
    const hp = hashPriceUsd(s);
    return [
      item('Hashrate (current)', f.fmtHashrate(s?.mining?.hashrate)),
      item('Hash price', hp == null ? DASH : `${f.fmtUsd(hp)} /TH/day`),
      item('Blocks (24h)', f.fmtInt(s?.mining?.blocks24h)),
      item('Largest pool (24h)', largestPool(s?.pools)),
    ];
  },
  difficulty: (s, now) => {
    const d = s?.difficulty;
    const height = s?.chain?.height;
    const eta = d?.retargetEta;
    return [
      item('Difficulty', f.fmtDifficulty(d?.difficulty)),
      item('Epoch', f.fmtInt(d?.epoch)),
      item('Epoch progress', ok(height) ? f.fmtPct(((height % EPOCH_BLOCKS) / EPOCH_BLOCKS) * 100, 1) : DASH),
      item('Retarget block', f.fmtInt(d?.nextRetargetHeight)),
      item('Blocks to retarget', f.fmtInt(d?.blocksToRetarget)),
      item('Retarget ETA', ok(eta) ? `${f.fmtDayMonth(eta)} (${f.fmtRelative(eta - now)})` : DASH),
      change('Estimated change', d?.changePct),
      change('Previous change', d?.lastChangePct),
    ];
  },
  fees: (s) => {
    const fees144 = s?.mining?.fees144Sats;
    const usd = usdOf(fees144, s?.price?.usd);
    const subsidyUsd = usdOf(s?.mining?.subsidySats, s?.price?.usd);
    return [
      item('Avg fees per block', ok(fees144) ? f.fmtXbt(fees144 / 144, 0, 4) : DASH),
      item('Total fees (144 blocks)', !ok(fees144) ? DASH : `${f.fmtXbt(fees144, 0, 4)}${usd == null ? '' : ` (${f.fmtUsdWhole(usd)})`}`),
      item('Fees vs reward', f.fmtPct(s?.mining?.feesPctOfReward)),
      item('Block subsidy value', f.fmtUsdWhole(subsidyUsd)),
    ];
  },
  mempool: (s) => [
    item('Pending txs', f.fmtInt(s?.mempool?.count)),
    item('Mempool size', f.fmtVsize(s?.mempool?.vsize)),
    item('Blocks to clear', f.fmtInt(s?.mempool?.blocksToClear)),
    item('Next block', f.fmtSatVb(s?.fees?.fastest)),
    item('30 min', f.fmtSatVb(s?.fees?.halfHour)),
    item('1 hour', f.fmtSatVb(s?.fees?.hour)),
  ],
  blocksize: (s) => [
    item('Avg block size', f.fmtKb(s?.chain?.avgBlockSizeBytes)),
    item('Txs in last block', f.fmtInt(s?.chain?.lastBlockTxs)),
    item('Avg txs per block', ok(s?.mining?.tx144) ? f.fmtInt(s.mining.tx144 / 144) : DASH),
  ],
};

export function chartHeader(series, snapshot, nowMs) {
  return BUILDERS[series](snapshot, nowMs);
}
