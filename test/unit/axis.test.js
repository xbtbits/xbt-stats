import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelsClearOfTag, logSplits } from '../../site/js/axis.js';

const fmt = (v) => v.toFixed(2);

test('the axis label under the value tag is blanked, others stay', () => {
  const values = [825, 830, 835];
  const positions = [300, 260, 220];
  assert.deepEqual(labelsClearOfTag(values, positions, 268, 16, fmt), ['825.00', '', '835.00']);
});

test('only the single label nearest the tag is blanked when two sit inside the clearance', () => {
  const values = [825, 830, 835];
  const positions = [300, 262, 275];
  assert.deepEqual(labelsClearOfTag(values, positions, 270, 16, fmt), ['825.00', '830.00', '']);
});

test('the nearest label stays when it is outside the clearance', () => {
  assert.deepEqual(labelsClearOfTag([830], [260], 276, 16, fmt), ['830.00']);
});

test('no tag (no data) keeps every label', () => {
  assert.deepEqual(labelsClearOfTag([825, 830], [300, 260], null, 16, fmt), ['825.00', '830.00']);
});

test('logSplits keeps the 1.5 and 7 mantissas when there are at most 9 values', () => {
  assert.deepEqual(logSplits(80, 2000), [100, 150, 200, 300, 500, 700, 1000, 1500, 2000]);
});

test('logSplits drops 1.5 and 7 when there would be more than 9 values', () => {
  const s = logSplits(5, 50000);
  assert.deepEqual(s, [5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000]);
});

test('logSplits values are ascending and within range, including fractions', () => {
  for (const [lo, hi] of [[0.0003, 0.02], [1, 9], [123, 456], [850, 900]]) {
    const s = logSplits(lo, hi);
    for (let i = 0; i < s.length; i += 1) {
      assert.ok(s[i] >= lo && s[i] <= hi);
      if (i) assert.ok(s[i] > s[i - 1]);
    }
  }
  assert.deepEqual(logSplits(0.0003, 0.002), [0.0003, 0.0005, 0.0007, 0.001, 0.0015, 0.002]);
});

test('logSplits returns nothing for an unusable range', () => {
  assert.deepEqual(logSplits(0, 100), []);
  assert.deepEqual(logSplits(10, 5), []);
});
