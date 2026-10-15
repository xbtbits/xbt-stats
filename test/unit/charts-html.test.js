import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chartHeader, HEADER_SERIES } from '../../site/js/chart-stats.js';

// charts.html carries each stat header's labels so the first paint has its full height;
// they must stay the same as the builders' labels.
test('charts.html stat headers match chart-stats.js labels, in order, with dashes', () => {
  const html = readFileSync(new URL('../../site/charts.html', import.meta.url), 'utf8');
  for (const series of HEADER_SERIES) {
    const block = html.match(new RegExp(`<dl class="chart-stats" data-stats="${series}">([\\s\\S]*?)</dl>`));
    assert.ok(block, series);
    const labels = [...block[1].matchAll(/<dt>(.*?)<\/dt>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    assert.deepEqual(labels, chartHeader(series, null, Date.now()).map((x) => x.label), series);
    assert.ok([...block[1].matchAll(/<dd class="num">(.*?)<\/dd>/g)].every((m) => m[1] === '—'), series);
  }
});
