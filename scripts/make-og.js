// Renders the link-preview image site/og.png (1200 x 630) from scripts/og/og.html with the
// site's own CSS and LED wordmark. Run after changing the brand: node scripts/make-og.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const site = fileURLToPath(new URL('../site/', import.meta.url));
const page = fileURLToPath(new URL('./og/og.html', import.meta.url));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = path === '/' ? page : normalize(join(site, path));
  if (file !== page && !file.startsWith(site)) { res.writeHead(403); res.end(); return; }
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 400, height: 210 }, deviceScaleFactor: 3 });
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
await tab.locator('.wordmark.led canvas').waitFor();
await tab.evaluate(() => document.fonts.ready);
await tab.screenshot({ path: join(site, 'og.png') });
await browser.close();
server.close();
console.log('wrote site/og.png');
