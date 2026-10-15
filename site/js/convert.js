import { getSnapshot, getFx, getHistory } from './api.js';
import { dailyCloses, movingAverage } from './ma.js';
import * as f from './format.js';
import * as m from './convert-math.js';
import { el, notice, setText } from './dom.js';

const FIELDS = ['xbt', 'sats', 'usd'];
const FORMAT = { xbt: m.formatXbt, sats: m.formatSats, usd: m.formatUsd };
const inputs = Object.fromEntries(FIELDS.map((k) => [k, document.getElementById(`in-${k}`)]));
const msg = document.getElementById('convert-msg');
const rate = document.getElementById('convert-rate');

let snapshot = null;
let fx = null; // { currencies, rates, source, updatedAt } from /api/fx
let fxFailed = false;
let averages = null; // { 50: number|null, 200: number|null } from the daily closes
let closeDays = 0; // how many daily closes the price history has
let offline = false;
let last = { field: 'xbt', text: '1' }; // the field the user edited last and what it holds
let started = false;

const price = () => (snapshot?.price?.usd > 0 ? snapshot.price.usd : null);

function setMessage(text) {
  if (msg.textContent !== text) msg.textContent = text;
}

// Recompute the other two fields from the last edited one.
function recompute({ reformatSource }) {
  const p = price();
  if (p == null) return;
  const src = last.field;
  const value = m.parseAmount(last.text);
  const others = FIELDS.filter((k) => k !== src);
  if (value == null) {
    for (const k of others) inputs[k].value = '';
    setMessage(last.text.trim() === '' ? '' : 'Enter a number, like 1,250.50.');
    return;
  }
  const r = m.convertFrom(src, value, p);
  if (r.error) {
    for (const k of others) inputs[k].value = '';
    setMessage(r.error);
    return;
  }
  setMessage('');
  for (const k of others) inputs[k].value = FORMAT[k](r[k]);
  if (reformatSource) inputs[src].value = FORMAT[src](value);
}

function renderRate(now) {
  const p = price();
  if (p == null) { rate.textContent = snapshot || offline ? '—' : 'Loading the live price…'; return; } // calm note until the first answer
  const ago = f.fmtAgo(now - snapshot.price.updatedAt);
  rate.textContent = `1 XBT = ${f.fmtUsd(p)} · 1 USD = ${f.fmtInt(Math.floor(1e8 / p))} sats · price updated ${ago}`;
}

// XBT in world currencies: 1 XBT in each, and whole sats per unit.
function renderWorld() {
  const body = document.getElementById('world-body');
  const source = document.getElementById('world-source');
  if (!fx) {
    // While loading: dim rows for the 18 currencies, so the card doesn't grow when they land.
    body.replaceChildren(...(fxFailed ? [] : Array.from({ length: 18 }, () => {
      const row = el('tr');
      const head = el('th', null, '—');
      head.scope = 'row';
      row.append(head, el('td', 'num', '—'), el('td', 'num', '—'));
      return row;
    })));
    source.textContent = fxFailed ? 'Exchange rates are unavailable right now.' : 'Loading exchange rates…';
    return;
  }
  const p = price();
  body.replaceChildren(...fx.currencies.map(({ code, name }) => {
    const rate = fx.rates[code];
    const row = el('tr');
    const head = el('th');
    head.scope = 'row';
    head.append(el('span', 'world-name', name), ' ', el('span', 'world-code', code));
    const sats = m.satsPerUnit(p, rate);
    // Michroma's € looks like a zero, so currency symbols use the body font.
    const value = el('td', 'num');
    const parts = p == null ? null : m.fiatParts(p * rate, code);
    if (!parts) value.textContent = '—';
    else value.append(...parts.map(([kind, text]) => (kind === 'symbol' ? el('span', 'fiat-sym', text) : text)));
    row.append(head, value, el('td', 'num', sats == null ? '—' : f.fmtInt(sats)));
    return row;
  }));
  const link = el('a', null, fx.source.name);
  link.href = fx.source.url;
  link.rel = 'noopener noreferrer';
  source.replaceChildren(`Converted from the live USD price at today’s exchange rates. Rates by `, link, ` · updated ${f.fmtDate(fx.updatedAt)}.`);
}

// Exchanges: every market the site watches, busiest first. Only Neoxa's link out.
function renderMarkets() {
  const markets = snapshot?.price?.markets ?? [];
  const body = document.getElementById('markets-body');
  const note = document.getElementById('markets-note');
  const two = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!snapshot) {
    // While loading: the markets the site watches, with dashes, so the card keeps its size.
    body.replaceChildren(...['NonKYC BTCB2/USDT', 'Neoxa XBT/USDC', 'Neoxa XBT/USDT'].map((label) => {
      // Real-width stand-ins, invisible: the columns (and the venue names' wrapping) come out
      // the same as with numbers, so the rows don't grow when they land.
      const head = el('th', null, label);
      head.scope = 'row';
      head.append(el('span', 'market-arrow', label.startsWith('Neoxa') ? ' ↗' : ''), el('span', 'market-mark', label.endsWith('USDT') && label.startsWith('Neoxa') ? '*' : ''));
      const ghost = (text) => el('td', 'num ghost-text', text);
      const row = el('tr');
      row.append(head, ghost('$000.00'), ghost(label.startsWith('NonKYC') ? '000.00 / 000.00' : '—'), ghost('$000.00K'));
      return row;
    }));
    return;
  }
  body.replaceChildren(...markets.map((mk) => {
    const head = el('th');
    head.scope = 'row';
    if (mk.link) {
      const a = el('a', 'market-link', mk.label);
      a.href = mk.link;
      a.rel = 'noopener noreferrer';
      a.append(el('span', 'market-arrow', ' ↗'));
      a.lastChild.setAttribute('aria-hidden', 'true');
      head.append(a);
    } else head.append(mk.label);
    if (!mk.inPrice) head.append(el('span', 'market-mark', '*'));
    const book = el('td', 'num');
    if (mk.bid != null && mk.ask != null) {
      book.append(el('span', 'book-side', two(mk.bid)), el('span', 'book-sep', ' / '), el('span', 'book-side', two(mk.ask)));
    } else {
      book.textContent = '—';
      book.classList.add('book-none'); // centred, so it can't read as a minus on the volume
    }
    const row = el('tr');
    row.append(head, el('td', 'num', f.fmtUsd(mk.price)), book, el('td', 'num', f.fmtUsdCompact(mk.volUsd)));
    return row;
  }));
  const notes = [];
  if (markets.some((mk) => mk.bid == null)) notes.push('Neoxa trades through automated pools with no order book, so it has no bid or ask.');
  if (markets.some((mk) => !mk.inPrice)) notes.push('* Shown only: too little volume to count toward the site’s price.');
  note.textContent = markets.length ? notes.join(' ') : 'No market data yet.';
}

// Moving averages of the daily closes, and the live price against them.
function renderAverages() {
  const p = price();
  for (const d of [50, 200]) {
    const avg = averages?.[d] ?? null;
    // Too young for this average yet: say when it starts instead of a bare dash.
    const wait = avg == null && closeDays > 0 && closeDays < d ? d - closeDays : 0;
    const soon = wait ? `In ${wait} ${wait === 1 ? 'day' : 'days'}` : null;
    setText(`ma.${d}`, soon ?? f.fmtUsd(avg));
    setText(`ma.ratio${d}`, soon ?? (p != null && avg > 0 ? `${(p / avg).toFixed(2)}×` : '—'));
  }
}

async function loadAverages() {
  try {
    const closes = dailyCloses((await getHistory('price', 'all')).points);
    closeDays = closes.length;
    averages = Object.fromEntries([50, 200].map((d) => [d, movingAverage(closes, d).at(-1)?.[1] ?? null]));
  } catch {
    // keep the last averages; the rows show — until the first load works
  }
  renderAverages();
}

async function loadFx() {
  try {
    fx = await getFx();
    fxFailed = false;
  } catch {
    fxFailed = fx == null; // keep showing the last good rates if a refresh fails
  }
  renderWorld();
}

function render() {
  renderWorld();
  renderMarkets();
  renderAverages();
  const p = price();
  for (const k of FIELDS) inputs[k].disabled = p == null;
  if (p == null) {
    setMessage(snapshot || offline ? 'Waiting for the first price.' : ''); // silent until the first answer
    renderRate(Date.now());
    return;
  }
  if (!started) {
    started = true;
    inputs.xbt.value = last.text;
    setMessage('');
  }
  // never rewrite the field being typed in, so the caret stays put
  recompute({ reformatSource: document.activeElement !== inputs[last.field] });
  renderRate(Date.now());
}

async function refresh() {
  try {
    snapshot = await getSnapshot();
    offline = false;
    notice('offline', false, '');
  } catch {
    offline = true;
    notice('offline', true, 'Can’t reach the server right now. Showing the last data received.');
  }
  if (!offline || snapshot) render();
}

for (const k of FIELDS) {
  inputs[k].addEventListener('input', () => {
    last = { field: k, text: inputs[k].value };
    recompute({ reformatSource: false });
  });
  inputs[k].addEventListener('blur', () => {
    if (last.field === k && price() != null) recompute({ reformatSource: true });
  });
}

renderMarkets(); // loading rows until the first snapshot
renderWorld();
refresh();
loadFx();
loadAverages();
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
setInterval(() => { if (!document.hidden) loadFx(); }, 60 * 60_000); // rates change daily
setInterval(() => { if (!document.hidden) loadAverages(); }, 15 * 60_000);
setInterval(() => { if (snapshot) renderRate(Date.now()); }, 1_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
