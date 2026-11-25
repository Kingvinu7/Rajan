const PRICE = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7 });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
let fontRegistered = false;

function formatPrice(value) {
  return value > 0 && value < 0.000001 ? value.toExponential(3) : PRICE.format(value);
}

function renderMarketChart(chart) {
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  if (!fontRegistered) {
    const fontPath = require.resolve('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2');
    GlobalFonts.registerFromPath(fontPath, 'Rajan Chart Mono');
    fontRegistered = true;
  }

  const canvas = createCanvas(1120, 680);
  const ctx = canvas.getContext('2d');
  const { candles } = chart;
  const first = candles[0];
  const last = candles.at(-1);
  const change = 100 * (last.close / first.open - 1);
  const candleSeconds = chart.minutes * 60;
  const start = first.time;
  const end = last.time + candleSeconds;
  const maxVolume = Math.max(...candles.map((candle) => candle.volume ?? 0));
  const bottom = maxVolume > 0 ? 503 : 609;
  const plot = { left: 48, right: 970, top: 145, bottom };
  const peak = Math.max(...candles.map((candle) => candle.high));
  const trough = Math.min(...candles.map((candle) => candle.low));
  const padding = Math.max((peak - trough) * 0.08, peak * 0.00005);
  const low = Math.max(0, trough - padding);
  const high = peak + padding;
  const x = (time) => plot.left + (time - start) / (end - start) * (plot.right - plot.left);
  const y = (price) => plot.bottom - (price - low) / (high - low) * (plot.bottom - plot.top);
  const candleWidth = Math.max(1, Math.min(18, (x(start + candleSeconds) - plot.left) * 0.68));

  ctx.fillStyle = '#101722';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '34px "Rajan Chart Mono", monospace';
  ctx.fillStyle = '#eef4fc';
  ctx.fillText(chart.title.slice(0, 34), 48, 60);
  ctx.font = '16px "Rajan Chart Mono", monospace';
  ctx.fillStyle = '#aab7cb';
  ctx.fillText(`${chart.venue.slice(0, 46)} · ${chart.interval} candles · ${chart.currency}`, 48, 93);

  ctx.textAlign = 'right';
  ctx.font = '30px "Rajan Chart Mono", monospace';
  ctx.fillStyle = '#eef4fc';
  ctx.fillText(`${formatPrice(last.close)} ${chart.currency}`, 1072, 60);
  ctx.font = '16px "Rajan Chart Mono", monospace';
  ctx.fillStyle = change >= 0 ? '#63d9b5' : '#ff8990';
  ctx.fillText(`${change >= 0 ? '+' : ''}${change.toFixed(2)}% from first open`, 1072, 93);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#121c29';
  ctx.fillRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  ctx.font = '14px "Rajan Chart Mono", monospace';
  ctx.strokeStyle = '#263446';
  ctx.fillStyle = '#aab7cb';
  for (let i = 0; i <= 5; i++) {
    const price = low + i * (high - low) / 5;
    const lineY = y(price);
    ctx.beginPath();
    ctx.moveTo(plot.left, lineY);
    ctx.lineTo(plot.right, lineY);
    ctx.stroke();
    ctx.fillText(formatPrice(price), plot.right + 12, lineY + 5);
  }

  for (const candle of candles) {
    const center = x(candle.time + candleSeconds / 2);
    const color = candle.close >= candle.open ? '#42c7a0' : '#ee6673';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(center, y(candle.high));
    ctx.lineTo(center, y(candle.low));
    ctx.stroke();
    const body = Math.min(y(candle.open), y(candle.close));
    const bodyHeight = Math.max(1.4, Math.abs(y(candle.close) - y(candle.open)));
    ctx.fillRect(center - candleWidth / 2, body, candleWidth, bodyHeight);
    if (maxVolume > 0 && candle.volume > 0) {
      const barHeight = 70 * candle.volume / maxVolume;
      ctx.globalAlpha = 0.43;
      ctx.fillRect(center - candleWidth / 2, 608 - barHeight, candleWidth, barHeight);
      ctx.globalAlpha = 1;
    }
  }

  ctx.fillStyle = '#aab7cb';
  if (maxVolume > 0) ctx.fillText('Volume', plot.left, 529);
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const timestamp = start + i * (end - start) / 4;
    const date = new Date(timestamp * 1000);
    const label = end - start <= 172800 ? `${DAY.format(date)} ${TIME.format(date)}` : DAY.format(date);
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(label, x(timestamp), 644);
  }
  ctx.textAlign = 'left';
  ctx.fillText('UTC', plot.right + 12, 644);
  return canvas.toBuffer('image/png');
}

module.exports = { formatPrice, renderMarketChart };
