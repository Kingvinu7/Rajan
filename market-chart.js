const { formatPrice } = require('./render-market-chart');

const CHART_HELP = 'Try /chart BTC 4h, /chart ETH/USD 15m, or /chart followed by a DexScreener, GeckoTerminal or CoinGecko link.';
const SPOT_INTERVALS = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080 };
const DEX_INTERVALS = {
  '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15],
  '1h': ['hour', 1], '4h': ['hour', 4], '12h': ['hour', 12], '1d': ['day', 1],
};
const COIN_INTERVALS = { '30m': [1, 30], '4h': [7, 240], '4d': [180, 5760] };
const NETWORK_IDS = { ethereum: 'eth', polygon: 'polygon_pos', avalanche: 'avax', zksync: 'zksync', xlayer: 'x-layer' };
const ASSET_ALIASES = { BITCOIN: 'BTC', XBT: 'BTC', ETHEREUM: 'ETH', SOLANA: 'SOL', DOGECOIN: 'DOGE' };
const CHART_CANDLE_LIMIT = 52;
const CHART_CACHE_MS = 60_000;
const cache = new Map();

const TRACKER_URL = /(?:^|[\s(<])((?:https?:\/\/)?(?:www\.)?(?:dexscreener\.com|geckoterminal\.com|coingecko\.com)\/[^\s<>()]+)/i;
const CHART_WORD = /\b(?:chart|candles?|candlesticks?)\b|ചാർട്ട്/iu;
const TIMEFRAME = /\b(\d{1,3}[mhdw])\b/i;
const MARKET = /^\$?([a-z0-9]{2,15})(?:[/\-]([a-z0-9]{2,12}))?$/i;
const MARKET_COMPACT = /^([a-z0-9]{2,12})(USDT|USDC|USD|EUR|GBP)$/i;
const POOL_ADDRESS = /^[a-z0-9._:-]{2,160}$/i;
const COIN_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/i;

class ChartUnavailable extends Error {}

function parseTracker(rawLink, interval) {
  const url = new URL(/^https?:/i.test(rawLink) ? rawLink : `https://${rawLink}`);
  const host = url.hostname.replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'dexscreener.com' && parts.length === 2 && parts.every((part) => POOL_ADDRESS.test(part))) {
    return { source: 'dexscreener', chain: parts[0].toLowerCase(), address: parts[1], interval };
  }
  if (host === 'geckoterminal.com' && parts.length === 3 && parts[1] === 'pools'
    && POOL_ADDRESS.test(parts[0]) && POOL_ADDRESS.test(parts[2])) {
    return { source: 'geckoterminal', chain: parts[0].toLowerCase(), address: parts[2], interval };
  }
  if (host === 'coingecko.com' && parts.at(-2) === 'coins' && COIN_ID.test(parts.at(-1) ?? '')) {
    return { source: 'coingecko', id: parts.at(-1).toLowerCase(), interval };
  }
  return { source: 'help' };
}

function parseChartRequest(text, explicitCommand = false) {
  const input = text.replace(/^\/chart\b\s*/i, '').trim();
  const tracker = input.match(TRACKER_URL)?.[1];
  const outsideLink = (tracker ? input.replace(tracker, '') : input).trim();
  const interval = outsideLink.match(TIMEFRAME)?.[1].toLowerCase() ?? '4h';
  if (tracker && (explicitCommand || CHART_WORD.test(outsideLink) || !outsideLink.replace(TIMEFRAME, '').trim())) {
    return parseTracker(tracker.replace(/[.,!?]+$/u, ''), interval);
  }

  const shorthand = outsideLink
    .replace(TIMEFRAME, '')
    .replace(/\s+/g, ' ')
    .replace(/[?!]+$/u, '')
    .trim();
  const natural = shorthand
    .replace(/^(?:can you )?(?:send|show|get|generate)(?: me)? (?:(?:the|a) )?/i, '')
    .replace(/\s+(?:please|pls|thaa|tharu|tharumo|താ|തരാമോ)$/iu, '');
  const subject = explicitCommand ? shorthand : natural.match(
    /^(?:\$?([a-z0-9/\-]+) (?:price )?(?:chart|candles?|candlesticks?|ചാർട്ട്)|(?:price )?(?:chart|candles?|candlesticks?|ചാർട്ട്)(?: for)? (\$?[a-z0-9/\-]+))$/iu,
  )?.slice(1).find(Boolean);
  const parsed = subject?.match(MARKET);
  if (!parsed) return explicitCommand ? { source: 'help' } : null;
  if (!explicitCommand && /^(?:about|also|another|here|me|one|that|the|this|what|you)$/i.test(parsed[1])) return null;

  let base = parsed[1].toUpperCase();
  let quote = parsed[2]?.toUpperCase();
  if (!quote) {
    const compact = base.match(MARKET_COMPACT);
    if (compact) [, base, quote] = compact;
  }
  return { source: 'kraken', base: ASSET_ALIASES[base] ?? base, quote: quote ?? 'USD', interval };
}

function trackerLink(request) {
  switch (request.source) {
    case 'kraken': return `https://pro.kraken.com/app/trade/${request.base.toLowerCase()}-${request.quote.toLowerCase()}`;
    case 'coingecko': return `https://www.coingecko.com/en/coins/${request.id}`;
    case 'dexscreener': return `https://dexscreener.com/${request.chain}/${encodeURIComponent(request.address)}`;
    case 'geckoterminal': return `https://www.geckoterminal.com/${request.chain}/pools/${encodeURIComponent(request.address)}`;
    default: return '';
  }
}

async function priceApi(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(9000) });
  if (response.status === 429) throw new ChartUnavailable('The price feed is busy. Give it a minute and try again.');
  if (response.status === 404) throw new ChartUnavailable('I couldn’t find candle data for that market.');
  if (!response.ok) throw new Error(`Price feed returned HTTP ${response.status}`);
  return response.json();
}

function validCandles(rows, minutes) {
  const latestOpen = Math.floor(Date.now() / 1000) - minutes * 60;
  return rows.filter(({ time, open, high, low, close, volume }) => (
    Number.isInteger(time) && time > 0 && time <= latestOpen
    && [open, high, low, close].every((price) => Number.isFinite(price) && price > 0)
    && high >= Math.max(open, close) && low <= Math.min(open, close)
    && (volume === null || (Number.isFinite(volume) && volume >= 0))
  )).sort((a, b) => a.time - b.time).slice(-CHART_CANDLE_LIMIT);
}

async function krakenChart(request) {
  const { base, quote, interval } = request;
  const minutes = SPOT_INTERVALS[interval];
  if (!minutes) throw new ChartUnavailable(`Kraken intervals: ${Object.keys(SPOT_INTERVALS).join(', ')}.`);

  const query = new URLSearchParams({ pair: `${base}${quote}`, interval: minutes });
  const data = await priceApi(`https://api.kraken.com/0/public/OHLC?${query}`);
  if (data.error?.some((error) => error.includes('Unknown asset pair'))) {
    throw new ChartUnavailable('I couldn’t find that pair on Kraken. Send a DexScreener, GeckoTerminal or CoinGecko link for the exact market.');
  }
  if (data.error?.length) throw new Error('Kraken could not return candles');
  const bars = Object.values(data.result ?? {}).find(Array.isArray) ?? [];
  const rows = bars.slice(0, -1).map(([time, open, high, low, close, , volume]) => ({
    time: Number(time), open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume),
  }));
  return { title: `${base}/${quote}`, venue: 'Kraken spot', currency: quote, minutes, rows };
}

async function coinGeckoChart({ id, interval }) {
  if (!COIN_INTERVALS[interval]) throw new ChartUnavailable('CoinGecko coin charts support 30m, 4h, or 4d candles.');
  const [days, minutes] = COIN_INTERVALS[interval];
  const query = new URLSearchParams({ vs_currency: 'usd', days });
  const key = process.env.COINGECKO_DEMO_API_KEY;
  const headers = key ? { 'x-cg-demo-api-key': key } : {};
  const data = await priceApi(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/ohlc?${query}`, headers);
  if (!Array.isArray(data)) throw new Error('CoinGecko returned invalid candles');
  const rows = data.map(([closedAt, open, high, low, close]) => ({
    time: closedAt / 1000 - minutes * 60, open, high, low, close, volume: null,
  }));
  return { title: id.replaceAll('-', ' '), venue: 'CoinGecko', currency: 'USD', minutes, rows };
}

async function dexChart(request) {
  const { source, chain, interval } = request;
  if (!DEX_INTERVALS[interval]) throw new ChartUnavailable(`DEX intervals: ${Object.keys(DEX_INTERVALS).join(', ')}.`);
  const [timeframe, aggregate] = DEX_INTERVALS[interval];
  const minutes = aggregate * { minute: 1, hour: 60, day: 1440 }[timeframe];
  let address = request.address;
  let dex = '';
  if (source === 'dexscreener') {
    const pairs = await priceApi(`https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`);
    const pool = pairs.pairs?.find((pair) => {
      if (pair.chainId !== chain || !POOL_ADDRESS.test(pair.pairAddress ?? '')) return false;
      if (pair.pairAddress === address) return true;
      if (address.startsWith('0x') && pair.pairAddress.toLowerCase() === address.toLowerCase()) return true;
      // DexScreener's public Solana URLs use a lowercase slug for the case-sensitive pool address.
      const publishedLink = pair.url?.match(TRACKER_URL)?.[1];
      if (!publishedLink) return false;
      const listing = parseTracker(publishedLink, interval);
      return listing.source === 'dexscreener' && listing.chain === chain && listing.address === address;
    });
    if (!pool) throw new ChartUnavailable('I couldn’t find the exact pool from that DexScreener link.');
    address = pool.pairAddress;
    dex = pool.dexId ? ` / ${pool.dexId}` : '';
  }
  const network = source === 'dexscreener' && Object.hasOwn(NETWORK_IDS, chain) ? NETWORK_IDS[chain] : chain;
  const query = new URLSearchParams({ aggregate, limit: CHART_CANDLE_LIMIT + 1, currency: 'usd', token: 'base' });
  const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(address)}/ohlcv/${timeframe}?${query}`;
  const data = await priceApi(url, { Accept: 'application/json;version=20230203' });
  const base = data.meta?.base?.symbol || 'Pool base token';
  const quote = data.meta?.quote?.symbol;
  const title = quote ? `${base}/${quote} pool` : base;
  const rows = (data.data?.attributes?.ohlcv_list ?? []).map(([time, open, high, low, close, volume]) => ({
    time, open, high, low, close, volume,
  }));
  return { title, venue: `GeckoTerminal / ${chain}${dex}`, currency: 'USD', minutes, rows };
}

async function loadChart(request) {
  let data;
  switch (request.source) {
    case 'kraken': data = await krakenChart(request); break;
    case 'coingecko': data = await coinGeckoChart(request); break;
    default: data = await dexChart(request);
  }
  const { rows, ...chart } = data;
  const candles = validCandles(rows, chart.minutes);
  if (candles.length < 2) throw new ChartUnavailable('There aren’t enough closed candles to chart yet.');
  return { ...chart, candles, interval: request.interval, link: trackerLink(request) };
}

function getMarketChart(request) {
  const key = JSON.stringify(request);
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;

  const result = loadChart(request).catch((error) => {
    if (cache.get(key)?.result === result) cache.delete(key);
    throw error;
  });
  cache.delete(key);
  cache.set(key, { result, until: Date.now() + CHART_CACHE_MS });
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return result;
}

function chartCaption(chart) {
  const last = chart.candles.at(-1);
  const closed = new Date((last.time + chart.minutes * 60) * 1000);
  const time = closed.toISOString().slice(0, 16).replace('T', ' ');
  return `${chart.title.slice(0, 72)} · ${chart.interval} candles\nLast closed: ${formatPrice(last.close)} ${chart.currency} at ${time} UTC\n${chart.venue.slice(0, 100)}\n${chart.link}`;
}

module.exports = { CHART_HELP, ChartUnavailable, parseChartRequest, getMarketChart, chartCaption, trackerLink };
