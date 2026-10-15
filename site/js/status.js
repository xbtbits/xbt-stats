// Freshness of the snapshot's sources, shared by the dashboard notices and the About
// page's Sources and status card.
export const CHAIN_STALE_MS = 10 * 60_000;
export const PRICE_STALE_MS = 20 * 60_000;

export function sourceStatus(s, now, offline = false) {
  const chain = s?.sources?.chain;
  const chainAge = chain ? now - chain.fetchedAt : Infinity;
  const priceAge = s?.price ? now - s.price.updatedAt : 0;
  const chainStale = chainAge > CHAIN_STALE_MS;
  const priceStale = s?.price != null && priceAge > PRICE_STALE_MS;
  let line;
  if (offline) line = 'Server unreachable';
  else if (chainStale || priceStale) line = [chainStale && 'Chain data stale', priceStale && 'Price stale'].filter(Boolean).join(', ');
  else line = s?.price ? 'All sources OK' : 'Waiting for the first price';
  return { chainAge, priceAge, chainStale, priceStale, line };
}
