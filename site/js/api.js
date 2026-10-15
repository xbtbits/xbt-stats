const TIMEOUT_MS = 10_000; // a stuck request gives up instead of leaving the page waiting
const RETRY_MS = 2_000; // one quick retry for a dropped connection or a server hiccup

async function fetchJsonOnce(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Client errors (4xx) are final; a timeout, network error or server error (5xx) is tried once more.
async function getJson(path) {
  try {
    return await fetchJsonOnce(path);
  } catch (err) {
    if (err?.status >= 400 && err.status < 500) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    return fetchJsonOnce(path);
  }
}

export const getSnapshot = () => getJson('/api/snapshot');
export const getNodes = () => getJson('/api/nodes');
export const getFx = () => getJson('/api/fx');
export const getBlock = () => getJson('/api/block');
export const getHistory = (series, range) =>
  getJson(`/api/history?series=${encodeURIComponent(series)}&range=${encodeURIComponent(range)}`);
