// "Page not found": a gold code shimmer behind a big LED-block 404. Characters across the
// stage keep changing, fading toward the edges. Still (drawn once) for reduce-motion.
(() => {
  const stage = document.querySelector('.nf');
  if (!stage) return;
  const bg = stage.querySelector('.nf-bg');
  const led = stage.querySelector('.nf-led');
  const HI = [255, 214, 110], GOLD = [234, 180, 72], LO = [140, 110, 53];
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
  const CHARS = '!"#$%&\'()*+,-./0123456789:;<=>?@[\\]^_`{|}~XBT';
  const pick = () => CHARS[(Math.random() * CHARS.length) | 0];
  const CELL_W = 9, CELL_H = 15, CHANGE = 0.06, TICK_MS = 70;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  stage.dataset.motion = still ? 'still' : 'live';

  // Big LED 404, in the same block style as the wordmark.
  const GLYPHS = {
    4: ['.......##.', '......###.', '.....#..#.', '....#...#.', '...#....#.', '..#.....#.', '.#########', '........#.', '........#.'],
    0: ['.########.', '#........#', '#......#.#', '#.....#..#', '#....#...#', '#...#....#', '#..#.....#', '#........#', '.########.'],
  };
  const blocks = [];
  let cols = 0;
  for (const ch of '404') {
    GLYPHS[ch].forEach((row, y) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') blocks.push([cols + i, y]); });
    cols += GLYPHS[ch][0].length + 3;
  }
  cols -= 3;
  const ROWS = 9, GLOW = 12;

  let dpr = 1, w = 0, h = 0, g = null, grid = [], gridCols = 0;

  function drawLed() {
    const pitch = Math.max(5, Math.min(12, Math.floor((stage.clientWidth * 0.62) / cols)));
    const cssW = cols * pitch + GLOW * 2, cssH = ROWS * pitch + GLOW * 2;
    led.width = cssW * dpr; led.height = cssH * dpr;
    led.style.width = `${cssW}px`; led.style.height = `${cssH}px`;
    const c = led.getContext('2d');
    c.scale(dpr, dpr);
    c.translate(GLOW, GLOW);
    c.shadowColor = 'rgba(234, 180, 72, 0.7)'; c.shadowBlur = pitch + 4;
    for (const [x, y] of blocks) {
      c.fillStyle = `rgb(${mix(HI, GOLD, y / ROWS)})`;
      c.fillRect(x * pitch, y * pitch, pitch - 1, pitch - 1);
    }
  }

  function paint() {
    g.fillStyle = '#050505';
    g.fillRect(0, 0, w, h);
    grid.forEach(([ch, b], i) => {
      g.fillStyle = `rgba(${mix(LO, HI, b)}, ${0.22 + b * 0.55})`;
      g.fillText(ch, (i % gridCols) * CELL_W, ((i / gridCols) | 0) * CELL_H);
    });
    // Fade toward the edges and keep the middle calm behind the message.
    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.12, w / 2, h / 2, Math.max(w, h) * 0.72);
    v.addColorStop(0, 'rgba(5, 5, 5, 0.6)');
    v.addColorStop(0.5, 'rgba(5, 5, 5, 0.18)');
    v.addColorStop(1, 'rgba(5, 5, 5, 0.92)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
  }

  function tick() {
    if (document.hidden) return;
    for (let k = 0; k < grid.length * CHANGE; k++) grid[(Math.random() * grid.length) | 0] = [pick(), Math.random()];
    paint();
  }

  function setup() {
    dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    w = stage.clientWidth; h = stage.clientHeight;
    bg.width = w * dpr; bg.height = h * dpr;
    g = bg.getContext('2d');
    g.scale(dpr, dpr);
    g.font = '12px ui-monospace, "SF Mono", Menlo, monospace';
    g.textBaseline = 'top';
    gridCols = Math.ceil(w / CELL_W);
    grid = Array.from({ length: gridCols * Math.ceil(h / CELL_H) }, () => [pick(), Math.random()]);
    paint();
    drawLed();
  }

  setup();
  if (!still) setInterval(tick, TICK_MS);
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(setup, 150); });
  stage.dataset.ready = 'true';
})();
