// The one value-axis label nearest the current-value tag is left blank when it sits
// within `clearance` px of it, so the tag reads cleanly (positions are pixel offsets).
export function labelsClearOfTag(values, positions, tagPos, clearance, format) {
  let nearest = -1;
  if (tagPos != null) {
    let best = Infinity;
    positions.forEach((p, i) => {
      const d = Math.abs(p - tagPos);
      if (d < best) { best = d; nearest = i; }
    });
    if (best >= clearance) nearest = -1;
  }
  return values.map((v, i) => (i === nearest ? '' : format(v)));
}

const MANTISSAS = [1, 1.5, 2, 3, 5, 7];
const SPARSE = [1, 2, 3, 5];
const MAX_SPLITS = 9;

// "Nice" log-axis tick values within [min, max], ascending.
export function logSplits(min, max) {
  if (!(min > 0) || !(max >= min)) return [];
  const build = (mantissas) => {
    const out = [];
    for (let k = Math.floor(Math.log10(min)) - 1; k <= Math.ceil(Math.log10(max)); k += 1) {
      for (const m of mantissas) {
        const v = Number((m * 10 ** k).toPrecision(12));
        if (v >= min && v <= max) out.push(v);
      }
    }
    return out;
  };
  const full = build(MANTISSAS);
  return full.length > MAX_SPLITS ? build(SPARSE) : full;
}
