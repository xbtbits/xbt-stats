import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledPlan } from '../../site/js/leds.js';

const lit = (plan, cls = 'on') => plan.filter((l) => l.cls === cls && l.frac === 0).length;

test('one part: whole LEDs lit, the remainder as a part-lit LED', () => {
  const plan = ledPlan([{ pct: 25.5 }], 10);
  assert.equal(plan.length, 10);
  assert.equal(lit(plan), 2);
  assert.equal(plan[2].cls, 'on');
  assert.ok(Math.abs(plan[2].frac - 0.55) < 1e-9);
  assert.deepEqual(plan.slice(3).map((l) => l.cls), Array(7).fill(''));
});

test('one part: tiny shares stay visible as a part-lit LED, 0 and 100 are exact', () => {
  assert.ok(ledPlan([{ pct: 0.2 }], 100)[0].frac > 0);
  assert.equal(lit(ledPlan([{ pct: 0 }], 50)), 0);
  assert.equal(ledPlan([{ pct: 0 }], 50).some((l) => l.frac > 0), false);
  assert.equal(lit(ledPlan([{ pct: 100 }], 50)), 50);
  assert.equal(lit(ledPlan([{ pct: 140 }], 50)), 50);
  assert.equal(lit(ledPlan([{ pct: null }], 50)), 0);
});

test('stacked parts fill every LED, in order, and keep tiny parts visible', () => {
  const plan = ledPlan([{ pct: 98.2, cls: 'tip' }, { pct: 1.5, cls: 'near' }, { pct: 0.1, cls: 'day' }, { pct: 0.2, cls: 'behind' }], 60);
  const counts = ['tip', 'near', 'day', 'behind'].map((c) => lit(plan, c));
  assert.deepEqual(counts, [57, 1, 1, 1]);
  assert.deepEqual(plan.map((l) => l.cls).filter((c, i, a) => c !== a[i - 1]), ['tip', 'near', 'day', 'behind']);
});

test('stacked parts: zero parts get no LED, rounding goes to the largest remainders', () => {
  const plan = ledPlan([{ pct: 50, cls: 'a' }, { pct: 0, cls: 'b' }, { pct: 50, cls: 'c' }], 9);
  assert.deepEqual([lit(plan, 'a'), lit(plan, 'b'), lit(plan, 'c')].reduce((s, x) => s + x, 0), 9);
  assert.equal(lit(plan, 'b'), 0);
});

test('no room, no LEDs', () => {
  assert.deepEqual(ledPlan([{ pct: 50 }], 0), []);
});
