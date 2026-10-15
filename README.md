# XBT Stats

Live statistics for XBT, the Bitcoin BLAKE2b chain: price, blocks, mining, difficulty, fees, mempool, supply, halving and nodes.

**Site:** https://xbtstats.com

Free, ad-free and tracker-free. No cookies, no analytics, no accounts.

## Where the numbers come from

- **Chain data:** public mempool explorers for the BLAKE2b chain ([mempool.guide](https://mempool.guide), cross-checked against [mempool.kilombino.com](https://mempool.kilombino.com)).
- **Price:** USD-stablecoin markets only (USDT and USDC counted as $1), weighted by 24-hour volume: NonKYC BTCB2/USDT and Neoxa XBT/USDC. No BTC-quoted pairs.
- **Node counts:** the [B2B Node Census](https://github.com/LionThunderFingers/Bitcoin-Node-census). The site shows counts only, never node addresses.
- **World currencies:** daily exchange rates from [ExchangeRate-API](https://www.exchangerate-api.com), with the public-domain [Currency API](https://github.com/fawazahmed0/exchange-api) as backup.

Every number shows how old it is. If a source stops answering, the site keeps the last good data and labels it.

Your browser only talks to xbtstats.com. A Cloudflare Worker fetches the sources, caches them and records price history in a D1 database.

## How it is built

- `site/`: plain HTML, CSS and JavaScript. No framework, no build step. Charts use [uPlot](https://github.com/leeoniya/uPlot), self-hosted with the fonts.
- `worker/`: the Cloudflare Worker. It serves the site and the `/api/*` endpoints, and a cron runs every minute to record prices and refresh the snapshot.
- `test/`: unit tests (Node's built-in runner) and browser tests (Playwright).
- `scripts/`: icon and link-preview image generators, and a live smoke check.

## Run it locally

Needs Node 24 or newer.

```bash
npm install
npx playwright install chromium
npm test                # unit tests
npm run test:browser    # browser tests against fixtures
```

For a local preview with the Worker, see [docs/deploy.md](docs/deploy.md).

## Deploy your own

[docs/deploy.md](docs/deploy.md) covers the Cloudflare account, D1 database, deploy and checks.

## API

The site's own JSON endpoints are public and read-only:

- `GET /api/snapshot`: everything on the dashboard (refreshed every minute, cached 30 s).
- `GET /api/history?series=<name>&range=<range>`: chart data. Series: `price`, `hashrate`, `difficulty`, `fees`, `mempool`, `blocksize`, `pools`.
- `GET /api/nodes`: node counts from the census.
- `GET /api/block`: data found in the newest block (OP_RETURN and inscriptions).
- `GET /api/fx`: USD exchange rates for the world-currencies card.
- `GET /api/health`: data freshness.

Please cache on your side and keep requests modest.

## Support

If you find it useful, a donation in XBT helps keep it running:

`bc1q0m70hu6z59l2kffwwk0sfdd0f94z9y6gjzta2s`

## License

MIT. See [LICENSE](LICENSE).

Not financial advice. Data is provided as is. XBT is not BTC: they are separate coins on separate chains.
