import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lines = readFileSync(new URL('../../site/_headers', import.meta.url), 'utf8').split('\n');

test('_headers carries the exact CSP and referrer policy', () => {
  assert.ok(lines.includes("  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"));
  assert.ok(lines.includes('  Referrer-Policy: no-referrer'));
});

test('_headers forbids edge rewrites, so Cloudflare cannot inject its analytics beacon', () => {
  // Same caching as the asset default (revalidate every time), plus no-transform.
  assert.ok(lines.includes('  Cache-Control: public, max-age=0, must-revalidate, no-transform'));
});
