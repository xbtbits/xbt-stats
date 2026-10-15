import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../site/', import.meta.url));
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'content-security-policy': CSP });
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/snapshot') return send(res, 200, TYPES['.json'], await readFile(join(fixtures, 'snapshot.json')));
    if (url.pathname === '/api/nodes') return send(res, 200, TYPES['.json'], await readFile(join(fixtures, 'nodes.json')));
    if (url.pathname === '/api/block') return send(res, 200, TYPES['.json'], await readFile(join(fixtures, 'block.json')));
    if (url.pathname === '/api/fx') return send(res, 200, TYPES['.json'], await readFile(join(fixtures, 'fx.json')));
    if (url.pathname === '/api/history') {
      const series = url.searchParams.get('series') ?? '';
      if (!/^[a-z]+$/.test(series)) return send(res, 400, 'text/plain', 'bad series');
      return send(res, 200, TYPES['.json'], await readFile(join(fixtures, `history-${series}.json`)));
    }
    let path = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    if (!extname(path)) path += '.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) return send(res, 403, 'text/plain', 'forbidden');
    return send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', await readFile(file));
  } catch {
    return send(res, 404, 'text/plain', 'not found');
  }
}).listen(4173, '127.0.0.1');
