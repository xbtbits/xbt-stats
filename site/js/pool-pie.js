import { pieModel, locate } from './pool-pie-math.js';
import * as f from './format.js';

// Pool pie in the price chart's LED blocks (5 px squares on a 6 px grid). Blocks a miner
// built with DATUM are gold (three alternating shades per pool), blocks a pool built
// (Stratum) are silver; rings shade from dim inside to bright at the rim and every other
// ring is darker, so neighbouring rings stay apart. Pool names sit on leader lines.

const PITCH = 6, CELL = 5;
const GOLD = [[251, 204, 92], [234, 180, 72], [205, 158, 62]], LO = [140, 110, 53], DARK = [20, 16, 6];
const SILVER_LO = [110, 116, 124], SILVER_HI = [196, 202, 210];
const HOLE = 0.42; // inner radius as a share of the outer one
const MIN_LABEL = 0.025; // pools under 2.5% of blocks get no label (hover still names them)
const SVG = 'http://www.w3.org/2000/svg';

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function svgEl(tag, attrs, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function ringColour(slice, index, band, bandIndex) {
  const step = slice.bands.length > 1 ? bandIndex / (slice.bands.length - 1) : 1; // 0 inside .. 1 rim
  const gold = GOLD[index % 3];
  const rgb = band.datum === false ? mix(SILVER_LO, SILVER_HI, step) : mix(mix(gold, LO, 0.6), gold, step);
  return bandIndex % 2 === 1 ? mix(rgb, DARK, 0.28) : rgb;
}

function drawLeds(canvas, model, size) {
  const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  g.scale(ratio, ratio);
  const n = (size + 1) / PITCH, c = size / 2, R = c - 1, r0 = R * HOLE;
  model.slices.forEach((s, i) => { s.index = i; });
  for (let row = 0; row < n; row++) {
    const fade = row / (n - 1);
    g.globalAlpha = Math.max(0.35, 0.95 - fade * 0.45);
    for (let col = 0; col < n; col++) {
      const x = col * PITCH + CELL / 2 - c, y = row * PITCH + CELL / 2 - c, d = Math.hypot(x, y);
      if (d < r0 || d > R) continue;
      const angle = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);
      const hit = locate(model, angle, (d * d - r0 * r0) / (R * R - r0 * r0));
      if (!hit) continue;
      const { slice, band } = hit;
      // Unlit LEDs between slices wide enough to show the gap.
      if ((slice.a1 - slice.a0) * R >= 12 && Math.min(angle - slice.a0, slice.a1 - angle) * d < 2.6) continue;
      const rgb = ringColour(slice, slice.index, band, slice.bands.indexOf(band));
      g.fillStyle = `rgb(${mix(rgb, LO, fade * 0.55)})`;
      g.fillRect(col * PITCH, row * PITCH, CELL, CELL);
    }
  }
}

// Leader-line labels, left and right of the pie, pushed apart so they never overlap.
function drawLabels(svg, model, size, side, maxLabels, charWidth) {
  const c = size / 2, R = c - 1, cy = 10 + c, cx = side + c;
  const maxChars = Math.max(6, Math.floor((side - 14) / charWidth));
  const fit = (name) => (name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name);
  const left = [], right = [];
  model.slices.filter((s) => s.blocks / model.total >= MIN_LABEL).slice(0, maxLabels).forEach((s) => {
    const mid = (s.a0 + s.a1) / 2;
    const label = { s, px: cx + Math.sin(mid) * (R + 2), py: cy - Math.cos(mid) * (R + 2), y: cy - Math.cos(mid) * (R + 16) };
    (Math.sin(mid) >= 0 ? right : left).push(label);
  });
  const nodes = [];
  for (const labels of [left, right]) {
    const isRight = labels === right;
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
    const overflow = (labels.at(-1)?.y ?? 0) - (size + 14);
    if (overflow > 0) labels.forEach((l) => { l.y -= overflow; });
    const lineX = isRight ? side + size + 8 : side - 8;
    for (const l of labels) {
      const elbowX = isRight ? Math.max(l.px + 6, side + size - 4) : Math.min(l.px - 6, side + 4);
      nodes.push(svgEl('polyline', { points: `${l.px},${l.py} ${elbowX},${l.y} ${lineX},${l.y}`, class: 'pie-leader' }));
      nodes.push(svgEl('text', { x: isRight ? lineX + 4 : lineX - 4, y: l.y + 4, 'text-anchor': isRight ? 'start' : 'end' }, fit(l.s.name)));
    }
  }
  svg.replaceChildren(...nodes);
}

// Draw (or redraw) the pie for `points` into `root` (the .pool-pie element).
// Size the stage for the pie's width: the ring in whole LEDs plus room for labels each side.
function layout(root) {
  const stage = root.querySelector('.pie-stage');
  const narrow = root.clientWidth < 440;
  const side = narrow ? 74 : 112; // room for the labels on each side
  const size = Math.max(119, Math.min(301, Math.floor((root.clientWidth - 2 * side + 1) / PITCH) * PITCH - 1));
  stage.style.width = `${size + 2 * side}px`;
  stage.style.height = `${size + 20}px`;
  const canvas = stage.querySelector('canvas');
  canvas.style.left = `${side}px`;
  return { stage, canvas, narrow, side, size };
}

// Before the first data: the pie's full size as a dim, unlit ring, so the card doesn't
// grow (and push the page down) when the pools arrive.
export function reservePoolPie(root) {
  root.hidden = false;
  const { stage, canvas, size } = layout(root);
  const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  g.scale(ratio, ratio);
  g.fillStyle = 'rgba(255, 255, 255, 0.06)';
  const n = (size + 1) / PITCH, c = size / 2, R = c - 1, r0 = R * HOLE;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const d = Math.hypot(col * PITCH + CELL / 2 - c, row * PITCH + CELL / 2 - c);
      if (d >= r0 && d <= R) g.fillRect(col * PITCH, row * PITCH, CELL, CELL);
    }
  }
  stage.querySelector('svg').replaceChildren();
  stage.querySelector('.pie-centre').style.fontSize = `${Math.max(11, Math.round(size / 15))}px`;
  stage.querySelector('.pie-centre strong').textContent = '—';
  root.pie = null;
}

export function drawPoolPie(root, points, rangeText) {
  const model = pieModel(points);
  root.hidden = model.total === 0;
  if (root.hidden) return;
  const { stage, canvas, narrow, side, size } = layout(root);
  drawLeds(canvas, model, size);
  drawLabels(stage.querySelector('svg'), model, size, side, narrow ? 5 : 12, narrow ? 5.8 : 6.6); // label font: 11 px / 12 px
  // Centre text scales with the hole (20 px at full size).
  stage.querySelector('.pie-centre').style.fontSize = `${Math.max(11, Math.round(size / 15))}px`;

  const pct = model.datumPct;
  stage.querySelector('.pie-centre strong').textContent = pct == null ? 'n/a' : f.fmtPct(pct, 1);
  root.querySelector('.pie-key').hidden = pct == null;
  root.querySelector('.pie-summary').textContent = pct == null
    ? `Pie chart of the ${f.fmtInt(model.total)} blocks in the ${rangeText} by pool. DATUM data is unavailable right now.`
    : `Pie chart: miners built ${f.fmtPct(pct, 1)} of the ${f.fmtInt(model.total)} blocks in the ${rangeText} with DATUM; pools built the rest (Stratum).`;
  root.pie = { model, size, side };
}

function tipFor(slice, band) {
  const head = `${slice.name} · ${f.fmtInt(slice.blocks)} ${slice.blocks === 1 ? 'block' : 'blocks'}`
    + (slice.datumPct == null ? '' : ` · ${f.fmtPct(slice.datumPct, 0)} DATUM`);
  if (band.datum == null) return [head];
  const blocks = `${f.fmtInt(band.blocks)} ${band.blocks === 1 ? 'block' : 'blocks'}`;
  return [head, `${band.label} · ${blocks} · ${band.datum ? 'DATUM' : 'Stratum'}`];
}

// Hover (or touch) a ring: tooltip with the pool and that ring.
export function initPoolPie(root) {
  const stage = root.querySelector('.pie-stage');
  const canvas = stage.querySelector('canvas'), tip = stage.querySelector('.pie-tip');
  const hide = () => { tip.hidden = true; };
  canvas.addEventListener('pointermove', (e) => {
    if (!root.pie) return hide();
    const { model, size } = root.pie;
    const c = size / 2, R = c - 1, r0 = R * HOLE;
    const x = e.offsetX - c, y = e.offsetY - c, d = Math.hypot(x, y);
    const hit = d < r0 ? null : locate(model, Math.atan2(x, -y), (d * d - r0 * r0) / (R * R - r0 * r0));
    if (!hit) return hide();
    tip.replaceChildren(...tipFor(hit.slice, hit.band).map((line) => {
      const span = document.createElement('span');
      span.textContent = line;
      return span;
    }));
    tip.hidden = false;
    const left = Math.min(canvas.offsetLeft + e.offsetX + 12, stage.clientWidth - tip.offsetWidth);
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${canvas.offsetTop + e.offsetY + 14}px`;
  });
  canvas.addEventListener('pointerleave', hide);
}
