import { getHistory } from './api.js';
import { el, showTop } from './dom.js';
import { loadPref, savePref } from './prefs.js';
import { ledBar } from './leds.js';
import * as f from './format.js';
import { drawPoolPie, initPoolPie, reservePoolPie } from './pool-pie.js';

const TOP = 10;
const RANGES = { '1d': 'last 24 hours', '7d': 'last 7 days', '1m': 'last 30 days' };

// Mining pools card: 24H/7D/30D tabs switch both the bar list ("share · blocks", one-line
// summary) and the DATUM pie beside it, so the two always show the same blocks.
export function initPools(card) {
  const list = card.querySelector('#pools-week'), summary = card.querySelector('#pools-week-summary');
  const pie = card.querySelector('#pools-pie'), tabs = [...card.querySelectorAll('.tab')];
  // The last range chosen here, remembered in this browser only; else the page's default.
  const saved = loadPref('mining:pools:range', null);
  let range = tabs.some((t) => t.dataset.range === saved) ? saved
    : tabs.find((t) => t.getAttribute('aria-pressed') === 'true')?.dataset.range ?? '1d';
  for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.range === range));
  let points = [], seq = 0;

  const render = () => {
    const total = points.reduce((sum, [, blocks]) => sum + blocks, 0);
    list.replaceChildren(...points.map(([name, blocks]) => {
      const share = total > 0 ? (blocks / total) * 100 : 0;
      const item = el('li', 'pool');
      item.append(el('span', 'pool-name', name), ledBar(share), el('span', 'pool-share num', `${f.fmtPct(share, 1)} · ${f.fmtInt(blocks)}`));
      return item;
    }));
    showTop(list, TOP, 'pools');
    summary.textContent = points.length ? `${points[0][0]} found the most blocks: ${f.fmtInt(points[0][1])} of ${f.fmtInt(total)}.` : 'No pool data yet.';
    drawPoolPie(pie, points, RANGES[range]);
  };

  const load = async () => {
    for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.range === range));
    const mine = ++seq;
    try {
      const data = await getHistory('pools', range);
      if (mine !== seq) return; // a newer tab click won
      points = data.points;
      render();
    } catch {
      if (mine !== seq) return;
      points = [];
      list.replaceChildren();
      showTop(list, TOP, 'pools');
      pie.hidden = true;
      summary.textContent = 'Pool data is unavailable right now.';
    }
  };

  for (const t of tabs) t.addEventListener('click', () => { if (t.dataset.range !== range) { range = t.dataset.range; savePref('mining:pools:range', range); load(); } });
  initPoolPie(pie);
  // Until the first pools arrive: the card at its loaded size (dim rows, unlit pie; the page
  // HTML holds the same rows and a hidden "Show all"), so nothing below moves when they do.
  list.replaceChildren(...Array.from({ length: TOP }, () => {
    const item = el('li', 'pool');
    item.append(el('span', 'pool-name', '—'), ledBar(0), el('span', 'pool-share num', '—'));
    return item;
  }));
  reservePoolPie(pie);
  // Redraw the pie when the card changes width (window resize, turning a phone).
  let width = 0;
  new ResizeObserver(() => {
    if (pie.clientWidth !== width) { width = pie.clientWidth; if (points.length) drawPoolPie(pie, points, RANGES[range]); else if (!pie.hidden) reservePoolPie(pie); }
  }).observe(card);
  load();
}
