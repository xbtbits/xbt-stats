import { getNodes, getSnapshot } from './api.js';
import { loadPref, savePref } from './prefs.js';
import * as f from './format.js';
import { el, setText, notice, showTop } from './dom.js';
import { ledBar, setLeds } from './leds.js';
import { lineChart } from './chart-common.js';
import { summarize } from './summary.js';
import { sliceHistory, windowProgress, syncShares, shareOf, NODE_RANGES } from './nodes-calc.js';

const GREEN = '#6cc04a';
const KNOWN = 'rgba(250, 250, 250, 0.6)';
const REFRESH_MS = 10 * 60_000;

let nodes = null;
let height = null; // current chain height from /api/snapshot, for the window progress
let lastFetch = 0;
const savedRange = loadPref('nodes:range', 'all');
let range = NODE_RANGES.includes(savedRange) ? savedRange : 'all';
let chart = null;

const pctText = (n) => f.fmtPct(n, 1);

function renderCounters(n) {
  setText('nodes.reachable', f.fmtInt(n.reachable));
  setText('nodes.known', f.fmtInt(n.known));
  setText('nodes.stable', f.fmtInt(n.stable?.count));
  setText('nodes.enforcingPct', pctText(shareOf(n.softFork.enforcing, n.reachable)));
  const stable = document.querySelector('[data-k="nodes.stable"]');
  if (n.stable) {
    stable.title = `Reachable at least ${n.stable.thresholdPct}% of the time over ${n.stable.window} (${f.fmtInt(n.stable.count)} of ${f.fmtInt(n.stable.observed)} observed)`;
  } else stable.removeAttribute('title');
}

function renderSync(sync) {
  const shares = syncShares(sync);
  for (const s of shares) setText(`sync.${s.key}`, f.fmtInt(s.count));
  setLeds(document.getElementById('sync-bar'), shares.map((s) => ({ pct: s.pct, cls: s.key })));
  document.getElementById('sync-bar').setAttribute('aria-label',
    `Sync status: ${shares.map((s) => `${f.fmtInt(s.count)} ${s.label.toLowerCase()}`).join(', ')}`);
}

function renderFork(n) {
  const sf = n.softFork;
  setText('fork.window', `${f.fmtInt(sf.startHeight)} → ${f.fmtInt(sf.endHeight)}`);
  const share = shareOf(sf.enforcing, n.reachable);
  setText('fork.enforcing', share == null ? f.fmtInt(sf.enforcing) : `${f.fmtInt(sf.enforcing)} (${pctText(share)})`);
  setText('fork.notEnforcing', f.fmtInt(sf.notEnforcing));
  const p = windowProgress(height, sf.startHeight, sf.endHeight);
  setText('fork.progress', pctText(p.pct));
  setText('fork.remaining', p.complete ? 'Complete' : f.fmtInt(p.remaining));
  const bar = document.getElementById('fork-progress');
  setLeds(bar, [{ pct: p.pct ?? 0 }]);
  if (p.pct == null) bar.removeAttribute('aria-valuenow');
  else bar.setAttribute('aria-valuenow', String(Math.round(p.pct * 10) / 10));
}

const TOP_VERSIONS = 5;

function renderVersions(versions) {
  const total = versions.reduce((sum, v) => sum + v.count, 0);
  document.getElementById('versions').replaceChildren(...versions.map((v) => {
    const share = shareOf(v.count, total) ?? 0;
    const name = el('span', 'pool-name', v.ua);
    if (v.raw) name.title = v.raw;
    const label = el('span', 'version-label');
    label.append(name);
    if (v.enforcing) label.append(el('span', 'tag-enforcing', 'Coinbase lock'));
    const item = el('li', 'pool');
    item.append(label, el('span', 'pool-share num', `${f.fmtInt(v.count)} · ${pctText(share)}`), ledBar(share));
    return item;
  }));
  showTop(document.getElementById('versions'), TOP_VERSIONS, 'versions');
}

function drawChart() {
  const section = document.getElementById('nodes-chart');
  const plot = section.querySelector('.plot');
  const summary = section.querySelector('.chart-summary');
  for (const b of section.querySelectorAll('[data-range]')) b.setAttribute('aria-pressed', String(b.dataset.range === range));
  chart?.destroy();
  chart = null;
  plot.replaceChildren();
  const pts = sliceHistory(nodes?.history ?? [], range);
  if (pts.length < 2) plot.append(el('p', 'chart-empty', 'Not enough history yet.'));
  else {
    chart = lineChart(plot, pts.map((p) => [p[0], p[1]]), {
      label: 'Reachable', format: (v) => `Reachable ${f.fmtInt(v)}`, axisFormat: f.fmtInt, changeFormat: f.fmtInt,
      extras: [
        { label: 'Coinbase lock', stroke: GREEN, width: 1.75, values: pts.map((p) => p[3]), format: f.fmtInt },
        { label: 'Known', stroke: KNOWN, dash: [5, 4], values: pts.map((p) => p[2]), format: f.fmtInt },
      ],
    });
  }
  summary.textContent = summarize('Reachable nodes', pts.map((p) => [p[0], p[1]]), f.fmtInt);
}

function render() {
  if (!nodes) return;
  renderCounters(nodes);
  renderSync(nodes.sync);
  renderFork(nodes);
  renderVersions(nodes.versions);
  drawChart();
  renderClock();
}

function renderClock() {
  setText('nodes.updated', nodes ? f.fmtAgo(Date.now() - nodes.updatedAt) : '—');
}

async function refresh() {
  lastFetch = Date.now();
  const [n, s] = await Promise.allSettled([getNodes(), getSnapshot()]);
  if (s.status === 'fulfilled' && typeof s.value?.chain?.height === 'number') height = s.value.chain.height;
  if (n.status === 'fulfilled') {
    nodes = n.value;
    notice('offline', false, '');
  } else {
    notice('offline', true, nodes
      ? 'Can’t reach the server right now. Showing the last data received.'
      : 'Node data is unavailable right now.');
  }
  render();
}

for (const b of document.querySelectorAll('#nodes-chart [data-range]')) {
  b.setAttribute('aria-pressed', String(b.dataset.range === range)); // the remembered range at once, not ALL until the census arrives
  b.addEventListener('click', () => { range = b.dataset.range; savePref('nodes:range', range); drawChart(); });
}

// Until the first census: dim version rows at their loaded size, so the cards below the
// chart don't jump when it arrives.
function renderPlaceholders() {
  const list = document.getElementById('versions');
  list.replaceChildren(...Array.from({ length: TOP_VERSIONS }, () => {
    const item = el('li', 'pool');
    item.append(el('span', 'version-label', '—'), el('span', 'pool-share num', '—'), ledBar(0));
    return item;
  }));
}
renderPlaceholders();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
setInterval(() => { if (nodes) renderClock(); }, 30_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastFetch >= REFRESH_MS) refresh();
});
