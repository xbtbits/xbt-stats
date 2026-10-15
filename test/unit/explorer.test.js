import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChain, fetchChain, crossCheckTip, tipsDisagree, topPools, blocksToClear, buildChainSections,
} from '../../worker/src/explorer.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import { explorerRaw, explorerRoutes, PRIMARY, BACKUP } from '../helpers/explorer-fixture.js';

const NOW = 1_791_660_030_000;

test('parseChain normalizes a good response', () => {
  const c = parseChain(explorerRaw(), null);
  assert.equal(c.tip, 976572);
  assert.equal(c.tipTime, 1791659900);
  assert.equal(c.avgBlockSeconds, 510);
  assert.equal(c.hashrate, 43296303440072940);
  assert.equal(c.blocks24h, 153);
  assert.deepEqual(c.rewards, { totalReward: 45039895655, totalFee: 39895655, totalTx: 34158 });
  assert.deepEqual(c.fees, { fastest: 2, halfHour: 1.5, hour: 1 });
  assert.deepEqual(c.mempool, { count: 1957, vsize: 2342826, totalFeeSats: 857347 });
  assert.equal(c.blocksToClear, 12);
  assert.equal(c.lastBlockTxs, 62);
  assert.equal(c.avgBlockSizeBytes, 438000);
});

test('junk block size or tx count shows as missing (null), never fails the chain', () => {
  const noSize = explorerRaw();
  delete noSize.blocks[1].size;
  assert.equal(parseChain(noSize, null).avgBlockSizeBytes, null);
  const badTx = explorerRaw();
  badTx.blocks[0].tx_count = -1;
  assert.equal(parseChain(badTx, null).lastBlockTxs, null);
});

test('blocksToClear uses the largest full block as capacity', () => {
  assert.equal(blocksToClear([]), 0);
  assert.equal(blocksToClear([{ blockVSize: 5000 }]), 1);
  assert.equal(blocksToClear([{ blockVSize: 198000 }, { blockVSize: 10 }]), 2);
  assert.throws(() => blocksToClear(null));
});

test('junk values are rejected', () => {
  const raw = explorerRaw();
  raw.difficulty.adjustedTimeAvg = 'abc';
  assert.throws(() => parseChain(raw, null), /adjustedTimeAvg/);
  const raw2 = explorerRaw();
  raw2.mempool.count = -1;
  assert.throws(() => parseChain(raw2, null), /negative/);
  const raw3 = explorerRaw();
  delete raw3.pools.pools;
  assert.throws(() => parseChain(raw3, null), /pools/);
});

test('a tip that does not match the newest block is rejected', () => {
  const raw = explorerRaw();
  raw.tip = raw.blocks[0].height + 3;
  assert.throws(() => parseChain(raw, null), /does not match newest block/);
  raw.tip = raw.blocks[0].height + 2;
  assert.equal(parseChain(raw, null).tip, raw.tip);
});

test('pool names are trimmed to 40 characters', () => {
  const raw = explorerRaw();
  raw.pools.pools[0].name = 'x'.repeat(100);
  assert.equal(parseChain(raw, null).pools[0].name.length, 40);
});

test('fetchChain uses the primary when it works', async () => {
  const f = fakeFetch(explorerRoutes(PRIMARY, explorerRaw()));
  const r = await fetchChain(f, null);
  assert.equal(r.source, 'mempool.guide');
  assert.equal(r.chain.tip, 976572);
  assert.deepEqual(r.errors, []);
});

test('fetchChain falls back to the backup when the primary fails or sends junk', async () => {
  const bad = explorerRaw();
  bad.hashrate.currentHashrate = null;
  const f = fakeFetch({ ...explorerRoutes(PRIMARY, bad), ...explorerRoutes(BACKUP, explorerRaw()) });
  const r = await fetchChain(f, null);
  assert.equal(r.source, 'mempool.kilombino.com');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^mempool\.guide: /);
});

test('fetchChain returns nulls when both fail', async () => {
  const r = await fetchChain(fakeFetch({}), null);
  assert.equal(r.source, null);
  assert.equal(r.chain, null);
  assert.equal(r.errors.length, 2);
});

test('cross-check reads the other explorer tip, null on failure', async () => {
  const f = fakeFetch({ [`${BACKUP}/blocks/tip/height`]: 976570 });
  assert.deepEqual(await crossCheckTip(f, 'mempool.guide'), { name: 'mempool.kilombino.com', tip: 976570 });
  assert.deepEqual(await crossCheckTip(fakeFetch({}), 'mempool.guide'), { name: 'mempool.kilombino.com', tip: null });
  assert.equal(tipsDisagree(976572, 976570), false);
  assert.equal(tipsDisagree(976572, 976569), true);
  assert.equal(tipsDisagree(976572, null), false);
});

test('topPools keeps 8 and groups the rest as Other', () => {
  const pools = parseChain(explorerRaw(), null).pools;
  const top = topPools(pools, 153);
  assert.equal(top.length, 9);
  assert.deepEqual(top.at(-1), { name: 'Other', blocks: 7, share: (7 / 153) * 100 });
  assert.equal(top[0].share, (52 / 153) * 100);
});

test('buildChainSections produces the snapshot sections', () => {
  const s = buildChainSections(parseChain(explorerRaw(), null), NOW);
  assert.deepEqual(s.chain, {
    height: 976572, tipTime: 1791659900, avgBlockSeconds: 510, supplySats: 2011429062500000,
    percentIssued: 95.78233630952381, splitHeight: 961632, switchHeight: 961640, switchTime: 1788070477,
    blocksSinceSwitch: 14932, lastBlockTxs: 62, avgBlockSizeBytes: 438000,
  });
  assert.deepEqual(s.difficulty, {
    difficulty: 21846214529159510000, epoch: 484, changePct: 17.48, lastChangePct: 9.975,
    blocksToRetarget: 1188, retargetEta: 1792261237408, nextRetargetHeight: 977760,
  });
  assert.deepEqual(s.mining, {
    hashrate: 43296303440072940, subsidySats: 312500000, blocks24h: 153, tx144: 34158,
    fees144Sats: 39895655, feesPctOfReward: 0.08857848007818614,
  });
  assert.equal(s.halving.height, 1050000);
  assert.equal(s.halving.eta, NOW + 37_448_280_000);
  assert.equal(s.halving.future.length, 6);
  assert.equal(s.supply.milestones.length, 4);
  assert.equal(s.supply.remainingSats, 88570935190000);
  assert.deepEqual(s.mempool, { count: 1957, vsize: 2342826, totalFeeSats: 857347, blocksToClear: 12 });
  assert.deepEqual(s.fees, { fastest: 2, halfHour: 1.5, hour: 1 });
  assert.equal(s.pools.length, 9);
});

test('missing block size or tx count does not fail the chain fetch', () => {
  const raw = explorerRaw();
  raw.blocks = raw.blocks.map(({ size, tx_count, ...rest }) => rest);
  const c = parseChain(raw, null);
  assert.equal(c.tip, 976572);
  assert.equal(c.lastBlockTxs, null);
  assert.equal(c.avgBlockSizeBytes, null);
});
