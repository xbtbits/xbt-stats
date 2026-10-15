import { getSnapshot } from './api.js';
import * as f from './format.js';
import * as m from './mining-math.js';
import { formatXbt } from './convert-math.js';
import { notice, setText, el } from './dom.js';
import { initPools } from './pools.js';

const DASH = '—';
const $ = (id) => document.getElementById(id);
const inputs = { hash: $('in-hash'), unit: $('in-unit'), power: $('in-power'), kwh: $('in-kwh'), fee: $('in-fee') };
const msg = $('mining-msg');
const body = $('earn-body');

let snapshot = null;
let net = null;
let offline = false;

// The page HTML holds these rows (dashes) so the first paint has the table's full height;
// adopt them, or build them if they're missing.
const KEYS = ['xbt', 'revenue', 'cost', 'profit'];
const rows = body.rows.length === m.PERIODS.length ? m.PERIODS.map((p, i) => {
  const tds = body.rows[i].querySelectorAll('td');
  return { ...p, cells: Object.fromEntries(KEYS.map((k, j) => [k, tds[j]])) };
}) : m.PERIODS.map((p) => {
  const tr = el('tr');
  tr.append(el('th', null, p.label));
  tr.firstChild.scope = 'row';
  const cells = {};
  const labels = { xbt: 'XBT', revenue: 'Revenue (USD)', cost: 'Power cost', profit: 'Profit' };
  for (const k of ['xbt', 'revenue', 'cost', 'profit']) {
    cells[k] = el('td', 'num', DASH);
    cells[k].dataset.label = labels[k]; // shown as a row label on phones
    tr.append(cells[k]);
  }
  body.append(tr);
  return { ...p, cells };
});

const usd = (n) => (n == null ? DASH : f.fmtUsd(n));
const xbt = (n) => (n == null ? DASH : formatXbt(n));

function setMessage(text) {
  if (msg.textContent !== text) msg.textContent = text;
}

function readInputs() {
  return {
    hps: m.toHashesPerSecond(m.parseNumber(inputs.hash.value), inputs.unit.value),
    watts: m.parseNumber(inputs.power.value),
    kwhUsd: m.parseNumber(inputs.kwh.value),
    feePct: m.parseNumber(inputs.fee.value),
  };
}

function renderNetwork() {
  setText('net-hashrate', net ? f.fmtHashrate(net.hashrate) : DASH);
  setText('net-subsidy', net ? f.fmtXbt(net.subsidySats, 2, 8) : DASH);
  setText('net-fees', net ? f.fmtXbt(net.avgFeeSats, 2, 8) : DASH);
  setText('net-block', net ? `${f.fmtNum(net.avgBlockSeconds / 60, 1)} min` : DASH);
  setText('net-price', net ? f.fmtUsd(net.priceUsd) : DASH);
  const diff = snapshot?.difficulty?.changePct;
  const c = f.change(typeof diff === 'number' ? diff : NaN);
  for (const node of document.querySelectorAll('[data-k="net-diff"]')) {
    node.textContent = c.text;
    node.dataset.dir = c.dir;
  }
}

function daysToHalving(nowMs) {
  return net?.halvingEta ? (net.halvingEta - nowMs) / 86_400_000 : null;
}

function renderHalving(nowMs) {
  const d = daysToHalving(nowMs);
  setText('net-halving', net?.halvingHeight ? f.fmtInt(net.halvingHeight) : DASH);
  setText('net-halving-date', net?.halvingEta ? f.fmtDate(net.halvingEta) : DASH);
  setText('net-halving-in', d != null && d > 0 ? m.formatSoloTime(d) : DASH);
  setText('net-subsidy-after', net?.subsidyAfterSats != null ? f.fmtXbt(net.subsidyAfterSats, 2, 8) : DASH);
}

function render() {
  renderNetwork();
  const nowMs = Date.now();
  renderHalving(nowMs);
  const e = m.estimate(readInputs(), net);
  const toHalving = daysToHalving(nowMs);
  let spans = false;
  for (const r of rows) {
    const v = m.forPeriod(e, r.days, toHalving);
    if (v?.spansHalving) spans = true;
    r.cells.xbt.textContent = xbt(v?.xbt);
    r.cells.revenue.textContent = usd(v?.revenue);
    r.cells.cost.textContent = usd(v?.cost);
    r.cells.profit.textContent = usd(v?.profit);
    r.cells.profit.dataset.dir = v?.profit > 0 ? 'up' : v?.profit < 0 ? 'down' : 'flat';
  }
  const note = document.getElementById('halving-note');
  note.hidden = !spans;
  if (spans) {
    note.textContent = `Includes the halving (≈ ${f.fmtDate(net.halvingEta)}): the block reward drops from ${f.fmtXbt(net.subsidySats, 0, 8)} to ${f.fmtXbt(net.subsidyAfterSats, 0, 8)}, so those days earn less.`;
  }
  setText('net-share', e ? `${(e.share * 100).toPrecision(3)}%` : DASH);
  setText('net-solo', e ? m.formatSoloTime(e.soloDays) : DASH);
  if (!net) setMessage(snapshot || offline ? 'Waiting for the first network numbers.' : ''); // silent until the first answer
  else if (!e) setMessage(inputs.hash.value.trim() === '' ? '' : 'Enter a hashrate above zero, like 10.');
  else if (e.overNetwork) setMessage('More than the whole network?');
  else if (e.xbtPerDay == null) setMessage('Pool fee must be from 0 to under 100.');
  else if (e.costPerDay == null) setMessage('Enter power and electricity cost to see profit.');
  else setMessage('');
}

async function refresh() {
  try {
    snapshot = await getSnapshot();
    net = m.networkFromSnapshot(snapshot);
    offline = false;
    notice('offline', false, '');
  } catch {
    offline = true;
    notice('offline', true, 'Can’t reach the server right now. Showing the last data received.');
  }
  if (!offline || snapshot) render();
}

for (const input of Object.values(inputs)) {
  input.addEventListener('input', render);
  input.addEventListener('change', render);
}

render();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

initPools(document.querySelector('.mining-pools'));
