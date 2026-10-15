// Pool pie maths: one slice per pool (sized by blocks, clockwise from 12 o'clock), each
// cut into rings. A ring's share of its slice's area is its share of the pool's blocks;
// rings run smallest (inside) to biggest (rim). Points are the history API's pools:
// [name, blocks] or, with DATUM data, [name, blocks, minerBlocks, [[miner, blocks], ...]].

const TAU = 2 * Math.PI;

// Rings of one pool: each DATUM miner, "Other miners" (DATUM blocks of miners not listed)
// and "Built by the pool" (Stratum). Without DATUM data: one ring, datum unknown (null).
export function poolBands([, blocks, minerBlocks, miners]) {
  let bands;
  if (minerBlocks == null) {
    bands = [{ label: null, blocks, datum: null }];
  } else {
    const listed = miners.reduce((sum, [, n]) => sum + n, 0);
    bands = miners.map(([label, n]) => ({ label, blocks: n, datum: true }));
    if (minerBlocks > listed) bands.push({ label: 'Other miners', blocks: minerBlocks - listed, datum: true });
    if (blocks > minerBlocks) bands.push({ label: 'Built by the pool', blocks: blocks - minerBlocks, datum: false });
    bands = bands.filter((b) => b.blocks > 0).sort((a, b) => a.blocks - b.blocks);
  }
  const sum = bands.reduce((s, b) => s + b.blocks, 0) || 1;
  let at = 0;
  return bands.map((b) => {
    const band = { ...b, in: at / sum, out: (at + b.blocks) / sum };
    at += b.blocks;
    return band;
  });
}

// Slices with angles (radians from 12 o'clock) and rings, plus the share of all blocks a
// miner built with DATUM (null when the explorer has no DATUM data).
export function pieModel(points) {
  const total = points.reduce((sum, p) => sum + p[1], 0);
  const known = points.length > 0 && points.every((p) => p[2] != null);
  let at = 0, datum = 0;
  const slices = points.map((p) => {
    const [name, blocks, minerBlocks] = p;
    const a0 = total ? (at / total) * TAU : 0;
    at += blocks;
    if (known) datum += minerBlocks;
    return {
      name, blocks, a0, a1: total ? (at / total) * TAU : 0, bands: poolBands(p),
      datumPct: minerBlocks == null || !blocks ? null : (minerBlocks / blocks) * 100,
    };
  });
  return { total, datumPct: known && total ? (datum / total) * 100 : null, slices };
}

// Slice and ring at `angle` (radians from 12 o'clock, clockwise) and `share` (0 at the
// inner edge to 1 at the rim, by area); null outside the ring or with no data.
export function locate(model, angle, share) {
  if (!model.total || share < 0 || share > 1) return null;
  const a = ((angle % TAU) + TAU) % TAU;
  const slice = model.slices.find((s) => a >= s.a0 && a < s.a1) ?? model.slices.at(-1);
  const band = slice.bands.find((b) => share >= b.in && share < b.out) ?? slice.bands.at(-1);
  return { slice, band };
}
