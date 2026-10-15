// "What's in your block?" card: a map of the newest block drawn in the price chart's LED
// blocks (one tile per transaction, its area the transaction's share of the block's weight,
// neighbouring tiles in alternating gold shades; OP_RETURN data as a white LED), the plain
// facts beside it, and an LED bar for the data's share.
import { getBlock } from './api.js';
import * as f from './format.js';
import { squarify } from './treemap.js';

const card = document.getElementById('block-card');
const map = card.querySelector('.block-map');
const facts = card.querySelector('.block-facts');
const bar = card.querySelector('.ledbar');
const field = (k) => card.querySelector(`[data-b="${k}"]`);
const wide = window.matchMedia('(min-width: 700px)');
const INK = '#fafafa';
const SHADES = [[251, 204, 92], [234, 180, 72], [205, 158, 62]]; // alternate per transaction
const LO = [140, 110, 53]; // the chart's fade colour
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const snap = (px) => Math.max(5, Math.floor((px + 1) / 6) * 6 - 1); // whole 5 px LEDs, 1 px gaps
const body = map.parentElement;
// Beside the facts only when the card has room for both: the facts need about 250 px to keep
// each row on one line, the map at least 60 px. Otherwise the map sits above them, as on phones.
const BESIDE_MIN = 250 + 16 + 60;
const beside = () => wide.matches && body.clientWidth >= BESIDE_MIN;
// Room for the map: its grid column beside the facts, or the card width above them.
const room = () => (beside() ? body.clientWidth - facts.offsetWidth - 16 : body.clientWidth);
let block = null;

function drawMap() {
  body.classList.toggle('beside', beside());
  const W = snap(room());
  // Beside the facts the map is as tall as they are; above them it is a wide rectangle.
  const H = snap(beside() ? facts.offsetHeight : W * (wide.matches ? 0.4 : 0.62)); // flatter above the facts on a computer
  const nx = (W + 1) / 6, ny = (H + 1) / 6;
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  map.style.width = `${W}px`;
  map.style.height = `${H}px`;
  map.width = W * dpr;
  map.height = H * dpr;
  map.dataset.leds = String(nx * ny);
  map.dataset.dataLeds = '0';
  const g = map.getContext('2d');
  g.scale(dpr, dpr);
  if (!block) return;
  const weights = block.weights;
  const total = weights.reduce((sum, x) => sum + x, 0);
  const data = new Set(block.opReturn.txs);
  const areas = weights.map((wt, t) => ({ t, area: (wt / total) * W * H })).sort((a, b) => b.area - a.area);
  const tiles = squarify(areas, W, H);
  // Each LED takes the tile under its centre; tiny transactions smaller than one LED merge
  // into their neighbours, so the map is true to size at LED resolution.
  const owner = new Int32Array(nx * ny).fill(-1);
  tiles.forEach((r, k) => {
    const x0 = Math.max(0, Math.ceil((r.x - 2.5) / 6)), x1 = Math.min(nx - 1, Math.ceil((r.x + r.w - 2.5) / 6) - 1);
    const y0 = Math.max(0, Math.ceil((r.y - 2.5) / 6)), y1 = Math.min(ny - 1, Math.ceil((r.y + r.h - 2.5) / 6) - 1);
    for (let cy = y0; cy <= y1; cy += 1) for (let cx = x0; cx <= x1; cx += 1) owner[cy * nx + cx] = k;
  });
  // A data transaction lights the LED nearest its tile's centre in white.
  const white = new Set();
  tiles.forEach((r) => {
    if (!data.has(r.t)) return;
    const cx = Math.min(nx - 1, Math.floor((r.x + r.w / 2) / 6)), cy = Math.min(ny - 1, Math.floor((r.y + r.h / 2) / 6));
    white.add(cy * nx + cx);
  });
  map.dataset.dataLeds = String(white.size);
  for (let cy = 0; cy < ny; cy += 1) {
    const fade = ny > 1 ? cy / (ny - 1) : 0; // the chart's top-to-bottom fade
    g.globalAlpha = Math.max(0.35, 0.95 - fade * 0.45);
    for (let cx = 0; cx < nx; cx += 1) {
      const k = owner[cy * nx + cx];
      if (k < 0) continue;
      g.fillStyle = `rgb(${mix(SHADES[k % 3], LO, fade * 0.55)})`;
      g.fillRect(cx * 6, cy * 6, 5, 5);
    }
  }
  g.globalAlpha = 1;
  g.fillStyle = INK;
  g.shadowColor = 'rgba(255, 255, 255, 0.95)';
  g.shadowBlur = 5;
  for (const i of white) g.fillRect((i % nx) * 6, Math.floor(i / nx) * 6, 5, 5);
  g.shadowBlur = 0;
}

// As many of the price chart's LED blocks as fit (5 px squares, 1 px gaps), each an equal
// share of the block: whole data blocks in white, any remainder as a thin white mark.
function renderBar(share) {
  bar.replaceChildren();
  const n = Math.max(1, Math.floor((bar.clientWidth + 1) / 6));
  const whole = share > 0 ? Math.min(n, Math.floor((share / 100) * n)) : 0;
  for (let i = 0; i < n; i += 1) {
    const b = document.createElement('i');
    if (i >= n - whole) b.className = 'd';
    bar.append(b);
  }
  if (share > 0 && whole < n && (share / 100) * n > whole) {
    const tick = document.createElement('span');
    tick.className = 'tick';
    bar.children[n - 1 - whole].append(tick);
  }
}

function renderAge() {
  field('age').textContent = block ? f.fmtAgo(Date.now() - block.time * 1000) : '—';
}

function render() {
  const b = block;
  const share = b ? (b.opReturn.bytes / b.size) * 100 : null;
  field('title').textContent = b ? `Block ${f.fmtInt(b.height)}` : 'Block —';
  field('txs').textContent = b ? f.fmtInt(b.txCount) : '—';
  field('opReturn').textContent = b ? `${f.fmtInt(b.opReturn.outputs)} · ${f.fmtInt(b.opReturn.bytes)} B` : '—';
  field('share').textContent = f.fmtPct(share);
  field('envelopes').textContent = b ? f.fmtInt(b.envelopes) : '—';
  renderAge();
  renderBar(share ?? 0);
  map.dataset.tiles = b ? String(b.weights.length) : '0';
  map.dataset.dataTiles = b ? String(b.opReturn.txs.length) : '0';
  map.setAttribute('aria-label', b
    ? `Block ${f.fmtInt(b.height)}: ${f.fmtInt(b.txCount)} transactions, ${f.fmtInt(b.opReturn.txs.length)} with an OP_RETURN data output. Each tile is one transaction, sized by its share of the block.`
    : 'Latest block unavailable');
  drawMap();
}

async function refresh() {
  try {
    const next = await getBlock();
    if (next?.id !== block?.id) {
      block = Array.isArray(next?.weights) && next.weights.length === next.txCount ? next : null;
      render();
    }
  } catch {
    if (!block) render(); // keep the last block on a failed refresh; dashes until the first one loads
  }
}

// Redraw when the card changes size (window resize, turning a phone, fonts loading).
let lastSize = '';
new ResizeObserver(() => {
  const size = `${body.clientWidth}x${facts.offsetHeight}x${wide.matches}`;
  if (size !== lastSize) { lastSize = size; drawMap(); renderBar(block ? (block.opReturn.bytes / block.size) * 100 : 0); }
}).observe(card);

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
setInterval(renderAge, 15_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
