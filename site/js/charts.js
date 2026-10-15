import { mountRangeChart } from './chart-common.js';
import { getSnapshot } from './api.js';
import { chartHeader, HEADER_SERIES } from './chart-stats.js';
import { el } from './dom.js';
import * as f from './format.js';

const CHAIN_CHARTS = [
  { series: 'hashrate', label: 'Hashrate', format: f.fmtHashrate },
  // Difficulty only changes at retargets: drawn as steps, carried flat to today.
  { series: 'difficulty', label: 'Difficulty', format: f.fmtDifficulty, extendToNow: true, stepped: true },
  // Fees and block size jump block to block: half-bright LED fill, and thinned to the
  // screen width (neighbouring blocks averaged) so the trend shows on a phone.
  { series: 'fees', label: 'Average fees per block', format: (v) => f.fmtXbt(v, 0, 4), ledStrength: 0.5, thin: true },
  { series: 'mempool', label: 'Mempool size', format: f.fmtVsize },
  { series: 'blocksize', label: 'Block size', format: f.fmtKb, ledStrength: 0.5, thin: true },
];

for (const cfg of CHAIN_CHARTS) {
  const section = document.querySelector(`[data-series="${cfg.series}"]`);
  mountRangeChart(section, { ...cfg, changeFormat: cfg.format, defaultRange: '1m', trimAxis: true });
}

// Stat headers: label/value pairs from /api/snapshot, refreshed every 60 s while visible.
const headers = new Map(); // series -> [{ dd }]

for (const series of HEADER_SERIES) {
  const dl = document.querySelector(`[data-stats="${series}"]`);
  if (!dl) continue;
  // The page HTML already holds the labels with dashes (so the first paint has the header's
  // full height); build them only if it doesn't.
  if (dl.children.length) { headers.set(series, [...dl.querySelectorAll('dd')]); continue; }
  const cells = chartHeader(series, null, Date.now()).map((x) => {
    const dd = el('dd', 'num', x.text);
    const row = el('div');
    row.append(el('dt', '', x.label), dd);
    dl.append(row);
    return dd;
  });
  headers.set(series, cells);
}

function renderHeaders(snapshot) {
  const now = Date.now();
  for (const [series, cells] of headers) {
    chartHeader(series, snapshot, now).forEach((x, i) => {
      cells[i].textContent = x.text;
      if (x.dir) cells[i].dataset.dir = x.dir;
      else delete cells[i].dataset.dir;
    });
  }
}

async function refresh() {
  try {
    renderHeaders(await getSnapshot());
  } catch {
    // keep the last values (or dashes) on screen
  }
}

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
