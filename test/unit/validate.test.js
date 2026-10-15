import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, nonNeg, positive, validTip, validPrice, ValidationError } from '../../worker/src/validate.js';

test('num accepts numbers and numeric strings only', () => {
  assert.equal(num(5, 'x'), 5);
  assert.equal(num('849.52', 'x'), 849.52);
  for (const bad of [null, undefined, '', '  ', 'abc', NaN, Infinity, {}, []]) {
    assert.throws(() => num(bad, 'x'), ValidationError);
  }
});

test('nonNeg and positive', () => {
  assert.equal(nonNeg(0, 'x'), 0);
  assert.throws(() => nonNeg(-1, 'x'), ValidationError);
  assert.throws(() => positive(0, 'x'), ValidationError);
  assert.equal(positive('2', 'x'), 2);
});

test('validTip rejects pre-switch, fractional and far-behind tips', () => {
  assert.equal(validTip(976_572, null), 976_572);
  assert.equal(validTip('976572', 976_580), 976_572); // 8 behind is fine
  assert.throws(() => validTip(961_639, null), ValidationError);
  assert.throws(() => validTip(976_572.5, null), ValidationError);
  assert.throws(() => validTip(976_569, 976_580), ValidationError); // 11 behind
});

test('validPrice bounds', () => {
  assert.equal(validPrice('858', 'p'), 858);
  assert.throws(() => validPrice(0, 'p'), ValidationError);
  assert.throws(() => validPrice(10_000_000, 'p'), ValidationError);
});
