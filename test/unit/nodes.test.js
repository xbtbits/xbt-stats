import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNodes, prettyUserAgent, groupVersions, nodeHistory, CENSUS_SOURCE } from '../../worker/src/nodes.js';
import { ALLOWED_ORIGINS } from '../../worker/src/http.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import {
  censusData, censusHistory, censusRoutes, stableNodes, DATA_URL, HISTORY_URL, STABLE_URL, FIXTURE_IPS, TS,
} from '../helpers/nodes-fixture.js';

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const IPV6 = /\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/i;

test('the census origin is on the upstream allowlist', () => {
  assert.ok(ALLOWED_ORIGINS.has('https://lionthunderfingers.github.io'));
});

test('prettyUserAgent: client first, then the base version and its comment', () => {
  assert.equal(prettyUserAgent('/Satoshi:29.4.2/Knots:20260508/'), 'Knots 20260508 · 29.4.2');
  assert.equal(prettyUserAgent('/Satoshi:29.4.2(BIP110)/Knots:20260508rc2/'), 'Knots 20260508rc2 · 29.4.2 (BIP110)');
  assert.equal(prettyUserAgent('/Satoshi:29.4.2/Knots:20260508/Plumb:6/'), 'Plumb 6 · Knots 20260508 · 29.4.2');
  assert.equal(prettyUserAgent('/Satoshi:29.4.1()/Knots:20260508/'), 'Knots 20260508 · 29.4.1');
  assert.equal(prettyUserAgent('/OracleKnots:29.4.2(Forever Money)/OracleKnots:20260508/'), 'OracleKnots 20260508 · OracleKnots 29.4.2 (Forever Money)');
  assert.equal(prettyUserAgent('/GrayersDad:08.30.2026=BLAKE2b/'), 'GrayersDad 08.30.2026=BLAKE2b');
  assert.equal(prettyUserAgent('/Satoshi:28.1.0/'), 'Satoshi 28.1.0');
});

test('prettyUserAgent: unknown shapes are the raw string without slashes', () => {
  assert.equal(prettyUserAgent('odd agent'), 'odd agent');
  assert.equal(prettyUserAgent('/weird//thing/'), 'weird thing');
  assert.equal(prettyUserAgent('/Satoshi:29.4.2/Knots:20260508'), 'Satoshi:29.4.2 Knots:20260508');
  assert.equal(prettyUserAgent(''), 'Unknown');
  assert.equal(prettyUserAgent('x'.repeat(200)).length, 80);
});

test('prettyUserAgent never passes on an address a node put in its comment', () => {
  const ua = prettyUserAgent('/Satoshi:29.4.2(node at 192.0.2.77)/Knots:20260508/');
  assert.equal(ua, 'Knots 20260508 · 29.4.2 (node at …)');
  assert.doesNotMatch(prettyUserAgent('/Satoshi:29.4.2(2001:db8::1)/Knots:20260508/'), IPV6);
});

test('groupVersions: grouped by pretty name, sorted by count, enforcing if any member enforces', () => {
  const v = groupVersions({ '/Satoshi:29.4.1/Knots:20260508/': 60, '/Satoshi:29.4.1()/Knots:20260508/': 12, '/Satoshi:29.4.2/Knots:20260508/': 774 },
    ['/Satoshi:29.4.1()/Knots:20260508/']);
  assert.deepEqual(v, [
    { ua: 'Knots 20260508 · 29.4.2', raw: '/Satoshi:29.4.2/Knots:20260508/', count: 774, enforcing: false },
    { ua: 'Knots 20260508 · 29.4.1', raw: '/Satoshi:29.4.1/Knots:20260508/', count: 72, enforcing: true },
  ]);
});

test('groupVersions: at most 12 entries plus an Other bucket', () => {
  const data = censusData();
  const v = groupVersions(data.versions, data.enforcing_versions);
  assert.equal(v.length, 13);
  assert.deepEqual(v.at(-1), { ua: 'Other', raw: null, count: 3, enforcing: false });
  assert.equal(v.reduce((s, x) => s + x.count, 0), 962);
  assert.deepEqual(v.slice(0, 4).map((x) => [x.ua, x.count, x.enforcing]), [
    ['Knots 20260508 · 29.4.2', 774, true],
    ['Knots 20260508 · 29.4.1', 72, false],
    ['Knots 20260508rc4 · 29.4.1', 47, false],
    ['Knots 20260508rc2 · 29.4.2', 33, true],
  ]);
  const few = groupVersions({ '/Satoshi:28.1.0/': 2 }, []);
  assert.deepEqual(few, [{ ua: 'Satoshi 28.1.0', raw: '/Satoshi:28.1.0/', count: 2, enforcing: false }]);
});

test('nodeHistory: sorted, close points dropped, last 2,000 kept', () => {
  assert.deepEqual(nodeHistory(censusHistory()), [
    [1789792465, 70, 313, 0],
    [1789796086, 69, 319, 0],
    [1789799690, 75, 330, 5],
    [1791662425, 957, 1741, 817],
    [1791666026, 952, 1742, 812],
    [TS, 962, 1745, 816],
  ]);
  const long = Array.from({ length: 2100 }, (_, i) => ({ ts: 1_789_000_000 + i * 3600, b2b: i, b2b_reachable: i, max_height: 1, enforcing: 0 }));
  const kept = nodeHistory(long);
  assert.equal(kept.length, 2000);
  assert.equal(kept[0][0], 1_789_000_000 + 100 * 3600);
  assert.equal(kept.at(-1)[0], 1_789_000_000 + 2099 * 3600);
});

test('nodeHistory skips malformed entries and rejects a non-array', () => {
  const pts = nodeHistory([{ ts: 'x', b2b: 1, b2b_reachable: 1, enforcing: 0 }, null, { ts: 1789792465, b2b: 3, b2b_reachable: 2, enforcing: 1 }]);
  assert.deepEqual(pts, [[1789792465, 2, 3, 1]]);
  assert.throws(() => nodeHistory({}), /history/);
});

test('fetchNodes builds the /api/nodes body from the three census files', async () => {
  const fetchFn = fakeFetch(censusRoutes());
  const body = await fetchNodes(fetchFn);
  assert.deepEqual(fetchFn.calls.sort(), [DATA_URL, HISTORY_URL, STABLE_URL].sort());
  assert.equal(body.v, 1);
  assert.equal(body.updatedAt, TS * 1000);
  assert.deepEqual(body.source, CENSUS_SOURCE);
  assert.deepEqual(body.source, { name: 'B2B Node Census', url: 'https://github.com/LionThunderFingers/Bitcoin-Node-census' });
  assert.equal(body.reachable, 962);
  assert.equal(body.known, 1745);
  assert.equal(body.responding, 1396);
  assert.deepEqual(body.stable, { count: 825, observed: 957, window: '1d', thresholdPct: 90 });
  assert.equal(body.maxHeight, 976603);
  assert.deepEqual(body.softFork, { name: 'Coinbase lock (45-day)', startHeight: 973440, endHeight: 979920, enforcing: 816, notEnforcing: 146 });
  assert.deepEqual(body.sync, { tip: 945, near: 14, day: 1, behind: 2 });
  assert.equal(body.versions.length, 13);
  assert.equal(body.history.length, 6);
  assert.deepEqual(Object.keys(body).sort(), ['history', 'known', 'maxHeight', 'reachable', 'responding', 'softFork', 'source', 'stable', 'sync', 'updatedAt', 'v', 'versions'].sort());
});

test('the response never contains a node address from the census', async () => {
  const body = JSON.stringify(await fetchNodes(fakeFetch(censusRoutes())));
  for (const ip of FIXTURE_IPS) assert.equal(body.includes(ip), false, ip);
  assert.doesNotMatch(body, IPV4);
  assert.doesNotMatch(body, IPV6);
  assert.equal(body.includes('8333'), false);
  assert.equal(body.includes('uptime'), false);
});

test('a failing stable-nodes file only blanks the stable count', async () => {
  for (const stable of [{ status: 503, body: 'down' }, { criterion: {}, nodes: [] }, new TypeError('boom')]) {
    const body = await fetchNodes(fakeFetch({ ...censusRoutes(), [STABLE_URL]: stable }));
    assert.equal(body.stable, null);
    assert.equal(body.reachable, 962);
  }
});

test('a failing data or history file fails the whole response', async () => {
  await assert.rejects(fetchNodes(fakeFetch({ ...censusRoutes(), [DATA_URL]: { status: 503, body: 'down' } })), /HTTP 503/);
  await assert.rejects(fetchNodes(fakeFetch({ ...censusRoutes(), [HISTORY_URL]: { status: 404, body: 'gone' } })), /HTTP 404/);
  const bad = censusData();
  bad.b2b_reachable = -1;
  await assert.rejects(fetchNodes(fakeFetch(censusRoutes({ data: bad }))), /negative/);
  const noSync = censusData();
  delete noSync.heights_by_enforcement;
  await assert.rejects(fetchNodes(fakeFetch(censusRoutes({ data: noSync }))), /not a finite number/);
});

test('stable window is a short plain label', async () => {
  const stable = stableNodes();
  stable.criterion.window = '<b>1d</b> and a very long label indeed';
  const body = await fetchNodes(fakeFetch(censusRoutes({ stable })));
  assert.equal(body.stable, null);
});
