import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../../site/js/convert-math.js';

test('parseAmount accepts plain, comma and space grouped numbers', () => {
  assert.equal(m.parseAmount('1'), 1);
  assert.equal(m.parseAmount('0.001'), 0.001);
  assert.equal(m.parseAmount('1,234.5'), 1234.5);
  assert.equal(m.parseAmount(' 1 234 567 '), 1234567);
  assert.equal(m.parseAmount('.5'), 0.5);
  assert.equal(m.parseAmount('5.'), 5);
  assert.equal(m.parseAmount('0'), 0);
});

test('parseAmount rejects empty, negatives, letters and extra points', () => {
  for (const bad of ['', '   ', '-1', '+1', '1e5', 'abc', '1a', '1.2.3', '.', ',', '$5', '1,,2x', null, undefined]) {
    assert.equal(m.parseAmount(bad), null, String(bad));
  }
});

test('conversions round sats to whole numbers', () => {
  assert.equal(m.xbtToSats(0.00000001), 1);
  assert.equal(m.xbtToSats(0.123456789), 12345679);
  assert.equal(m.xbtToSats(1), 100000000);
  assert.equal(m.satsToXbt(1), 0.00000001);
  assert.equal(m.xbtToUsd(2, 850), 1700);
  assert.equal(m.usdToXbt(1700, 850), 2);
});

test('formatting: sats whole, XBT up to 8 decimals trimmed, USD 2 decimals', () => {
  assert.equal(m.formatSats(12345679), '12,345,679');
  assert.equal(m.formatXbt(0.1173727), '0.1173727');
  assert.equal(m.formatXbt(1), '1');
  assert.equal(m.formatXbt(0.00000001), '0.00000001');
  assert.equal(m.formatXbt(1234.5), '1,234.5');
  assert.equal(m.formatUsd(851.9869956632151), '851.99');
  assert.equal(m.formatUsd(1000), '1,000.00');
});

test('convertFrom fills the other two fields', () => {
  const p = 851.9869956632151;
  assert.deepEqual(m.convertFrom('xbt', 1, p), { xbt: 1, sats: 100000000, usd: p });
  const r = m.convertFrom('usd', 100, p);
  assert.equal(r.usd, 100);
  assert.equal(r.sats, Math.round((100 / p) * 1e8));
  assert.equal(m.formatXbt(r.xbt), '0.11737268');
  const s = m.convertFrom('sats', 100000000, p);
  assert.equal(s.xbt, 1);
  assert.equal(s.usd, p);
});

test('convertFrom guards the maximum inputs', () => {
  assert.deepEqual(m.convertFrom('xbt', 21000001, 850), { error: 'Too large' });
  assert.deepEqual(m.convertFrom('sats', 2.1e15 + 1, 850), { error: 'Too large' });
  assert.deepEqual(m.convertFrom('usd', 1e13 + 1, 850), { error: 'Too large' });
  assert.ok(!m.convertFrom('xbt', 21000000, 850).error);
  assert.ok(!m.convertFrom('sats', 2.1e15, 850).error);
  assert.ok(!m.convertFrom('usd', 1e13, 850).error);
});

test('formatFiat uses the currency symbol, cents below 1,000 and whole units above', () => {
  assert.equal(m.formatFiat(747.684, 'EUR'), '€747.68');
  assert.equal(m.formatFiat(132613.4, 'JPY'), '¥132,613');
  assert.equal(m.formatFiat(1194.2, 'CAD'), 'CA$1,194');
  assert.equal(m.formatFiat(696.16, 'CHF'), 'CHF\u00a0696.16'); // Intl puts a no-break space after letter codes
  assert.equal(m.formatFiat(0, 'EUR'), '—');
  assert.equal(m.formatFiat(NaN, 'EUR'), '—');
});

test('satsPerUnit floors 1e8 / (price x rate) and needs both numbers', () => {
  assert.equal(m.satsPerUnit(828.37, 0.892438), 135268);
  assert.equal(m.satsPerUnit(0, 1), null);
  assert.equal(m.satsPerUnit(800, null), null);
});

test('fiatParts marks the currency symbol so it can be styled', () => {
  assert.deepEqual(m.fiatParts(747.68, 'EUR'), [['symbol', '€'], ['text', '747'], ['text', '.'], ['text', '68']]);
  assert.equal(m.fiatParts(-1, 'EUR'), null);
});
