// Modeled on the B2B Node Census files (data.json, history.json, stable-nodes.json).
// Every address below is from the documentation ranges (RFC 5737 / RFC 3849): they
// stand in for the node addresses the real stable-nodes.json lists, which /api/nodes
// must never pass on.
export const CENSUS = 'https://lionthunderfingers.github.io/Bitcoin-Node-census';
export const DATA_URL = `${CENSUS}/data.json`;
export const HISTORY_URL = `${CENSUS}/history.json`;
export const STABLE_URL = `${CENSUS}/stable-nodes.json`;

export const FIXTURE_IPS = [
  '192.0.2.77', '198.51.100.23', '203.0.113.5', '198.51.100.140',
  '2001:db8::1', '2001:db8:85a3::8a2e:370:7334', '2001:db8:0:1::42',
];

export const TS = 1791669630;

export function censusData() {
  return {
    ts: TS,
    dump_ts: TS - 12,
    total: 24110,
    reachable: 9810,
    b2b: 1745,
    b2b_reachable: 962,
    b2b_polled_recently: 1396,
    b2b_poll_age_max: 86000,
    b2b_poll_age_median: 1800,
    b2b_poll_age_p90: 5400,
    max_height: 976603,
    activation_height: 973440,
    activation_end_height: 979920,
    heights: { tip: 945, near: 14, day: 1, behind: 2 },
    heights_by_enforcement: {
      enforcing: { tip: 803, near: 10, day: 1, behind: 2 },
      not_enforcing: { tip: 142, near: 4, day: 0, behind: 0 },
    },
    heights_by_version: {
      '/Satoshi:29.4.2(rachmaninoff.example)/Knots:20260508/': { tip: 1, near: 0, day: 0, behind: 0 },
    },
    versions: {
      '/Satoshi:29.4.2/Knots:20260508/': 774,
      '/Satoshi:29.4.1/Knots:20260508/': 60,
      '/Satoshi:29.4.1()/Knots:20260508/': 12,
      '/Satoshi:29.4.1/Knots:20260508rc4/': 47,
      '/Satoshi:29.4.2/Knots:20260508rc2/': 33,
      '/Satoshi:29.4.2(BIP110)/Knots:20260508rc2/': 10,
      '/Satoshi:29.4.1/Knots:20260508rc5/': 8,
      '/Satoshi:29.4.2/Knots:20260508/Plumb:6/': 6,
      '/OracleKnots:29.4.2(Forever Money)/OracleKnots:20260508/': 3,
      '/OracleKnots:29.4.2/OracleKnots:20260508/': 2,
      '/GrayersDad:08.30.2026=BLAKE2b/': 2,
      '/Satoshi:29.4.2/Knots:20260508/Plumb:5/': 1,
      '/Satoshi:29.4.3/Knots:20260508rc1/': 1,
      '/Satoshi:29.4.2(node at 192.0.2.77)/Knots:20260508/': 1,
      'odd agent': 1,
      '/Satoshi:28.1.0/': 1,
    },
    enforcing_versions: ['/Satoshi:29.4.2/Knots:20260508/', '/Satoshi:29.4.2/Knots:20260508rc2/'],
  };
}

// Hourly-ish, with the quirks of the real file: a duplicate, a point 20 s after the
// previous one, and one entry out of order.
export function censusHistory() {
  const h = (ts, b2b, reach, max, enf) => ({ ts, b2b, b2b_reachable: reach, max_height: max, enforcing: enf });
  return [
    h(1789792465, 313, 70, 972915, 0),
    h(1789792485, 313, 70, 972915, 0), // 20 s later: dropped
    h(1789796086, 319, 69, 972923, 0),
    h(1789796086, 319, 69, 972923, 0), // duplicate: dropped
    h(1791666026, 1742, 952, 976598, 812),
    h(1789799690, 330, 75, 972931, 5), // out of order
    h(1791662425, 1741, 957, 976589, 817),
    h(TS, 1745, 962, 976603, 816),
  ];
}

export function stableNodes() {
  return {
    generated: TS - 30,
    crawler_started: 1789790000,
    crawler_age_days: 21.7,
    criterion: { window: '1d', threshold_pct: 90, explanation: 'Reachable in at least 90% of polls over the last day.' },
    qualifying_count: 825,
    observed_count: 957,
    nodes: [
      { addr: '198.51.100.23:8333', uptime_pct: 99.1, ua: '/Satoshi:29.4.2/Knots:20260508/' },
      { addr: '[2001:db8:85a3::8a2e:370:7334]:8333', uptime_pct: 96.4, ua: '/Satoshi:29.4.2/Knots:20260508/' },
      { addr: '203.0.113.5:8333', uptime_pct: 92.0, ua: '/Satoshi:29.4.1/Knots:20260508rc4/' },
    ],
    all_reachable: ['198.51.100.23:8333', '203.0.113.5:8333', '198.51.100.140:8333', '[2001:db8::1]:8333', '[2001:db8:0:1::42]:8333'],
  };
}

export function censusRoutes({ data = censusData(), history = censusHistory(), stable = stableNodes() } = {}) {
  return { [DATA_URL]: data, [HISTORY_URL]: history, [STABLE_URL]: stable };
}
