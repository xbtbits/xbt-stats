# Deploying XBT Stats

## One-time setup (owner)
1. Create a Cloudflare account with a dedicated email address. Turn on two-factor authentication or a passkey.
2. On this machine run `npx wrangler login` and approve in the browser.
3. Run `npx playwright install chromium` once, before the browser tests.
4. For a local preview, run `npx wrangler d1 execute xbt-stats --local --file=worker/schema.sql` once, then `npm run dev`.

## Create the database
```bash
npx wrangler d1 create xbt-stats
```
Copy the printed `database_id` into `wrangler.toml` (replacing the zeros), then:
```bash
npx wrangler d1 execute xbt-stats --remote --file=worker/schema.sql
```

## Deploy
```bash
npm test && npm run test:browser && npm run smoke:live
npx wrangler deploy
```
Wrangler prints the address, `https://xbt-stats.<account>.workers.dev`.

Worker errors: observability is off, so nothing is stored. Run `npx wrangler tail` to watch errors as they happen.

Note: the Cloudflare Cache API does not store responses on `*.workers.dev`. Until a custom domain is attached, only the in-memory 30-second cache works, which is fine at low traffic.

## Verify (about 15 minutes after the first deploy)
- `curl -s https://<address>/api/health`: `"ok": true` once the cron has run and a snapshot has been built. The cron fires every minute: the price job runs on every run, and the chain refresh (snapshot rebuild) runs every 5 minutes (when the UTC minute is a multiple of 5).
- Open the site on a phone and a computer. The price appears after the first cron run: the price job also maintains a one-row price summary in D1, so the price shows up about a minute after deploy.
- The first cron run also imports older price history once from Neoxa daily and hourly candles; the kv row `backfill:v1` records when. Check it with `npx wrangler d1 execute xbt-stats --remote --command "SELECT v FROM kv WHERE k = 'backfill:v1'"`. If it is missing after a few minutes, `npx wrangler tail` shows `backfill failed` with the reason; it retries at most once every 15 minutes and gives up after 20 failed attempts (`backfill gave up …` in the log; kv row `backfill:attempts` holds the count). To retry after that, delete `backfill:attempts`.
- Check the security headers: `curl -sI https://<address>/ | grep -iE 'content-security-policy|referrer-policy'`.
- Request every history series and range once while `npx wrangler tail` runs in another terminal. Any 503 or error 1102 means that series needs narrowing:
  ```bash
  for s in hashrate difficulty fees mempool blocksize; do for r in 1d 7d 1m 3m ytd 1y 5y 10y all; do curl -s -o /dev/null -w "$s $r %{http_code}\n" "https://<address>/api/history?series=$s&range=$r"; done; done
  for r in 1h 1d 7d 1m ytd 1y 5y all 30d 3m 10y; do curl -s -o /dev/null -w "price $r %{http_code}\n" "https://<address>/api/history?series=price&range=$r"; done
  ```
- After 15 quiet minutes (no visitors), check that `/api/health` is still `"ok": true`.
- Compare with mempool.guide and with an independent node: block height, difficulty, hashrate and fee estimates.
- Compare the price with the NonKYC and Neoxa market pages.
- Check that the supply matches the theoretical schedule at the current height.

## D1 budget
Free tier: 5,000,000 rows read and 100,000 rows written per day. Approximate use with the minute cron:
- Every minute: about 3 rows read and 4 written (quotes, the price summary, health).
- Every 5th minute: one 24-hour scan for the stored series `series:24h` (about 2,900 rows read with two venues), the hourly and daily roll-ups (about 400 rows read), and about 15 rows written. This is most of the reads: roughly 0.95 million a day.
- Visitors: the snapshot reads a handful of kv rows per rebuild (cached 30 s). `1d` history reads the stored series plus a few tail rows; longer ranges read the hourly and daily tables and are cached for an hour.
- Expected total: about 1 million rows read and 10,000 to 12,000 rows written per day, mostly independent of traffic.

Watch it in the Cloudflare dashboard: Storage & Databases → D1 → xbt-stats → Metrics (rows read and rows written per day). If rows read climb toward 2 million a day, look first for history requests that miss the cache (`npx wrangler tail`).

## If a market closes
If Neoxa's `BTCB2_USDC` pair disappears, the Neoxa venue fails quietly, NonKYC continues, and the source line drops Neoxa. `npm run smoke:live` then prints FAILED with `BTCB2_USDC missing`. The Converter page's Exchanges card drops a market an hour after its last good quote, so dead Neoxa links disappear on their own. To remove Neoxa for good: delete both Neoxa entries (XBT/USDC and the display-only XBT/USDT) from `VENUES` in `worker/src/price.js`, remove the Neoxa routes and expectations from the tests (including the `markets` rows in `test/fixtures/snapshot.json`), run `npm test`, and commit as `fix: remove closed Neoxa market`.

## Mempool chart past three months

The explorer's mempool statistics have no "all" interval, so the Mempool chart's 1Y, 5Y, 10Y and ALL use its 3-month series. Once the BLAKE2b chain is older than three months (after about 2026-11-28), those ranges start dropping the earliest days. Then change `STATS` in `worker/src/history.js` to use `'6m'`, later `'1y'`, for the long ranges.

## Before announcing
- The repository is public (MIT license) at https://github.com/xbtbits/xbt-stats, linked from the About page and every footer.
- Donation address: set in `site/index.html` (`data-address` on `<section id="donate">`), from a donation-only wallet, and pinned by a browser test. After any change, scan the QR on the live page with an XBT wallet and check every character before announcing.

## Custom domain
The site is served on `xbtstats.com` (`routes` in `wrangler.toml`, `custom_domain = true`; the domain uses Cloudflare DNS). With a custom domain set, the `workers.dev` address is off.

`www.xbtstats.com` is a separate redirect-only Worker (`worker/www/index.js`) that answers every request with a 301 to the same path on `https://xbtstats.com`. It is separate because the main Worker serves static files before its code runs, so it never sees requests for pages. Deploy it with:
```bash
npx wrangler deploy -c wrangler.www.toml
```

## Link previews
Every page carries a canonical link and Open Graph / Twitter tags (title and description match the page's own `<title>` and description) pointing at `https://xbtstats.com/og.png`, a 1200 x 630 image. Regenerate the image after a brand change with `node scripts/make-og.js` (it renders `scripts/og/og.html` with the site's CSS and LED wordmark). After deploying, check a page in a preview tool such as the X Card Validator or by pasting the link into a Discord DM; previews are cached by each app, sometimes for days.
