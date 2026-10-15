// Squarified treemap (Bruls, Huizing, van Wijk): lays out areas, largest first, as rows of
// near-square tiles that fill the w x h rectangle exactly.
export function squarify(areas, w, h) {
  const out = [];
  let x = 0, y = 0, i = 0;
  while (i < areas.length && w > 0 && h > 0) {
    const side = Math.min(w, h);
    let sum = 0, min = Infinity, max = 0, worst = Infinity, end = i;
    while (end < areas.length) {
      const a = areas[end].area;
      const s = sum + a, mn = Math.min(min, a), mx = Math.max(max, a);
      const ratio = Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
      if (ratio > worst) break;
      sum = s; min = mn; max = mx; worst = ratio; end += 1;
    }
    const thick = sum / side;
    let off = 0;
    for (let k = i; k < end; k += 1) {
      const len = areas[k].area / thick;
      out.push(w >= h ? { ...areas[k], x, y: y + off, w: thick, h: len } : { ...areas[k], x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = end;
  }
  return out;
}
