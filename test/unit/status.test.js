import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceStatus } from '../../site/js/status.js';

const now = 1_791_700_000_000;
const snap = (chainAgeMin, priceAgeMin) => ({
  sources: { chain: { fetchedAt: now - chainAgeMin * 60_000 } },
  price: priceAgeMin == null ? null : { updatedAt: now - priceAgeMin * 60_000 },
});

test('sourceStatus: fresh, stale chain, stale price, both, offline, no price yet', () => {
  assert.equal(sourceStatus(snap(1, 1), now).line, 'All sources OK');
  assert.equal(sourceStatus(snap(11, 1), now).line, 'Chain data stale');
  assert.equal(sourceStatus(snap(1, 21), now).line, 'Price stale');
  assert.equal(sourceStatus(snap(11, 21), now).line, 'Chain data stale, Price stale');
  assert.equal(sourceStatus(snap(1, 1), now, true).line, 'Server unreachable');
  assert.equal(sourceStatus(snap(1, null), now).line, 'Waiting for the first price');
  assert.equal(sourceStatus({}, now).chainStale, true); // no chain data at all
});
