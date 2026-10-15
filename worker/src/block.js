import { fetchJson, fetchText, fetchBytes, UpstreamError } from './http.js';
import { EXPLORERS } from './explorer.js';
import { positive, ValidationError } from './validate.js';

const MAX_BLOCK_BYTES = 4_100_000; // a block can't be larger than 4 MB
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// The newest block, scanned for data (see scanBlock). Tries each explorer in turn.
// `memo` keeps the last scan, so a block is downloaded and scanned only once.
export async function fetchLatestBlock(fetchFn, memo = new Map()) {
  const errors = [];
  for (const explorer of EXPLORERS) {
    try {
      return { ...(await fromExplorer(fetchFn, explorer, memo)), source: explorer.name };
    } catch (err) {
      errors.push(`${explorer.name}: ${err?.message ?? err}`);
    }
  }
  throw new UpstreamError(errors.join('; '));
}

async function fromExplorer(fetchFn, { base }, memo) {
  const newest = (await fetchJson(fetchFn, `${base}/blocks`))?.[0];
  const id = String(newest?.id ?? '');
  if (!/^[0-9a-f]{64}$/.test(id)) throw new ValidationError('block: bad id');
  const summary = {
    height: positive(newest.height, 'block height'),
    id,
    time: positive(newest.timestamp, 'block time'),
    txCount: positive(newest.tx_count, 'block transaction count'),
    size: positive(newest.size, 'block size'),
    weight: positive(newest.weight, 'block weight'),
  };
  const cached = memo.get(id);
  if (cached) return cached;

  const header = (await fetchText(fetchFn, `${base}/block/${id}/header`)).toLowerCase();
  if (!/^([0-9a-f]{2}){80,400}$/.test(header)) throw new ValidationError('block: bad header');
  const raw = await fetchBytes(fetchFn, `${base}/block/${id}/raw`, { maxBytes: MAX_BLOCK_BYTES });
  if (raw.length !== summary.size) throw new ValidationError('block: size does not match');
  if (toHex(raw.subarray(0, header.length / 2)) !== header) throw new ValidationError('block: header does not match');
  const scan = scanBlock(raw, header.length / 2);
  if (scan.txCount !== summary.txCount) throw new ValidationError('block: transaction count does not match');
  const countBytes = summary.txCount < 0xfd ? 1 : summary.txCount <= 0xffff ? 3 : 5;
  const weight = 4 * (header.length / 2 + countBytes) + scan.weights.reduce((w, x) => w + x, 0);
  if (weight !== summary.weight) throw new ValidationError('block: weight does not match');

  const { weight: _, ...facts } = summary;
  const result = { ...facts, opReturn: scan.opReturn, envelopes: scan.envelopes, weights: scan.weights };
  memo.clear();
  memo.set(id, result);
  return result;
}

// Reads a raw block and counts the two things that are data by definition:
// OP_RETURN outputs, and inscription-style envelopes (OP_FALSE OP_IF ...) in taproot
// script-path spends. Nothing else is guessed at: a large witness script, for
// example a 1-of-15 multisig, is a spending condition and is not counted.
export function scanBlock(raw, headerLen) {
  let i = headerLen;
  const need = (n) => {
    if (i + n > raw.length) throw new ValidationError('block: ends early');
  };
  const varint = () => {
    need(1);
    const b = raw[i++];
    if (b < 0xfd) return b;
    const len = b === 0xfd ? 2 : b === 0xfe ? 4 : 8;
    need(len);
    let n = 0;
    for (let k = len - 1; k >= 0; k -= 1) n = n * 256 + raw[i + k];
    i += len;
    return n;
  };
  const bytes = (n) => {
    need(n);
    const out = raw.subarray(i, i + n);
    i += n;
    return out;
  };

  const txCount = varint();
  if (txCount < 1 || txCount > raw.length) throw new ValidationError('block: bad transaction count');
  const opReturn = { outputs: 0, bytes: 0, txs: [], txBytes: [] };
  const weights = []; // per transaction, BIP141: 3 x size without witness + full size
  let envelopes = 0;
  for (let t = 0; t < txCount; t += 1) {
    const start = i;
    let witness = 0; // marker, flag and witness bytes
    i += 4; // version
    need(2);
    const segwit = raw[i] === 0 && raw[i + 1] === 1;
    if (segwit) i += 2;
    const inputs = varint();
    for (let n = 0; n < inputs; n += 1) {
      i += 36; // previous output
      bytes(varint()); // scriptSig
      i += 4; // sequence
    }
    const outputs = varint();
    let dataBytes = 0;
    for (let n = 0; n < outputs; n += 1) {
      i += 8; // value
      const spk = bytes(varint());
      if (spk[0] === 0x6a) {
        opReturn.outputs += 1;
        opReturn.bytes += spk.length;
        dataBytes += spk.length;
      }
    }
    if (dataBytes > 0) {
      opReturn.txs.push(t);
      opReturn.txBytes.push(dataBytes);
    }
    if (segwit) {
      const witnessStart = i;
      for (let n = 0; n < inputs; n += 1) {
        const items = [];
        const count = varint();
        for (let k = 0; k < count; k += 1) items.push(bytes(varint()));
        if (hasEnvelope(items)) envelopes += 1;
      }
      witness = 2 + (i - witnessStart);
    }
    i += 4; // lock time
    need(0);
    const size = i - start;
    weights.push(3 * (size - witness) + size);
  }
  if (i !== raw.length) throw new ValidationError('block: length does not match');
  return { txCount, size: raw.length, opReturn, envelopes, weights };
}

// A taproot script-path witness ends with [script, control block], plus an optional
// annex (first byte 0x50). The control block is 33 + 32k bytes with leaf version 0xc0.
function hasEnvelope(items) {
  const stack = items.length >= 2 && items.at(-1)[0] === 0x50 ? items.slice(0, -1) : items;
  if (stack.length < 2) return false;
  const control = stack.at(-1);
  if ((control[0] & 0xfe) !== 0xc0 || control.length < 33 || (control.length - 33) % 32 !== 0) return false;
  return hasFalseIf(stack.at(-2));
}

// Walks the script's opcodes (skipping push data) looking for OP_FALSE then OP_IF.
function hasFalseIf(script) {
  let prev = -1;
  for (let i = 0; i < script.length;) {
    const op = script[i++];
    if (op === 0x63 && prev === 0x00) return true;
    if (op >= 0x01 && op <= 0x4b) i += op;
    else if (op === 0x4c) i += 1 + script[i];
    else if (op === 0x4d) i += 2 + (script[i] | (script[i + 1] << 8));
    else if (op === 0x4e) i += 4 + (script[i] | (script[i + 1] << 8) | (script[i + 2] << 16)) + script[i + 3] * 2 ** 24;
    prev = op;
  }
  return false;
}
