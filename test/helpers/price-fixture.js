export const NONKYC_URL = 'https://api.nonkyc.io/api/v2/tickers';
export const NEOXA_URL = 'https://neoxa.exchange/api/exchange/tickers';

export function nonkycBody() {
  return [
    { ticker_id: 'BTCB2_BTC', base_currency: 'BTCB2', target_currency: 'BTC', last_price: '0.01025411', base_volume: '728.6116', target_volume: '7.8360', high: '0.0115', low: '0.0099', change_percent: '-2.75' },
    { ticker_id: 'BTCB2_USDT', base_currency: 'BTCB2', target_currency: 'USDT', last_price: '849.52', base_volume: '862.1255', target_volume: '766921.9755', high: '930', low: '839.07', change_percent: '-3.00', bid: '847.10', ask: '851.30' },
  ];
}

export function neoxaBody() {
  return {
    success: true,
    tickers: [
      { pair: 'BTCB2_BTC', lastPrice: 0.01014041, volume24h: 923.2, quoteVolume24h: 10.58, high24h: 0.0138, low24h: 0.0085, changePercent24h: -5.2 },
      { pair: 'BTCB2_USDC', lastPrice: 858, volume24h: 339.05801216, quoteVolume24h: 314650.22834067, high24h: 1087, low24h: 835.2, changePercent24h: -3.878792478006718 },
      { pair: 'BTCB2_USDT', lastPrice: 861.2, volume24h: 11.2, quoteVolume24h: 9650.4, high24h: 900, low24h: 830, changePercent24h: -2.1 },
    ],
  };
}
