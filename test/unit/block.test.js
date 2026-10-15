import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanBlock, fetchLatestBlock } from '../../worker/src/block.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import {
  tx, block, opReturn, tapSpend, ENVELOPE_SCRIPT, PLAIN_TAPSCRIPT, MULTISIG_15,
  BLOCK_ID, BLOCK_RAW, blockSummary, blockRoutes, weightOf,
} from '../helpers/block-fixture.js';

test('scanBlock counts OP_RETURN outputs, their bytes and which transactions have one', () => {
  const raw = block([
    tx(),
    tx({ outputs: [[0x00, 0x14, ...new Array(20).fill(1)], opReturn(40)] }),
    tx(),
    tx({ outputs: [opReturn(80), opReturn(10)] }),
  ]);
  const s = scanBlock(raw, 164);
  assert.equal(s.txCount, 4);
  assert.equal(s.size, raw.length);
  assert.deepEqual(s.opReturn, { outputs: 3, bytes: 42 + 82 + 12, txs: [1, 3], txBytes: [42, 82 + 12] });
  assert.equal(s.envelopes, 0);
});

test('scanBlock gives every transaction its weight, and the OP_RETURN bytes of each data transaction', () => {
  const a = {};
  const b = { outputs: [opReturn(40)] };
  const c = { inputs: [MULTISIG_15], outputs: [opReturn(10), opReturn(20)] };
  const s = scanBlock(block([tx(a), tx(b), tx(c)]), 164);
  assert.deepEqual(s.weights, [weightOf(a), weightOf(b), weightOf(c)]);
  assert.ok(weightOf(c) < 4 * tx(c).length); // witness bytes count once, not four times
  assert.deepEqual(s.opReturn.txs, [1, 2]);
  assert.deepEqual(s.opReturn.txBytes, [42, 12 + 22]);
});

test('scanBlock counts inscription envelopes in taproot script-path spends', () => {
  const raw = block([tx(), tx({ inputs: [tapSpend(ENVELOPE_SCRIPT), tapSpend(ENVELOPE_SCRIPT)] })]);
  assert.equal(scanBlock(raw, 164).envelopes, 2);
});

test('scanBlock does not mistake push data for an envelope', () => {
  const raw = block([tx({ inputs: [tapSpend(PLAIN_TAPSCRIPT)] })]);
  assert.equal(scanBlock(raw, 164).envelopes, 0);
});

test('scanBlock skips a taproot annex before reading the control block', () => {
  const spend = tapSpend(ENVELOPE_SCRIPT);
  spend.witness.push([0x50, 0x01]);
  assert.equal(scanBlock(block([tx({ inputs: [spend] })]), 164).envelopes, 1);
});

test('scanBlock does not count large multisig witness scripts as data', () => {
  const s = scanBlock(block([tx({ inputs: [MULTISIG_15, MULTISIG_15] })]), 164);
  assert.equal(s.envelopes, 0);
  assert.deepEqual(s.opReturn, { outputs: 0, bytes: 0, txs: [], txBytes: [] });
});

test('scanBlock reads any header length and mixes legacy and segwit transactions', () => {
  const raw = block([tx(), tx({ inputs: [MULTISIG_15], outputs: [opReturn(5)] })], 80);
  const s = scanBlock(raw, 80);
  assert.equal(s.txCount, 2);
  assert.deepEqual(s.opReturn.txs, [1]);
});

test('scanBlock rejects a block that does not parse to its exact length', () => {
  const raw = block([tx()]);
  assert.throws(() => scanBlock(raw.subarray(0, raw.length - 3), 164), /block/);
  assert.throws(() => scanBlock(Uint8Array.from([...raw, 0]), 164), /block/);
  assert.throws(() => scanBlock(raw, 150), /block/);
});

const ID = BLOCK_ID;
const G = 'https://mempool.guide/api';
const K = 'https://mempool.kilombino.com/api';
const RAW = BLOCK_RAW;
const tip = blockSummary;
const routes = blockRoutes;

test('fetchLatestBlock reads the newest block and returns its scan', async () => {
  const b = await fetchLatestBlock(fakeFetch(routes(G)));
  assert.deepEqual(b, {
    height: 976800, id: ID, time: 1791773507, txCount: 3, size: RAW.length,
    opReturn: { outputs: 1, bytes: 42, txs: [1], txBytes: [42] }, envelopes: 1, source: 'mempool.guide',
    weights: scanBlock(RAW, 164).weights,
  });
});

test('fetchLatestBlock falls back to the backup explorer', async () => {
  const f = fakeFetch(routes(K));
  const b = await fetchLatestBlock(f);
  assert.equal(b.source, 'mempool.kilombino.com');
  assert.equal(b.txCount, 3);
});

test('fetchLatestBlock rejects a block that does not match its summary', async () => {
  await assert.rejects(fetchLatestBlock(fakeFetch(routes(G, { [`${G}/blocks`]: tip({ tx_count: 4 }) }))), /transaction count/);
  await assert.rejects(fetchLatestBlock(fakeFetch(routes(G, { [`${G}/blocks`]: tip({ size: RAW.length + 1 }) }))), /size/);
  await assert.rejects(fetchLatestBlock(fakeFetch(routes(G, { [`${G}/block/${ID}/header`]: { status: 200, body: 'ff'.repeat(164) } }))), /header/);
  await assert.rejects(fetchLatestBlock(fakeFetch(routes(G, { [`${G}/blocks`]: tip({ id: '../x' }) }))), /id/);
  await assert.rejects(fetchLatestBlock(fakeFetch(routes(G, { [`${G}/blocks`]: tip({ weight: tip()[0].weight + 4 }) }))), /weight/);
});

test('fetchLatestBlock scans each block only once', async () => {
  const f = fakeFetch(routes(G));
  const memo = new Map();
  await fetchLatestBlock(f, memo);
  await fetchLatestBlock(f, memo);
  assert.equal(f.calls.filter((u) => u.endsWith('/raw')).length, 1);
  assert.equal(f.calls.filter((u) => u.endsWith('/blocks')).length, 2);
});
