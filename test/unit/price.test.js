import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNonkyc, parseNeoxa, fetchQuotes, aggregate } from '../../worker/src/price.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import { nonkycBody, neoxaBody, NONKYC_URL, NEOXA_URL } from '../helpers/price-fixture.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('parsers pick the USD-stablecoin pair only', () => {
  assert.deepEqual(parseNonkyc('BTCB2_USDT')(nonkycBody()), {
    price: 849.52, volBase: 862.1255, volUsd: 766921.9755, high: 930, low: 839.07, changePct: -3, bid: 847.1, ask: 851.3,
  });
  // Neoxa's pools have no order book: no bid or ask
  assert.deepEqual(parseNeoxa('BTCB2_USDC')(neoxaBody()), {
    price: 858, volBase: 339.05801216, volUsd: 314650.22834067, high: 1087, low: 835.2, changePct: -3.878792478006718, bid: null, ask: null,
  });
});

test('missing pair after delisting fails only that venue', async () => {
  const delisted = neoxaBody();
  delisted.tickers = delisted.tickers.filter((t) => t.pair !== 'BTCB2_USDC');
  const quotes = await fetchQuotes(fakeFetch({ [NONKYC_URL]: nonkycBody(), [NEOXA_URL]: delisted }), 1_791_660_000_000);
  assert.equal(quotes.length, 3);
  assert.equal(quotes[0].ok, true);
  assert.equal(quotes[0].ts, 1_791_660_000);
  assert.equal(quotes[1].ok, false);
  assert.match(quotes[1].error, /BTCB2_USDC missing/);
  const agg = aggregate(quotes);
  assert.equal(agg.price, 849.52);
  assert.deepEqual(agg.venues.map((v) => v.label), ['NonKYC BTCB2/USDT']);
});

test('aggregate is volume-weighted when venues agree', async () => {
  const quotes = await fetchQuotes(fakeFetch({ [NONKYC_URL]: nonkycBody(), [NEOXA_URL]: neoxaBody() }), 0);
  const agg = aggregate(quotes);
  close(agg.price, 851.9869956632151);
  close(agg.changePct, -3.2556576924656353);
  close(agg.volUsd, 1081572.20384067);
  close(agg.volBase, 1201.18351216);
  assert.equal(agg.marketsDisagree, false);
  assert.equal(agg.high, 930); // from highest-volume venue
  assert.equal(agg.low, 839.07);
});

test('aggregate uses the highest-volume venue when venues differ by more than 10%', async () => {
  const neoxa = neoxaBody();
  neoxa.tickers[1].lastPrice = 1000;
  const quotes = await fetchQuotes(fakeFetch({ [NONKYC_URL]: nonkycBody(), [NEOXA_URL]: neoxa }), 0);
  const agg = aggregate(quotes);
  assert.equal(agg.marketsDisagree, true);
  assert.equal(agg.price, 849.52);
  assert.equal(agg.changePct, -3);
});

test('aggregate returns null when nothing is ok', () => {
  assert.equal(aggregate([{ ok: false }]), null);
  assert.equal(aggregate([]), null);
});

test('junk price fails the venue', async () => {
  const body = nonkycBody();
  body[1].last_price = '0';
  const quotes = await fetchQuotes(fakeFetch({ [NONKYC_URL]: body, [NEOXA_URL]: neoxaBody() }), 0);
  assert.equal(quotes[0].ok, false);
  assert.equal(quotes[1].ok, true);
});

test('the thin Neoxa XBT/USDT market is listed but kept out of the price', async () => {
  const fetchFn = fakeFetch({ [NONKYC_URL]: nonkycBody(), [NEOXA_URL]: neoxaBody() });
  const quotes = await fetchQuotes(fetchFn, 1_791_660_000_000);
  const usdt = quotes.find((q) => q.venue === 'neoxa:BTCB2_USDT');
  assert.equal(usdt.ok, true);
  assert.equal(usdt.inPrice, false);
  assert.equal(usdt.link, 'https://neoxa.exchange/trade/BTCB2_USDT');
  assert.equal(fetchFn.calls.filter((u) => u === NEOXA_URL).length, 1); // both Neoxa markets share one request
  const agg = aggregate(quotes);
  assert.deepEqual(agg.venues.map((v) => v.label), ['NonKYC BTCB2/USDT', 'Neoxa XBT/USDC']);
  // a wild price on the thin market cannot trip "markets disagree"
  const wild = quotes.map((q) => (q === usdt ? { ...q, price: 2000 } : q));
  assert.equal(aggregate(wild).marketsDisagree, false);
});

test('a bid or ask that is missing, zero or not a number becomes null', () => {
  const body = nonkycBody();
  const usdt = body.find((t) => t.ticker_id === 'BTCB2_USDT');
  usdt.bid = '';
  usdt.ask = '0';
  const t = parseNonkyc('BTCB2_USDT')(body);
  assert.equal(t.bid, null);
  assert.equal(t.ask, null);
});
