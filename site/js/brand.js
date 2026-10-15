// LED wordmark: a pixel-block gold coin (rim and X lit) plus "XBT STATS" in gold blocks, drawn on one
// canvas so the coin lines up with the letters. The link text stays for screen readers
// and is what shows if this script fails.
(() => {
  const HI = [255, 214, 110], GOLD = [234, 180, 72];
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
  const LETTER_GAP = 2; // blocks between letters
  const COIN_GAP = 4; // blocks between coin and text

  // Hand-drawn block letters (9 rows, wide like Michroma), so every glyph is crisp and
  // repeated letters are identical. '#' = lit block.
  const GLYPHS = {
    X: ['#........#', '.#......#.', '..#....#..', '...#..#...', '....##....', '...#..#...', '..#....#..', '.#......#.', '#........#'],
    B: ['#########.', '#........#', '#........#', '#........#', '#########.', '#........#', '#........#', '#........#', '#########.'],
    T: ['#########', '....#....', '....#....', '....#....', '....#....', '....#....', '....#....', '....#....', '....#....'],
    S: ['.#########', '#.........', '#.........', '#.........', '.########.', '.........#', '.........#', '.........#', '#########.'],
    A: ['....##....', '...#..#...', '...#..#...', '..#....#..', '..#....#..', '.########.', '.#......#.', '#........#', '#........#'],
    ' ': ['....', '....', '....', '....', '....', '....', '....', '....', '....'],
  };
  const CAPS = 9;
  // Coin slightly taller than the capitals (odd, so the X has a centre block), centred on them.
  const COIN = CAPS + 3 + ((CAPS + 3) % 2 === 0 ? 1 : 0);

  // Lit blocks for the text, or null if a character has no glyph (the plain text logo stays).
  function letters(text) {
    const lit = [];
    let x = 0;
    for (const ch of text) {
      const rows = GLYPHS[ch];
      if (!rows) return null;
      rows.forEach((row, y) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') lit.push([x + i, y]); });
      x += rows[0].length + LETTER_GAP;
    }
    return { lit, cols: x - LETTER_GAP };
  }

  // Coin as a grid of blocks, `d` blocks across: lit rim and X, faintly lit face.
  // The rim is every coin block that touches the outside, so the ring has no gaps.
  function coin(d) {
    const blocks = [];
    const c = (d - 1) / 2, R = d / 2;
    const inside = (x, y) => x >= 0 && y >= 0 && x < d && y < d && Math.hypot(x - c, y - c) <= R - 0.35;
    const arm = Math.max(1, Math.floor(R - 2.5));
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < d; x++) {
        if (!inside(x, y)) continue;
        const u = x - c, v = y - c;
        let rim = false; // any of the 8 neighbours outside: diagonal steps get filled, no corner-only joins
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!inside(x + dx, y + dy)) rim = true;
        const cross = Math.max(Math.abs(u), Math.abs(v)) <= arm && (Math.abs(u - v) < 0.6 || Math.abs(u + v) < 0.6);
        blocks.push([x, y, rim || cross]);
      }
    }
    return blocks;
  }

  const GLOW = 4; // room for the glow around the edge blocks, in CSS px

  // Biggest block size (3px, else 2px) at which the whole logo fits the header width.
  function pickPitch(a, wBlocks) {
    const top = a.parentElement;
    const cs = getComputedStyle(top);
    const room = top.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return wBlocks * 3 + GLOW * 2 <= room ? 3 : 2;
  }

  function draw(a, label, pitch) {
    const { lit, cols } = letters(label.toUpperCase());
    const d = COIN;
    const lift = Math.floor((d - CAPS) / 2);
    const textX = d + COIN_GAP;
    const wBlocks = textX + cols, hBlocks = d;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const cv = document.createElement('canvas');
    const cssW = wBlocks * pitch + GLOW * 2, cssH = hBlocks * pitch + GLOW * 2;
    cv.width = cssW * dpr; cv.height = cssH * dpr;
    cv.style.width = `${cssW}px`; cv.style.height = `${cssH}px`;
    cv.setAttribute('aria-hidden', 'true');
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(GLOW, GLOW);
    g.shadowColor = 'rgba(234, 180, 72, 0.6)'; g.shadowBlur = pitch + 2;
    const block = (x, y, col) => { g.fillStyle = `rgb(${col})`; g.fillRect(x * pitch, y * pitch, pitch - 1, pitch - 1); };
    for (const [x, y, on] of coin(d)) {
      g.globalAlpha = on ? 1 : 0.2;
      block(x, y, mix(HI, GOLD, y / d));
    }
    g.globalAlpha = 1;
    for (const [x, y] of lit) block(textX + x, y + lift, mix(HI, GOLD, y / CAPS));
    const text = document.createElement('span');
    text.className = 'sr-only';
    text.textContent = label;
    a.replaceChildren(cv, text);
    a.classList.add('led');
  }

  const a = document.querySelector('.wordmark');
  const label = a?.textContent.trim();
  const glyphs = label && letters(label.toUpperCase());
  if (!glyphs) return;
  const wBlocks = COIN + COIN_GAP + glyphs.cols;
  let pitch = pickPitch(a, wBlocks);
  draw(a, label, pitch);
  // Redraw only when a resize (e.g. turning the phone) changes which block size fits.
  window.addEventListener('resize', () => {
    const next = pickPitch(a, wBlocks);
    if (next !== pitch) { pitch = next; draw(a, label, pitch); }
  });
})();
