// Builds raw blocks for the block-scan tests: a header of any length, then transactions.

export function varint(n) {
  if (n < 0xfd) return [n];
  if (n <= 0xffff) return [0xfd, n & 0xff, n >> 8];
  return [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

const withLen = (bytes) => [...varint(bytes.length), ...bytes];
const fill = (n, v = 0x11) => new Array(n).fill(v);

// inputs: [{ witness?: [bytes, ...] }], outputs: [scriptPubKey bytes]
export function tx({ inputs = [{}], outputs = [[0x00, 0x14, ...fill(20)]] } = {}) {
  const segwit = inputs.some((i) => i.witness);
  const out = [1, 0, 0, 0];
  if (segwit) out.push(0x00, 0x01);
  out.push(...varint(inputs.length));
  for (const _ of inputs) out.push(...fill(32, 0xaa), 0, 0, 0, 0, ...withLen([]), 0xff, 0xff, 0xff, 0xff);
  out.push(...varint(outputs.length));
  for (const spk of outputs) out.push(...fill(8, 0), ...withLen(spk));
  if (segwit) {
    for (const i of inputs) {
      const items = i.witness ?? [];
      out.push(...varint(items.length));
      for (const item of items) out.push(...withLen(item));
    }
  }
  out.push(0, 0, 0, 0);
  return out;
}

// Weight = 3 x size without witness data + full size (BIP141).
export function weightOf(opts = {}) {
  const full = tx(opts);
  const stripped = tx({ ...opts, inputs: (opts.inputs ?? [{}]).map(() => ({})) });
  return 3 * stripped.length + full.length;
}

export function block(txs, headerLen = 164) {
  return Uint8Array.from([...fill(headerLen, 0x22), ...varint(txs.length), ...txs.flat()]);
}

export const headerHex = (raw, headerLen = 164) => Buffer.from(raw.subarray(0, headerLen)).toString('hex');

// OP_RETURN with one push of n bytes: 6a <n> <data>
export const opReturn = (n) => [0x6a, n, ...fill(n, 0x42)];
// Taproot script-path spend: [signature, leaf script, control block]
export const tapSpend = (script) => ({ witness: [fill(64, 0x01), script, [0xc0, ...fill(32, 0x02)]] });
// Inscription-style envelope: <pubkey> OP_CHECKSIG OP_FALSE OP_IF <push "ord"> OP_ENDIF
export const ENVELOPE_SCRIPT = [0x20, ...fill(32, 0x03), 0xac, 0x00, 0x63, 0x03, 0x6f, 0x72, 0x64, 0x68];
// A plain tapscript: <pubkey> OP_CHECKSIG, whose key happens to contain the bytes 00 63.
export const PLAIN_TAPSCRIPT = [0x20, 0x00, 0x63, ...fill(30, 0x03), 0xac];
// P2WSH 1-of-15 multisig spend: a 513-byte witness script, which is money, not data.
export const MULTISIG_15 = { witness: [[], fill(72, 0x30), [0x51, ...Array.from({ length: 15 }, () => [0x21, 0x02, ...fill(32, 0x05)]).flat(), 0x5f, 0xae]] };

// Explorer routes serving one small block (3 transactions: plain, OP_RETURN, envelope).
export const BLOCK_ID = 'ab'.repeat(32);
export const BLOCK_RAW = block([tx(), tx({ outputs: [opReturn(40)] }), tx({ inputs: [tapSpend(ENVELOPE_SCRIPT)] })]);
// Block weight: 4 x (header + transaction count) + the transactions' weights.
const BLOCK_WEIGHT = 4 * (164 + 1) + [{}, { outputs: [opReturn(40)] }, { inputs: [tapSpend(ENVELOPE_SCRIPT)] }].reduce((w, o) => w + weightOf(o), 0);
export const blockSummary = (over = {}) => [{ id: BLOCK_ID, height: 976800, timestamp: 1791773507, tx_count: 3, size: BLOCK_RAW.length, weight: BLOCK_WEIGHT, ...over }];
export const blockRoutes = (base, over = {}) => ({
  [`${base}/blocks`]: blockSummary(),
  [`${base}/block/${BLOCK_ID}/header`]: { status: 200, body: headerHex(BLOCK_RAW) },
  [`${base}/block/${BLOCK_ID}/raw`]: BLOCK_RAW,
  ...over,
});
