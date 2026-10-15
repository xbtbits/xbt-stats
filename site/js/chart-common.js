import { getHistory } from './api.js';
import { loadPref, savePref } from './prefs.js';
import { summarize } from './summary.js';
import { el } from './dom.js';
import { labelsClearOfTag, logSplits } from './axis.js';
import { dailyCloses, movingAverage, maAt, bucketAverage, trimZeros } from './ma.js';
import { fmtDate, fmtDateTime, changeLine } from './format.js';
import { drawLedFill } from './led-fill.js';

const GOLD = '#eab448';
const GRID = 'rgba(255, 255, 255, 0.08)';
const INK = 'rgba(255, 255, 255, 0.68)';
const FONT = '12px "Plus Jakarta Sans", system-ui, sans-serif';
const AXIS_GAP = 15; // value axis: tick (10) + gap (5) before the label
const TAG_OVERHANG = 10; // most px the value tag may extend into the card padding beside the chart
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, font) { measureCtx.font = font; return measureCtx.measureText(text).width; }
const LOG_PAD = 1.15; // log range = data min / 1.15 .. max * 1.15
const TIP_GAP = 12;
const FINGER_GAP = 36; // px between a fingertip and the tooltip above it

// Hover tooltip: value, change from the first point of the loaded range, one line per
// extra series (moving averages, other counts), and date.
function makeTooltip(container, { format, changeFormat, first, extras = [] }) {
  const tip = el('div', 'chart-tip');
  const value = el('div', 'chart-tip-value num');
  const delta = el('div', 'chart-tip-change num');
  const when = el('div', 'chart-tip-date');
  const extraLines = extras.map(() => el('div', 'chart-tip-ma num'));
  tip.append(value, delta, ...extraLines, when);
  tip.hidden = true;
  container.append(tip);

  let above = false; // touch: sit above the finger instead of below the cursor
  function hide() { tip.hidden = true; }
  function setAbove(v) { above = v; }

  function update(u) {
    const i = u.cursor.idx;
    const x = i == null ? null : u.data[0][i];
    const y = i == null ? null : u.data[1][i];
    if (i == null || y == null || u.cursor.left == null || u.cursor.left < 0) { hide(); return; }
    value.textContent = format(y);
    const c = changeLine(y - first, first ? ((y - first) / first) * 100 : NaN, changeFormat);
    delta.textContent = c.text;
    delta.dataset.dir = c.dir;
    extras.forEach((s, k) => {
      const v = u.data[2 + k][i];
      extraLines[k].hidden = v == null;
      extraLines[k].textContent = v == null ? '' : `${s.label} ${(s.format ?? format)(v)}`;
    });
    when.textContent = fmtDateTime(x * 1000);
    tip.hidden = false;
    // Place it beside the cursor, flipped and clamped so it stays inside the plot container.
    const box = container.getBoundingClientRect();
    const over = u.over.getBoundingClientRect();
    const cx = over.left - box.left + u.cursor.left;
    const cy = over.top - box.top + u.cursor.top;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = cx + TIP_GAP;
    if (left + w > box.width) left = cx - TIP_GAP - w;
    left = Math.max(0, Math.min(left, box.width - w));
    const top = Math.max(0, Math.min(above ? cy - FINGER_GAP - h : cy + TIP_GAP, box.height - h));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  return { update, hide, setAbove, remove() { tip.remove(); } };
}

const TAG_FALLBACK_CLEARANCE = 16; // px, until the tag has rendered
const TAG_PAD = 6;

// Gold box on the value axis at the height of the last point.
function makeTag(container, axisFormat) {
  const tag = el('div', 'chart-tag num');
  container.append(tag);
  function update(u) {
    const ys = u.data[1];
    const last = ys[ys.length - 1];
    if (last == null) { tag.hidden = true; return; }
    tag.hidden = false;
    tag.textContent = axisFormat(last);
    const box = container.getBoundingClientRect();
    const over = u.over.getBoundingClientRect();
    const y = over.top - box.top + u.valToPos(last, 'y');
    const top = Math.max(0, Math.min(y - tag.offsetHeight / 2, box.height - tag.offsetHeight));
    const left = over.right - box.left;
    tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  // Width the tag needs for `text`, padding included (it sits in the value-axis column).
  function widthFor(text) {
    const cs = getComputedStyle(tag);
    // Built by hand: cs.font is empty when font-variant-numeric is set (as on .num).
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const spacing = (parseFloat(cs.letterSpacing) || 0) * text.length;
    return textWidth(text, font) + spacing + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  }
  // Hide the axis label within half the tag's height (plus a margin) of it.
  function clearance() {
    const h = tag.hidden ? 0 : tag.offsetHeight;
    return h > 0 ? h / 2 + TAG_PAD : TAG_FALLBACK_CLEARANCE;
  }
  return { update, clearance, widthFor, remove() { tag.remove(); } };
}

// `extras`: more lines on the same axes, each { label, stroke, values (one per point),
// dash?, format? }. Moving averages (`mas`) are drawn through the same mechanism.
// The main line is filled underneath with LED blocks (led-fill.js); `ledStrength` scales
// their brightness (0.5 calms very spiky series).
export function lineChart(container, points, {
  label, format, axisFormat = format, changeFormat, log = false, mas = [], extras = [], height = 320, ledStrength = 1, trimAxis = false, stepped = false,
}) {
  const axisLabel = trimAxis ? (v) => trimZeros(axisFormat(v)) : axisFormat;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const lines = [
    ...mas.map((m) => ({ label: m.label, stroke: m.stroke, dash: [5, 4], width: 1.5, values: xs.map((x) => maAt(m.series, x)) })),
    ...extras,
  ];
  const axis = { stroke: INK, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID, width: 1 }, font: FONT };
  const tooltip = makeTooltip(container, { format, changeFormat, first: ys[0], extras: lines });
  const tag = makeTag(container, axisFormat);
  const chart = new window.uPlot({
    width: Math.max(280, container.clientWidth),
    height,
    scales: { x: { time: true }, y: log ? { distr: 3, range: (u, lo, hi) => [lo / LOG_PAD, hi * LOG_PAD] } : { distr: 1 } },
    axes: [{ ...axis, space: 80 }, { // time labels at least 80 px apart, so "10:00pm" never touches the next one
      ...axis, side: 1,
      // Just wide enough for the widest label or the gold value tag, so phones keep the plot wide.
      size: (u, values) => {
        const labelW = Math.max(0, ...(values ?? []).filter(Boolean).map((v) => textWidth(v, FONT)));
        const ys = u.data?.[1]; // not set yet on uPlot's first layout pass
        const last = ys?.[ys.length - 1];
        const tagW = last == null ? 0 : tag.widthFor(axisFormat(last));
        // The tag may hang into the card's padding beside the chart, keeping 6px clear of its edge.
        const card = container.closest('.card');
        const room = card ? card.getBoundingClientRect().right - container.getBoundingClientRect().right - 6 : 0;
        const overhang = Math.max(0, Math.min(TAG_OVERHANG, room));
        return Math.ceil(Math.max(labelW + AXIS_GAP, tagW - overhang) + 6);
      },
      ...(log ? { splits: (u, i, lo, hi) => logSplits(lo, hi) } : {}),
      values: (u, vals) => {
        const last = u.data[1][u.data[1].length - 1];
        const tagPos = last == null ? null : u.valToPos(last, 'y');
        return labelsClearOfTag(vals, vals.map((v) => u.valToPos(v, 'y')), tagPos, tag.clearance(), axisLabel);
      },
    }],
    series: [{}, {
      label, stroke: GOLD, width: 1.75, points: { show: false },
      ...(stepped ? { paths: window.uPlot.paths.stepped({ align: 1 }) } : {}), // changes only at each point
      value: (u, v) => (v == null ? '—' : format(v)),
    }, ...lines.map((s) => ({
      label: s.label, stroke: s.stroke, width: s.width ?? 1.5, ...(s.dash ? { dash: s.dash } : {}), points: { show: false }, spanGaps: false,
      value: (u, v) => (v == null ? '—' : (s.format ?? format)(v)),
    }))],
    legend: { show: false },
    cursor: { x: true, y: true, points: { size: 9, width: 2, fill: GOLD, stroke: '#0a0a0a' } },
    hooks: { setCursor: [(u) => tooltip.update(u)], draw: [(u) => tag.update(u)], drawAxes: [(u) => drawLedFill(u, ledStrength, stepped)] },
  }, [xs, ys, ...lines.map((s) => s.values)], container);
  container.dataset.seriesCount = String(chart.series.length);
  const leave = () => tooltip.hide();
  chart.over.addEventListener('mouseleave', leave);
  // Touch: uPlot only follows the mouse, so a finger dragged along the chart moves the
  // cursor here. CSS gives the plot touch-action: pan-y, so vertical swipes still scroll.
  const scrub = (e) => {
    tooltip.setAbove(e.pointerType === 'touch');
    if (e.pointerType !== 'touch') return;
    const r = chart.over.getBoundingClientRect();
    chart.setCursor({
      left: Math.max(0, Math.min(r.width, e.clientX - r.left)),
      top: Math.max(0, Math.min(r.height, e.clientY - r.top)),
    });
  };
  chart.over.addEventListener('pointerdown', scrub);
  chart.over.addEventListener('pointermove', scrub);
  let alive = true;
  document.fonts?.ready.then(() => { if (alive) chart.redraw(false, true); }); // re-measure the axis with the real fonts
  const observer = new ResizeObserver(() => chart.setSize({ width: Math.max(280, container.clientWidth), height }));
  observer.observe(container);
  return {
    destroy() {
      alive = false;
      observer.disconnect();
      chart.over.removeEventListener('mouseleave', leave);
      chart.destroy();
      tooltip.remove();
      tag.remove();
    },
  };
}

const MA_STROKE = { 50: 'rgba(250, 250, 250, 0.75)', 200: '#7fb3ff' };
const DAY = 86_400;
const RANGE_SECONDS = { '1h': 3_600, '1d': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '1m': 30 * DAY, '3m': 90 * DAY,
  '1y': 365 * DAY, '5y': 1825 * DAY, '10y': 3650 * DAY };

function rangeSeconds(range, nowSec) {
  if (range === 'ytd') return nowSec - Date.UTC(new Date(nowSec * 1000).getUTCFullYear(), 0, 1) / 1000;
  return RANGE_SECONDS[range];
}

// `extendToNow`: for step series (difficulty only changes at retargets), carry the last
// value flat to the present so the chart ends today like the others.
export function mountRangeChart(section, { series, label, format, axisFormat, changeFormat, defaultRange, noteOnAll = false, ledStrength = 1, extendToNow = false, thin = false, trimAxis = false, stepped = false }) {
  const plot = section.querySelector('.plot');
  const summary = section.querySelector('.chart-summary');
  let note = section.querySelector('.chart-note');
  if (!note) {
    note = el('p', 'chart-note');
    summary.before(note);
  }
  const buttons = [...section.querySelectorAll('[data-range]')];
  const logButton = section.querySelector('[data-log]');
  const maButtons = [...section.querySelectorAll('[data-ma]')];
  const maNote = el('p', 'chart-ma-note');
  maNote.hidden = true;
  if (maButtons.length) note.after(maNote);
  const maOn = new Set();
  let closes = null; // daily closes from the full price history, fetched once
  let closesRequest = null;
  const maSeries = new Map(); // days -> moving-average series
  // Remember this chart's range, LOG and moving averages per page, in this browser only.
  const prefKey = `chart:${location.pathname}:${series}`;
  const saved = loadPref(prefKey, null) ?? {};
  let range = buttons.some((b) => b.dataset.range === saved.range) ? saved.range : defaultRange;
  let log = Boolean(logButton && saved.log);
  logButton?.setAttribute('aria-pressed', String(log));
  const savePrefs = () => savePref(prefKey, { range, log, ma: [...maOn] });
  let points = [];
  let chart = null;
  let request = 0;

  function draw() {
    chart?.destroy();
    chart = null;
    plot.replaceChildren();
    // A log scale cannot show zero or negative values.
    const usable = log ? points.filter((p) => p[1] > 0) : points;
    if (usable.length < 2) plot.append(el('p', 'chart-empty', 'Not enough history yet.'));
    else {
      const mas = [...maOn].sort((a, b) => a - b).map((d) => ({
        days: d, label: `${d} MA`, stroke: MA_STROKE[d], series: maSeries.get(d) ?? [],
      }));
      // `thin`: very spiky series are averaged to about one point per 2 px so the trend shows.
      const shown = thin ? bucketAverage(usable, Math.floor(plot.clientWidth / 2)) : usable;
      chart = lineChart(plot, shown, { label, format, axisFormat, changeFormat, log, mas, ledStrength, trimAxis, stepped });
      updateMaNote(usable, mas);
    }
    if (usable.length < 2) maNote.hidden = true;
    summary.textContent = summarize(label, points, format);
    updateNote();
  }

  // Say so when an enabled moving average has nothing to draw in the visible range.
  function updateMaNote(usable, mas) {
    const lines = mas.filter((m) => !usable.some((p) => maAt(m.series, p[0]) != null)).map((m) => {
      const first = m.series[0];
      const when = first ? `available from ${fmtDate(first[0] * 1000, 'UTC')}` : 'not enough history yet';
      return `${m.label} needs ${m.days} days of history (${when}).`;
    });
    maNote.hidden = lines.length === 0;
    maNote.textContent = lines.join(' ');
  }

  async function ensureCloses() {
    if (closes) return true;
    closesRequest ??= getHistory('price', 'all').then((d) => { closes = dailyCloses(d.points); }).catch(() => { closesRequest = null; });
    await closesRequest;
    return closes != null;
  }

  // Say so when the recorded history is clearly shorter than the selected range.
  function updateNote() {
    const nowSec = Date.now() / 1000;
    const span = rangeSeconds(range, nowSec) ?? (range === 'all' && noteOnAll ? Infinity : null);
    const short = span != null && points.length > 0 && nowSec - points[0][0] < 0.9 * span;
    note.hidden = !short;
    note.textContent = short ? `History begins ${fmtDate(points[0][0] * 1000)}.` : '';
  }

  async function load() {
    const mine = ++request; // only the latest click may draw
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.range === range));
    summary.textContent = 'Loading…';
    note.hidden = true;
    let data;
    try {
      data = await getHistory(series, range);
    } catch {
      if (mine !== request) return;
      points = [];
      chart?.destroy();
      chart = null;
      plot.replaceChildren();
      summary.textContent = `${label}: history is unavailable right now.`;
      updateNote();
      section.dispatchEvent(new CustomEvent('rangeloaded', { detail: { range, points } }));
      return;
    }
    if (mine !== request) return;
    points = data.points;
    const nowSec = Math.floor(Date.now() / 1000);
    if (extendToNow && points.length && points.at(-1)[0] < nowSec) points = [...points, [nowSec, points.at(-1)[1]]];
    draw();
    section.dispatchEvent(new CustomEvent('rangeloaded', { detail: { range, points } }));
  }

  for (const b of buttons) b.addEventListener('click', () => { range = b.dataset.range; savePrefs(); load(); });
  logButton?.addEventListener('click', () => {
    log = !log;
    logButton.setAttribute('aria-pressed', String(log));
    savePrefs();
    draw();
  });

  async function setMa(b, on) {
    const days = Number(b.dataset.ma);
    b.setAttribute('aria-pressed', String(on));
    if (!on) { maOn.delete(days); savePrefs(); draw(); return; }
    maOn.add(days);
    savePrefs();
    if (!(await ensureCloses())) {
      maOn.delete(days);
      b.setAttribute('aria-pressed', 'false');
      maNote.hidden = false;
      maNote.textContent = 'Moving averages are unavailable right now.';
      return;
    }
    if (!maOn.has(days)) return; // switched off while loading
    if (!maSeries.has(days)) maSeries.set(days, movingAverage(closes, days));
    draw();
  }
  for (const b of maButtons) b.addEventListener('click', () => setMa(b, !maOn.has(Number(b.dataset.ma))));

  load();
  const savedMa = Array.isArray(saved.ma) ? saved.ma : [];
  for (const b of maButtons) if (savedMa.includes(Number(b.dataset.ma))) setMa(b, true);
}
