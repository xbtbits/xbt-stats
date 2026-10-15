import { fetchChain, crossCheckTip, buildChainSections } from '../worker/src/explorer.js';
import { fetchQuotes, aggregate } from '../worker/src/price.js';
import { fmtHashrate, fmtXbt } from '../site/js/format.js';

const fetchFn = (url, init) => fetch(url, init);

const live = await fetchChain(fetchFn, null);
if (!live.chain) {
  console.error('Explorers failed:', live.errors);
  process.exit(1);
}
const s = buildChainSections(live.chain, Date.now());
const cross = await crossCheckTip(fetchFn, live.source);
console.log(`chain: ${live.source} tip ${live.chain.tip}; cross-check ${cross.name} tip ${cross.tip}`);
console.log(`supply ${fmtXbt(s.chain.supplySats)}, hashrate ${fmtHashrate(live.chain.hashrate)}, blocks to clear ${s.mempool.blocksToClear}`);

const quotes = await fetchQuotes(fetchFn, Date.now());
for (const q of quotes) console.log(q.ok ? `${q.label}: $${q.price}` : `${q.label}: FAILED (${q.error})`);
const agg = aggregate(quotes);
if (!agg) {
  console.error('All price venues failed');
  process.exit(1);
}
console.log(`headline $${agg.price.toFixed(2)}${agg.marketsDisagree ? ' (markets disagree)' : ''}`);
