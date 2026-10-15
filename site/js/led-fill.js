// LED block fill under a chart line: columns of small gold blocks from the line down to
// the bottom of the plot, bright at the line and fading to bronze, like the LED wordmark.

const PITCH = 6; // CSS px per block, gap included (same grid as the page background)
const GAP = 1; // CSS px
const HI = [251, 204, 92], LO = [140, 110, 53];

// Value of the line at time `x`, straight between neighbouring points (or, for a step
// series, the earlier point's value until the next one); null outside the data, or where
// either neighbour is missing.
export function valueAt(xs, ys, x, stepped = false) {
  const n = xs.length;
  if (!n || x < xs[0] || x > xs[n - 1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const y0 = ys[lo], y1 = ys[hi];
  if (y0 == null || y1 == null) return null;
  if (xs[hi] === xs[lo] || stepped) return x >= xs[hi] ? y1 : y0;
  return y0 + ((y1 - y0) * (x - xs[lo])) / (xs[hi] - xs[lo]);
}

// Colour and opacity of a block `t` of the way (0..1) from the line to the plot bottom;
// `strength` scales the opacity (1 = full, 0.5 = half as bright).
export function blockStyle(t, strength = 1) {
  const k = Math.min(1, Math.max(0, t));
  const rgb = HI.map((v, i) => Math.round(v + (LO[i] - v) * k));
  return { rgb, alpha: strength * Math.max(0.1, 0.8 - k * 0.75) };
}

// uPlot hook ("drawAxes"): runs after the grid and before the lines, so lines stay on top.
export function drawLedFill(u, strength = 1, stepped = false) {
  const [xs, ys] = u.data;
  const ctx = u.ctx;
  const ratio = window.devicePixelRatio || 1;
  const { left, top, width, height } = u.bbox; // canvas pixels
  const pitch = PITCH * ratio, cell = (PITCH - GAP) * ratio;
  const bottom = top + height;
  ctx.save();
  for (let cx = left; cx + cell <= left + width; cx += pitch) {
    const v = valueAt(xs, ys, u.posToVal((cx + cell / 2 - left) / ratio, 'x'), stepped);
    if (v == null) continue;
    const lineY = u.valToPos(v, 'y', true);
    if (!Number.isFinite(lineY)) continue;
    // First block row: the one the line passes through, on a grid anchored to the plot top.
    const start = top + Math.max(0, Math.floor((lineY - top) / pitch)) * pitch;
    const span = Math.max(1, bottom - lineY);
    for (let y = start; y + cell <= bottom; y += pitch) {
      const { rgb, alpha } = blockStyle((y - lineY) / span, strength);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillRect(cx, y, cell, cell);
    }
  }
  ctx.restore();
}
