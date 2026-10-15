import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFx, pickRates, FX_CURRENCIES, FX_SOURCES } from '../../worker/src/fx.js';
import { ALLOWED_ORIGINS } from '../../worker/src/http.js';
import { fakeFetch } from '../helpers/fake-fetch.js';

const NOW = 1791700000;
const [PRIMARY, BACKUP] = FX_SOURCES.map((s) => s.url);
const rates = Object.fromEntries(FX_CURRENCIES.map(([code], i) => [code, 1 + i]));
const primaryBody = (over = {}) => ({ result: 'success', base_code: 'USD', time_last_update_unix: NOW - 3600, rates: { ...rates, XYZ: 9 }, ...over });
const backupBody = { date: '2026-10-11', usd: Object.fromEntries(Object.entries(rates).map(([k, v]) => [k.toLowerCase(), v * 2])) };

test('both rate sources are on the outbound allowlist', () => {
  for (const s of FX_SOURCES) assert.ok(ALLOWED_ORIGINS.has(new URL(s.url).origin), s.url);
});

test('reads the primary source and keeps only our 18 currencies, in order', async () => {
  const r = await fetchFx(fakeFetch({ [PRIMARY]: primaryBody() }), NOW);
  assert.equal(r.base, 'USD');
  assert.equal(r.source.name, 'ExchangeRate-API');
  assert.equal(r.updatedAt, (NOW - 3600) * 1000);
  assert.deepEqual(r.currencies.map((c) => c.code), FX_CURRENCIES.map(([c]) => c));
  assert.deepEqual(r.rates, rates);
  assert.equal(r.rates.XYZ, undefined);
});

test('falls back to the backup when the primary fails, is stale or has a bad rate', async () => {
  for (const primary of [{ status: 500, body: 'down' }, primaryBody({ time_last_update_unix: NOW - 5 * 86_400 }),
    primaryBody({ rates: { ...rates, EUR: 0 } }), primaryBody({ result: 'error' })]) {
    const r = await fetchFx(fakeFetch({ [PRIMARY]: primary, [BACKUP]: backupBody }), NOW);
    assert.equal(r.source.name, 'Currency API');
    assert.equal(r.rates.EUR, rates.EUR * 2);
  }
});

test('both sources down throws', async () => {
  await assert.rejects(fetchFx(fakeFetch({}), NOW), /all exchange-rate sources failed/);
});

test('pickRates rejects missing, negative or non-numeric rates', () => {
  assert.throws(() => pickRates({ ...rates, NGN: undefined }), /NGN/);
  assert.throws(() => pickRates({ ...rates, JPY: -1 }), /JPY/);
  assert.throws(() => pickRates({ ...rates, AED: '3.67' }), /AED/);
});
