// Measurement bars drawn in the price chart's LED blocks, like the "What's in your block?"
// card: 5 px squares on a 6 px grid, as many as fit the bar's width, unlit ones dim.

const PITCH = 6;

// LED plan for `n` LEDs. One part: whole lit LEDs, then a part-lit LED for the remainder
// (`frac`, 0..1) so small shares stay true to scale. Several parts (a stacked bar that adds up
// to 100%): whole LEDs by largest remainder, any non-zero part keeps at least one LED.
export function ledPlan(parts, n) {
  const leds = Array.from({ length: n }, () => ({ cls: '', frac: 0 }));
  if (n <= 0) return leds;
  const clean = parts.map((p) => ({ cls: p.cls ?? 'on', pct: Math.max(0, Math.min(100, Number(p.pct) || 0)) }));
  if (clean.length === 1) {
    const exact = (clean[0].pct / 100) * n;
    const whole = Math.min(n, Math.floor(exact));
    for (let i = 0; i < whole; i += 1) leds[i].cls = clean[0].cls;
    if (whole < n && exact > whole) leds[whole] = { cls: clean[0].cls, frac: exact - whole };
    return leds;
  }
  const exact = clean.map((p) => (p.pct / 100) * n);
  const counts = exact.map((x, i) => (clean[i].pct > 0 ? Math.max(1, Math.floor(x)) : 0));
  let spare = n - counts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; spare > 0 && k < order.length; k += 1) {
    const i = order[k][1];
    if (clean[i].pct > 0 && exact[i] > counts[i]) { counts[i] += 1; spare -= 1; }
  }
  while (spare < 0) { // the minimum-one rule overflowed: take back from the biggest part
    const i = counts.indexOf(Math.max(...counts));
    counts[i] -= 1; spare += 1;
  }
  let at = 0;
  counts.forEach((c, i) => { for (let j = 0; j < c && at < n; j += 1) leds[at++].cls = clean[i].cls; });
  return leds;
}

const drawn = new WeakMap(); // bar -> { parts, n }

function draw(bar) {
  const state = drawn.get(bar);
  const n = Math.max(0, Math.floor((bar.clientWidth + 1) / PITCH));
  if (!state || n === state.n) return;
  state.n = n;
  bar.replaceChildren(...ledPlan(state.parts, n).map((led) => {
    const i = document.createElement('i');
    if (led.frac > 0) {
      const part = document.createElement('b');
      part.className = led.cls;
      part.style.width = `${Math.max(1, Math.round(led.frac * 5))}px`;
      i.append(part);
    } else if (led.cls) i.className = led.cls;
    return i;
  }));
}

const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
  for (const e of entries) draw(e.target);
});

// Fill `bar` (an empty element with class "leds") with LEDs for `parts` ([{ pct, cls }]);
// it redraws itself when its width changes (resize, phone turned, a hidden list shown).
export function setLeds(bar, parts) {
  const known = drawn.has(bar);
  drawn.set(bar, { parts, n: -1 });
  draw(bar);
  if (!known) watcher?.observe(bar);
}

// A new single-part LED bar element (for list rows).
export function ledBar(pct, cls = 'on') {
  const bar = document.createElement('span');
  bar.className = 'leds';
  bar.setAttribute('aria-hidden', 'true');
  setLeds(bar, [{ pct, cls }]);
  return bar;
}
