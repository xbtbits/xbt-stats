// Builds every site icon from the LED logo in site/js/brand.js (block coin + XBT letters).
//   icons/favicon.svg + /favicon.ico                   browser tab: 11-block glowing coin on the block grid
//   icons/icon.svg + icon-180/192/512.png              home screen / app: 13-block coin + "XBT" on a dim LED board,
//                                                      square edges (the phone rounds the corners)
// Run: node scripts/make-icons.js
// After changing the home screen icon, bump ?v= on its links (site/*.html, manifest.webmanifest):
// iPhones keep an icon they have already fetched from the same address.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (path) => fileURLToPath(new URL(`../site/${path}`, import.meta.url));
const HI = [255, 214, 110], GOLD = [234, 180, 72];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const n = (v) => +v.toFixed(2);

// Same rule as brand.js: rim = coin blocks with any neighbour outside; X = two diagonals.
function coinBlocks(d) {
  const blocks = [], c = (d - 1) / 2, R = d / 2, arm = Math.max(1, Math.floor(R - 2.5));
  const inside = (x, y) => x >= 0 && y >= 0 && x < d && y < d && Math.hypot(x - c, y - c) <= R - 0.35;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      if (!inside(x, y)) continue;
      let rim = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!inside(x + dx, y + dy)) rim = true;
      const u = x - c, v = y - c;
      const cross = Math.max(Math.abs(u), Math.abs(v)) <= arm && (Math.abs(u - v) < 0.6 || Math.abs(u + v) < 0.6);
      blocks.push({ x, y, lit: rim || cross });
    }
  }
  return blocks;
}

function coinSvg({ d, round, grid }) {
  const S = 512, pad = S * 0.12, pitch = (S - 2 * pad) / d, gap = pitch * 0.18, cell = n(pitch - gap);
  const rows = coinBlocks(d).map(({ x, y, lit }) =>
    `<rect x="${n(pad + x * pitch)}" y="${n(pad + y * pitch)}" width="${cell}" height="${cell}" fill="${hex(mix(HI, GOLD, y / d))}"${lit ? '' : ' fill-opacity="0.2"'}/>`);
  const gp = pitch / 2;
  const gridDefs = grid ? `
    <radialGradient id="glow" cx="50%" cy="20%" r="90%"><stop offset="0" stop-color="#eab448" stop-opacity="0.22"/><stop offset="1" stop-color="#eab448" stop-opacity="0.05"/></radialGradient>
    <pattern id="cells" width="${n(gp)}" height="${n(gp)}" patternUnits="userSpaceOnUse"><rect width="${n(gp * 0.8)}" height="${n(gp * 0.8)}" fill="#fff"/></pattern>
    <mask id="grid"><rect width="${S}" height="${S}" fill="url(#cells)"/></mask>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <defs>
    <clipPath id="shape"><rect width="${S}" height="${S}" rx="${n(S * round)}"/></clipPath>
    <filter id="led" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="${n(pitch * 0.7)}" flood-color="#eab448" flood-opacity="0.7"/></filter>${gridDefs}
  </defs>
  <g clip-path="url(#shape)">
    <rect width="${S}" height="${S}" fill="#050505"/>${grid ? `\n    <rect width="${S}" height="${S}" fill="url(#glow)" mask="url(#grid)"/>` : ''}
    <g filter="url(#led)">
      ${rows.join('\n      ')}
    </g>
  </g>
</svg>
`;
}

// Same letters as brand.js ('#' = lit block, 9 rows) and the same gaps.
const GLYPHS = {
  X: ['#........#', '.#......#.', '..#....#..', '...#..#...', '....##....', '...#..#...', '..#....#..', '.#......#.', '#........#'],
  B: ['#########.', '#........#', '#........#', '#........#', '#########.', '#........#', '#........#', '#........#', '#########.'],
  T: ['#########', '....#....', '....#....', '....#....', '....#....', '....#....', '....#....', '....#....', '....#....'],
};
const LETTER_GAP = 2, COIN_GAP = 4;

// Home screen icon: the header logo (coin + XBT) centred on a square LED board where every
// unlit block shows faintly, so it reads as a sign rather than a lone X.
function logoBoardSvg({ coinD = 13, board = 57 }) {
  const S = 512, pitch = S / board, gap = pitch * 0.16, cell = n(pitch - gap), off = gap / 2;
  const lit = new Map(); // "x,y" -> opacity
  let tx = 0;
  const letters = [];
  for (const ch of 'XBT') {
    GLYPHS[ch].forEach((row, y) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') letters.push([tx + i, y]); });
    tx += GLYPHS[ch][0].length + LETTER_GAP;
  }
  const w = coinD + COIN_GAP + tx - LETTER_GAP;
  const x0 = Math.floor((board - w) / 2), y0 = Math.floor((board - coinD) / 2), lift = Math.floor((coinD - 9) / 2);
  for (const { x, y, lit: on } of coinBlocks(coinD)) lit.set(`${x0 + x},${y0 + y}`, on ? 1 : 0.3);
  for (const [x, y] of letters) lit.set(`${x0 + coinD + COIN_GAP + x},${y0 + lift + y}`, 1);
  const dim = [], on = [];
  for (let y = 0; y < board; y++) {
    for (let x = 0; x < board; x++) {
      const a = lit.get(`${x},${y}`);
      const r = `x="${n(x * pitch + off)}" y="${n(y * pitch + off)}" width="${cell}" height="${cell}"`;
      if (!a) dim.push(`<rect ${r}/>`);
      else on.push(`<rect ${r} fill="${hex(mix(HI, GOLD, (y - y0) / coinD))}"${a < 1 ? ` fill-opacity="${a}"` : ''}/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <defs>
    <filter id="led" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="${n(pitch * 0.55)}" flood-color="#eab448" flood-opacity="0.75"/></filter>
  </defs>
  <rect width="${S}" height="${S}" fill="#0b0a06"/>
  <g fill="#eab448" fill-opacity="0.2">${dim.join('')}</g>
  <g filter="url(#led)">
    ${on.join('\n    ')}
  </g>
</svg>
`;
}

// .ico holding PNG images (supported by every current browser).
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

writeFileSync(out('icons/favicon.svg'), coinSvg({ d: 11, round: 0.18, grid: true }));
writeFileSync(out('icons/icon.svg'), logoBoardSvg({}));

const browser = await chromium.launch();
async function png(svgPath, size) {
  const svg = readFileSync(out(svgPath), 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  const data = await page.screenshot({ omitBackground: true });
  await page.close();
  return data;
}
for (const size of [180, 192, 512]) writeFileSync(out(`icons/icon-${size}.png`), await png('icons/icon.svg', size));
writeFileSync(out('favicon.ico'), ico([
  { size: 16, data: await png('icons/favicon.svg', 16) },
  { size: 32, data: await png('icons/favicon.svg', 32) },
]));
await browser.close();
console.log('icons written');
