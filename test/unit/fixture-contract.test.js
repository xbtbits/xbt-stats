import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSnapshot } from '../../worker/src/snapshot.js';
import { recordQuotes, updatePriceSummary } from '../../worker/src/store.js';
import { fakeD1 } from '../helpers/fake-d1.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import { explorerRaw, explorerRoutes, PRIMARY, BACKUP } from '../helpers/explorer-fixture.js';
import { fetchNodes } from '../../worker/src/nodes.js';
import { censusRoutes } from '../helpers/nodes-fixture.js';

function shape(v) {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return v === null ? 'null' : typeof v;
}

test('snapshot.json has exactly the shape buildSnapshot produces', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
  const db = fakeD1();
  const nowMs = fixture.generatedAt;
  const ts = Math.floor(nowMs / 1000) - 60;
  const qs = [
    { ok: true, ts, venue: 'nonkyc:BTCB2_USDT', label: 'NonKYC BTCB2/USDT', price: 849.52, volBase: 862.1255, volUsd: 766921.9755, high: 930, low: 839.07, changePct: -3,
      bid: 847.1, ask: 851.3, link: null, inPrice: true },
  ];
  await recordQuotes(db, qs);
  await updatePriceSummary(db, qs, ts);
  const fetchFn = fakeFetch({ ...explorerRoutes(PRIMARY, explorerRaw()), [`${BACKUP}/blocks/tip/height`]: 976572 });
  const built = await buildSnapshot({ fetchFn, db, nowMs });
  assert.deepEqual(shape(fixture), shape(built));
});

test('nodes.json has exactly the shape fetchNodes produces', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/nodes.json', import.meta.url), 'utf8'));
  const built = await fetchNodes(fakeFetch(censusRoutes()));
  assert.deepEqual(shape(fixture), shape(built));
  assert.equal(fixture.versions.at(-1).ua, 'Other');
});
