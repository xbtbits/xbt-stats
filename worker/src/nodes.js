import { fetchJson } from './http.js';
import { num, nonNeg, ValidationError } from './validate.js';

// B2B Node Census: an independent crawler of the BLAKE2b fork's node network, published
// hourly on GitHub Pages. Only counts are read. stable-nodes.json also lists node
// addresses: nothing but its four count/criterion fields is ever read from it.
const CENSUS = 'https://lionthunderfingers.github.io/Bitcoin-Node-census';
export const CENSUS_URLS = {
  data: `${CENSUS}/data.json`,
  history: `${CENSUS}/history.json`,
  stable: `${CENSUS}/stable-nodes.json`,
};
export const CENSUS_SOURCE = { name: 'B2B Node Census', url: 'https://github.com/LionThunderFingers/Bitcoin-Node-census' };

const TIMEOUT_MS = 8000;
const MAX_VERSIONS = 12;
const MAX_HISTORY = 2000;
const MIN_GAP_SEC = 300;
const UA_MAX = 80;
const RAW_MAX = 120;

// A node can put anything in its user-agent comment, an address included: hide it.
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV6 = /\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/gi;
const hideAddresses = (s) => s.replace(IPV4, '…').replace(IPV6, '…');

const PART = /^([^:()/]+):([^()/]*)(?:\(([^/]*)\))?$/;

// "/Satoshi:29.4.2(BIP110)/Knots:20260508rc2/" -> "Knots 20260508rc2 · 29.4.2 (BIP110)".
// The most specific client comes first; the Satoshi base shows as its version only.
export function prettyUserAgent(raw) {
  const s = hideAddresses(String(raw ?? '')).replace(/\s+/g, ' ').trim();
  const parts = s.length > 2 && s.startsWith('/') && s.endsWith('/') ? s.slice(1, -1).split('/') : null;
  const matches = parts?.map((p) => PART.exec(p));
  let out;
  if (matches && matches.every(Boolean)) {
    out = matches.reverse().map(([, name, version, comment]) => {
      const base = name === 'Satoshi' && matches.length > 1 ? version : `${name} ${version}`.trim();
      return comment?.trim() ? `${base} (${comment.trim()})` : base;
    }).join(' · ');
  } else {
    out = s.split('/').filter((p) => p.trim()).map((p) => p.trim()).join(' ');
  }
  return out.slice(0, UA_MAX) || 'Unknown';
}

// Raw user agents -> grouped by pretty name, largest first, 12 at most plus "Other".
export function groupVersions(versions, enforcingVersions) {
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) throw new ValidationError('versions: not an object');
  const enforcing = new Set(Array.isArray(enforcingVersions) ? enforcingVersions : []);
  const groups = new Map();
  for (const [raw, value] of Object.entries(versions)) {
    const count = nonNeg(value, 'version count');
    const ua = prettyUserAgent(raw);
    const g = groups.get(ua) ?? { ua, raw: null, count: 0, enforcing: false, top: -1 };
    g.count += count;
    g.enforcing ||= enforcing.has(raw);
    if (count > g.top) { g.top = count; g.raw = hideAddresses(raw).slice(0, RAW_MAX); }
    groups.set(ua, g);
  }
  const sorted = [...groups.values()]
    .map(({ ua, raw, count, enforcing: e }) => ({ ua, raw, count, enforcing: e }))
    .sort((a, b) => b.count - a.count || (a.ua < b.ua ? -1 : a.ua > b.ua ? 1 : 0));
  const top = sorted.slice(0, MAX_VERSIONS);
  const other = sorted.slice(MAX_VERSIONS).reduce((sum, v) => sum + v.count, 0);
  if (other > 0) top.push({ ua: 'Other', raw: null, count: other, enforcing: false });
  return top;
}

// [[tsSec, reachable, known, enforcing], ...]: ascending, no two points within 5 minutes,
// the newest 2,000. Malformed entries are skipped.
export function nodeHistory(entries) {
  if (!Array.isArray(entries)) throw new ValidationError('history: not an array');
  const points = [];
  for (const e of entries) {
    try {
      const enforcing = e.enforcing == null ? null : nonNeg(e.enforcing, 'enforcing');
      points.push([num(e.ts, 'ts'), nonNeg(e.b2b_reachable, 'reachable'), nonNeg(e.b2b, 'known'), enforcing]);
    } catch {
      // skip
    }
  }
  points.sort((a, b) => a[0] - b[0]);
  const kept = [];
  for (const p of points) {
    if (kept.length === 0 || p[0] - kept.at(-1)[0] >= MIN_GAP_SEC) kept.push(p);
  }
  return kept.slice(-MAX_HISTORY);
}

function syncCounts(h, label) {
  return {
    tip: nonNeg(h?.tip, `${label}.tip`),
    near: nonNeg(h?.near, `${label}.near`),
    day: nonNeg(h?.day, `${label}.day`),
    behind: nonNeg(h?.behind, `${label}.behind`),
  };
}

const total = (s) => s.tip + s.near + s.day + s.behind;

// Only the four count/criterion fields; never anything else from this file.
function parseStable(s) {
  const window = s?.criterion?.window;
  if (typeof window !== 'string' || !/^\d{1,4}[a-z]{1,3}$/i.test(window)) throw new ValidationError('stable window');
  const thresholdPct = nonNeg(s.criterion.threshold_pct, 'threshold_pct');
  if (thresholdPct > 100) throw new ValidationError('threshold_pct: over 100');
  return {
    count: nonNeg(s.qualifying_count, 'qualifying_count'),
    observed: nonNeg(s.observed_count, 'observed_count'),
    window,
    thresholdPct,
  };
}

export async function fetchNodes(fetchFn) {
  const opts = { timeoutMs: TIMEOUT_MS };
  // A missing or malformed stable-nodes file only blanks the stable count.
  const stable = fetchJson(fetchFn, CENSUS_URLS.stable, opts).then(parseStable).catch(() => null);
  const [data, history] = await Promise.all([
    fetchJson(fetchFn, CENSUS_URLS.data, opts),
    fetchJson(fetchFn, CENSUS_URLS.history, opts),
  ]);
  const byEnforcement = data?.heights_by_enforcement;
  return {
    v: 1,
    updatedAt: nonNeg(data?.ts, 'ts') * 1000,
    source: { ...CENSUS_SOURCE },
    reachable: nonNeg(data.b2b_reachable, 'b2b_reachable'),
    known: nonNeg(data.b2b, 'b2b'),
    responding: nonNeg(data.b2b_polled_recently, 'b2b_polled_recently'),
    stable: await stable,
    maxHeight: nonNeg(data.max_height, 'max_height'),
    softFork: {
      name: 'Coinbase lock (45-day)',
      startHeight: nonNeg(data.activation_height, 'activation_height'),
      endHeight: nonNeg(data.activation_end_height, 'activation_end_height'),
      enforcing: total(syncCounts(byEnforcement?.enforcing, 'enforcing')),
      notEnforcing: total(syncCounts(byEnforcement?.not_enforcing, 'not_enforcing')),
    },
    sync: syncCounts(data.heights, 'heights'),
    versions: groupVersions(data.versions, data.enforcing_versions),
    history: nodeHistory(history),
  };
}
