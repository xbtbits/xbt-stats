export const DAILY_CANDLES_URL = 'https://neoxa.exchange/api/exchange/candles/BTCB2_USDC?interval=1d';
export const HOURLY_CANDLES_URL = 'https://neoxa.exchange/api/exchange/candles/BTCB2_USDC?interval=1h&limit=1000';

export const D0 = Date.UTC(2026, 7, 31) / 1000; // Aug 31, 2026, the first daily candle
export const H0 = Date.UTC(2026, 8, 20) / 1000; // Sep 20, 2026, the first hourly candle

const candle = (time, close, extra = {}) => ({ time, open: close, high: close, low: close, close, volume: 3, ...extra });

export function dailyCandlesBody() {
  return {
    success: true, pair: 'BTCB2_USDC', interval: '1d',
    candles: [candle(D0, 500), candle(D0 + 86400, 900), candle(D0 + 2 * 86400, 'abc')],
  };
}

export function hourlyCandlesBody() {
  return {
    success: true, pair: 'BTCB2_USDC', interval: '1h',
    candles: [
      candle(H0, 800, { high: 5000 }), // an intraday spike: the high never counts
      candle(H0 + 3600, 1200),
      candle(H0 + 7200, -5), // junk
      candle(H0 + 10800, 1100),
    ],
  };
}

export function candleRoutes() {
  return { [DAILY_CANDLES_URL]: dailyCandlesBody(), [HOURLY_CANDLES_URL]: hourlyCandlesBody() };
}
