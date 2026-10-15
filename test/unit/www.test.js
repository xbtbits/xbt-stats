import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/www/index.js';

const get = (url, method = 'GET') => worker.fetch(new Request(url, { method, redirect: 'manual' }));

test('www sends every request to the bare domain with a permanent redirect', async () => {
  const res = await get('https://www.xbtstats.com/charts?range=1y');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://xbtstats.com/charts?range=1y');
});

test('www keeps the root path and works for HEAD', async () => {
  const res = await get('http://www.xbtstats.com/', 'HEAD');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://xbtstats.com/');
});

test('the redirect target is fixed, whatever host the request names', async () => {
  const res = await get('https://evil.example/x');
  assert.equal(res.headers.get('location'), 'https://xbtstats.com/x');
});
