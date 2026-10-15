import { getSnapshot } from './api.js';
import * as f from './format.js';
import { el, setText, setChange, notice } from './dom.js';
import { ledBar } from './leds.js';
import { mountRangeChart } from './chart-common.js';
import { sourceStatus } from './status.js';

const TEXT = {
  'price.usd': (s) => f.fmtUsd(s.price?.usd),
  'price.high24h': (s) => f.fmtUsd(s.price?.high24h),
  'price.low24h': (s) => f.fmtUsd(s.price?.low24h),
  'price.volBase24h': (s) => (s.price ? `${f.fmtNum(s.price.volBase24h, 0)} XBT` : '—'),
  'price.volUsd24h': (s) => f.fmtUsdCompact(s.price?.volUsd24h),
  'price.marketCap': (s) => f.fmtUsdCompact(s.price?.marketCapUsd),
  'price.ath': (s) => f.fmtUsd(s.price?.ath?.usd),
  // Whole sats one dollar buys (floored: 117,372.68 shows as 117,372).
  'price.satsPerUsd': (s) => (s.price?.usd > 0 ? f.fmtInt(Math.floor(1e8 / s.price.usd)) : '—'),
  'price.sources': (s) => {
    if (!s.price) return 'No price recorded yet';
    const withPrices = s.flags?.marketsDisagree;
    return `USD via ${s.price.venues.map((v) => (withPrices ? `${v.label} (${f.fmtUsd(v.price)})` : v.label)).join(', ')}`;
  },
  'chain.height': (s) => f.fmtInt(s.chain?.height),
  'chain.avgBlockTime': (s) => f.fmtClock(s.chain?.avgBlockSeconds),
  'chain.supply': (s) => f.fmtXbt(s.chain?.supplySats),
  'chain.percentIssued': (s) => f.fmtPct(s.chain?.percentIssued),
  'difficulty.difficulty': (s) => f.fmtDifficulty(s.difficulty?.difficulty),
  'difficulty.epoch': (s) => f.fmtInt(s.difficulty?.epoch),
  'difficulty.blocksToRetarget': (s) => f.fmtInt(s.difficulty?.blocksToRetarget),
  'difficulty.retargetDate': (s) => f.fmtDate(s.difficulty?.retargetEta),
  'mining.hashrate': (s) => f.fmtHashrate(s.mining?.hashrate),
  'mining.subsidy': (s) => f.fmtXbt(s.mining?.subsidySats, 0, 8),
  'mining.blocks24h': (s) => f.fmtInt(s.mining?.blocks24h),
  'mining.tx144': (s) => f.fmtInt(s.mining?.tx144),
  'mining.fees144': (s) => f.fmtXbt(s.mining?.fees144Sats, 0, 4),
  'mining.feesPct': (s) => f.fmtPct(s.mining?.feesPctOfReward),
  'fees.fastest': (s) => f.fmtSatVb(s.fees?.fastest),
  'fees.halfHour': (s) => f.fmtSatVb(s.fees?.halfHour),
  'fees.hour': (s) => f.fmtSatVb(s.fees?.hour),
  'mempool.count': (s) => f.fmtInt(s.mempool?.count),
  'mempool.vsize': (s) => f.fmtVsize(s.mempool?.vsize),
  'mempool.blocksToClear': (s) => f.fmtInt(s.mempool?.blocksToClear),
  'halving.height': (s) => f.fmtInt(s.halving?.height),
  'halving.blocksLeft': (s) => f.fmtInt(s.halving?.blocksLeft),
  'halving.date': (s) => f.fmtDate(s.halving?.eta),
  'halving.progress': (s) => f.fmtPct(s.halving?.epochProgress),
  'halving.subsidyAfter': (s) => f.fmtXbt(s.halving?.subsidyAfterSats, 0, 8),
  'supply.remaining': (s) => f.fmtXbt(s.supply?.remainingSats),
};

const CHANGES = {
  'difficulty.change': (s) => s.difficulty?.changePct,
  'difficulty.lastChange': (s) => s.difficulty?.lastChangePct,
};

// Change line under the price follows the selected chart range: 1D uses the 24h change
// from the snapshot; other ranges compare the current price with the range's first point.
const PERIOD_LABEL = { '1h': '1H', '1d': '24H', '7d': '7D', '1m': '1M', '3m': '3M', ytd: 'YTD', '1y': '1Y', '5y': '5Y', all: 'ALL' };
let chartRange = { range: '1d', first: null };

function renderChangeLine(s) {
  const usd = s?.price?.usd;
  let abs = null;
  let pct = null;
  let period = '24H';
  if (typeof usd === 'number') {
    if (chartRange.range !== '1d' && chartRange.first > 0) {
      abs = usd - chartRange.first;
      pct = (abs / chartRange.first) * 100;
      period = PERIOD_LABEL[chartRange.range] ?? chartRange.range.toUpperCase();
    } else {
      const p = s.price.changePct24h;
      if (typeof p === 'number' && 100 + p !== 0) { pct = p; abs = (usd * p) / (100 + p); }
    }
  }
  const c = f.changeLine(abs, pct);
  for (const node of document.querySelectorAll('[data-k="price.changeLine"]')) {
    node.textContent = c.text;
    node.dataset.dir = c.dir;
  }
  setText('price.changePeriod', period);
}

function renderAthTitle(s) {
  const text = f.athTitle(s.price?.ath?.at, s.price?.historySince);
  for (const node of document.querySelectorAll('[data-k="price.ath"]')) {
    if (text) node.title = text;
    else node.removeAttribute('title');
  }
}

function renderPools(pools) {
  const list = document.getElementById('pools');
  list.replaceChildren();
  for (const p of pools ?? []) {
    const item = el('li', 'pool');
    item.append(el('span', 'pool-name', p.name), ledBar(p.share), el('span', 'pool-share num', `${f.fmtPct(p.share, 1)} · ${f.fmtInt(p.blocks)}`));
    list.append(item);
  }
}

// Every table value uses the number font; `right` aligns it right (numbers),
// otherwise left (dates, percentages that start a row).
function renderRows(id, rows) {
  const body = document.getElementById(id);
  body.replaceChildren();
  for (const cells of rows) {
    const tr = el('tr');
    cells.forEach(([text, right]) => tr.append(el('td', right ? 'num' : 'num left', text)));
    body.append(tr);
  }
}

function render(s) {
  for (const [key, fn] of Object.entries(TEXT)) setText(key, fn(s));
  for (const [key, fn] of Object.entries(CHANGES)) setChange(key, fn(s));
  renderChangeLine(s);
  renderAthTitle(s);
  renderPools(s.pools);
  renderRows('future-halvings', (s.halving?.future ?? []).map((h) => [
    [f.fmtInt(h.height), true], [f.fmtDate(h.eta), false], [f.fmtXbt(h.subsidyAfterSats, 0, 8).replace(' XBT', ''), true], // unit is in the header
  ]));
  renderRows('milestones', (s.supply?.milestones ?? []).map((m) => [
    [`${m.pct}%`, false], [m.reached ? 'Reached' : f.fmtDate(m.eta), false], [f.fmtInt(m.height), true],
  ]));
  notice('disagree', s.flags?.sourcesDisagree === true,
    `Sources disagree: ${s.sources?.chain?.name} at block ${f.fmtInt(s.chain?.height)}, ${s.sources?.crossCheck?.name} at block ${f.fmtInt(s.sources?.crossCheck?.tip)}.`);
  notice('markets', s.flags?.marketsDisagree === true,
    'Exchanges disagree by more than 10%. The headline price uses the market with the most volume.');
  if (s.price) document.title = `${f.fmtUsd(s.price.usd)} · XBT Stats`;
}

function renderClock(s, now) {
  const chain = s.sources?.chain;
  setText('chain.sinceLastBlock', s.chain ? f.fmtClock(now / 1000 - s.chain.tipTime) : '—');
  setText('price.updated', s.price ? f.fmtAgo(now - s.price.updatedAt) : '—');
  const st = sourceStatus(s, now, offline);
  notice('stale-chain', st.chainStale,
    chain ? `Chain data last updated ${f.fmtAgo(st.chainAge)}. The explorers may be down.` : 'Chain data is not available yet. The explorers may be down.');
  notice('stale-price', st.priceStale, `Price last updated ${f.fmtAgo(st.priceAge)}.`);
}

let snapshot = null;
let offline = false;

async function refresh() {
  try {
    snapshot = await getSnapshot();
    render(snapshot);
    offline = false;
    notice('offline', false, '');
  } catch {
    offline = true;
    notice('offline', true, 'Can’t reach the server right now. Showing the last data received.');
  }
  if (snapshot) renderClock(snapshot, Date.now());
}

document.getElementById('price-chart').addEventListener('rangeloaded', (e) => {
  const { range, points } = e.detail;
  chartRange = { range, first: points.length ? points[0][1] : null };
  if (snapshot) renderChangeLine(snapshot);
});

// Until the first snapshot: dim rows at the size the loaded lists and tables will have, so
// the cards don't grow (and push the page down) when the numbers arrive.
function renderPlaceholders() {
  document.getElementById('pools').replaceChildren(...Array.from({ length: 9 }, () => { // top 8 + Other
    const item = el('li', 'pool');
    item.append(el('span', 'pool-name', '—'), ledBar(0), el('span', 'pool-share num', '—'));
    return item;
  }));
  renderRows('future-halvings', Array.from({ length: 6 }, () => [['—', true], ['—', false], ['—', true]]));
  renderRows('milestones', Array.from({ length: 4 }, () => [['—', false], ['—', false], ['—', true]]));
}
renderPlaceholders();

mountRangeChart(document.getElementById('price-chart'), {
  series: 'price', label: 'XBT price', format: f.fmtUsd, axisFormat: f.fmtAxisPrice, defaultRange: '1d', noteOnAll: true,
});

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
setInterval(() => { if (snapshot) renderClock(snapshot, Date.now()); }, 1_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
