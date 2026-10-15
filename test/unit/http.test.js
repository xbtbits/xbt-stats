import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, fetchText, fetchBytes, UpstreamError } from '../../worker/src/http.js';
import { fakeFetch } from '../helpers/fake-fetch.js';

const OK = 'https://mempool.guide/api/blocks/tip/height';

test('returns parsed JSON from an allowed origin', async () => {
  const f = fakeFetch({ [OK]: 976572 });
  assert.equal(await fetchJson(f, OK), 976572);
});

test('blocks origins outside the allowlist without calling fetch', async () => {
  const f = fakeFetch({});
  await assert.rejects(fetchJson(f, 'https://evil.example/x'), UpstreamError);
  await assert.rejects(fetchJson(f, 'http://mempool.guide/api/x'), UpstreamError); // http, not https
  assert.equal(f.calls.length, 0);
});

test('non-200, bad JSON, network error and timeout all become UpstreamError', async () => {
  await assert.rejects(fetchJson(fakeFetch({ [OK]: { status: 503, body: 'x' } }), OK), /HTTP 503/);
  await assert.rejects(fetchJson(fakeFetch({ [OK]: { status: 200, body: 'not json' } }), OK), /bad JSON/);
  await assert.rejects(fetchJson(fakeFetch({ [OK]: new TypeError('boom') }), OK), /network error/);
  await assert.rejects(fetchJson(fakeFetch({ [OK]: 'hang' }), OK, { timeoutMs: 50 }), /timeout/);
});

test('fetchText returns the trimmed body; fetchBytes returns the bytes', async () => {
  const f = fakeFetch({ [OK]: { status: 200, body: 'abc123\n' } });
  assert.equal(await fetchText(f, OK), 'abc123');
  const g = fakeFetch({ [OK]: Uint8Array.from([1, 2, 3]) });
  assert.deepEqual(await fetchBytes(g, OK), Uint8Array.from([1, 2, 3]));
});

test('fetchText and fetchBytes share the allowlist and errors; fetchBytes enforces a size cap', async () => {
  await assert.rejects(fetchText(fakeFetch({}), 'https://evil.example/x'), /not allowed/);
  await assert.rejects(fetchBytes(fakeFetch({}), 'https://evil.example/x'), /not allowed/);
  await assert.rejects(fetchBytes(fakeFetch({ [OK]: { status: 404, body: 'x' } }), OK), /HTTP 404/);
  await assert.rejects(fetchBytes(fakeFetch({ [OK]: new Uint8Array(10) }), OK, { maxBytes: 5 }), /too large/);
});
