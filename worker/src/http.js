export const ALLOWED_ORIGINS = new Set([
  'https://mempool.guide',
  'https://mempool.kilombino.com',
  'https://api.nonkyc.io',
  'https://neoxa.exchange',
  'https://lionthunderfingers.github.io', // B2B Node Census (node counts)
  'https://open.er-api.com', // exchange rates (world currencies card)
  'https://latest.currency-api.pages.dev', // exchange rates, backup
]);

export class UpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UpstreamError';
  }
}

async function fetchOk(fetchFn, url, accept, timeoutMs) {
  const { origin } = new URL(url);
  if (!ALLOWED_ORIGINS.has(origin)) throw new UpstreamError(`not allowed: ${origin}`);
  let res;
  try {
    res = await fetchFn(url, {
      headers: { accept },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new UpstreamError(`${origin}: ${err?.name === 'TimeoutError' ? 'timeout' : 'network error'}`);
  }
  if (res.status !== 200) throw new UpstreamError(`${origin}: HTTP ${res.status}`);
  return { res, origin };
}

export async function fetchJson(fetchFn, url, { timeoutMs = 5000 } = {}) {
  const { res, origin } = await fetchOk(fetchFn, url, 'application/json', timeoutMs);
  try {
    return await res.json();
  } catch {
    throw new UpstreamError(`${origin}: bad JSON`);
  }
}

export async function fetchText(fetchFn, url, { timeoutMs = 5000 } = {}) {
  const { res, origin } = await fetchOk(fetchFn, url, 'text/plain', timeoutMs);
  try {
    return (await res.text()).trim();
  } catch {
    throw new UpstreamError(`${origin}: bad body`);
  }
}

export async function fetchBytes(fetchFn, url, { timeoutMs = 10000, maxBytes = 5_000_000 } = {}) {
  const { res, origin } = await fetchOk(fetchFn, url, 'application/octet-stream', timeoutMs);
  if (Number(res.headers.get('content-length')) > maxBytes) throw new UpstreamError(`${origin}: too large`);
  let bytes;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new UpstreamError(`${origin}: bad body`);
  }
  if (bytes.length > maxBytes) throw new UpstreamError(`${origin}: too large`);
  return bytes;
}
