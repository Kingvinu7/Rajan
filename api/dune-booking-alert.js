const { createHash, createPublicKey, verify } = require('node:crypto');

const expiresAt = Date.parse('2026-12-22T00:00:00+05:30');
const seatPath = /^\/movies\/(?:coim|coimbatore)\/seat-layout\/ET00526290\/BWCB\/\d+\/20261221\/?$/i;
const showtimePattern = /^(?:0?[1-9]|1[0-2]):[0-5]\d [AP]M$/;
const testExpiresAt = Date.parse('2026-11-29T12:45:00+05:30');
const testBookingUrl = 'https://in.bookmyshow.com/movies/coim/seat-layout/ET00523959/BWCB/56877/20261129';
const deploymentScope = require('../dune-alert-public-scope.json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (Date.now() >= expiresAt) return res.status(410).json({ error: 'This alert expired.' });

  const { BOT_TOKEN, DUNE_ALERT_PUBLIC_KEY, DUNE_ALERT_CHAT_ID, DUNE_ALERT_TOPIC_ID, DUNE_ALERT_MENTION } = process.env;
  if (!BOT_TOKEN) return res.status(503).json({ error: 'Rajan alert is not configured.' });

  const { payload, signature } = req.body || {};
  if (typeof payload !== 'string' || payload.length > 768 || typeof signature !== 'string' || signature.length !== 86) {
    return res.status(400).json({ error: 'Invalid signed request.' });
  }

  let alert;
  try {
    const encodedKey = DUNE_ALERT_PUBLIC_KEY || deploymentScope.publicKey;
    const key = createPublicKey({ key: Buffer.from(encodedKey, 'base64url'), format: 'der', type: 'spki' });
    const signed = Buffer.from(payload, 'base64url');
    if (!verify(null, signed, key, Buffer.from(signature, 'base64url'))) {
      return res.status(401).json({ error: 'Invalid signature.' });
    }
    alert = JSON.parse(signed);
  } catch {
    return res.status(400).json({ error: 'Invalid signed request.' });
  }

  if (!Number.isSafeInteger(alert?.issuedAt) || Math.abs(Date.now() - alert.issuedAt) > 60_000) {
    return res.status(400).json({ error: 'Expired signed request.' });
  }

  const destination = DUNE_ALERT_PUBLIC_KEY
    ? [Number(DUNE_ALERT_CHAT_ID), Number(DUNE_ALERT_TOPIC_ID), DUNE_ALERT_MENTION]
    : alert.destination;
  if (!Array.isArray(destination)) return res.status(403).json({ error: 'Destination not authorized.' });
  if (!DUNE_ALERT_PUBLIC_KEY) {
    const fingerprint = createHash('sha256').update(JSON.stringify(destination)).digest('hex');
    if (fingerprint !== deploymentScope.destinationFingerprint) {
      return res.status(403).json({ error: 'Destination not authorized.' });
    }
  }
  const [chatId, topicId, mention] = destination;
  if (!Number.isSafeInteger(chatId) || chatId >= -1000000000000 || !Number.isSafeInteger(topicId) ||
    topicId <= 1 || !/^@[A-Za-z0-9_]{4,32}$/.test(mention)) {
    return res.status(503).json({ error: 'Rajan alert destination is not configured.' });
  }

  let bookingUrl;
  try {
    bookingUrl = new URL(alert.bookingUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid booking link.' });
  }
  const isTest = alert.test === 'ramayana-imax';
  if (isTest) {
    if (Date.now() >= testExpiresAt) return res.status(410).json({ error: 'The Ramayana IMAX test expired.' });
    if (bookingUrl.href !== testBookingUrl || alert.showtime !== '12:45 PM') {
      return res.status(400).json({ error: 'Expected the verified Ramayana IMAX test show.' });
    }
  } else if (bookingUrl.origin !== 'https://in.bookmyshow.com' || !seatPath.test(bookingUrl.pathname) ||
    bookingUrl.username || bookingUrl.password || bookingUrl.search || bookingUrl.hash ||
    !showtimePattern.test(alert.showtime)) {
    return res.status(400).json({ error: 'Expected a December 21 Broadway IMAX seat link and showtime.' });
  }

  const message = isTest
    ? 'TEST booking alert for Ramayana IMAX 3D at Broadway Cinemas, Coimbatore, on 29 Nov at 12:45 PM IST.'
    : `Dune: Part Three IMAX bookings are open for Monday, 21 Dec at Broadway Cinemas, Coimbatore. ${alert.showtime} IST`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_thread_id: topicId,
        text: `${mention} ${message}\n${bookingUrl.href}`,
        entities: [{ type: 'mention', offset: 0, length: mention.length }],
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return res.status(502).json({ error: 'Telegram rejected the alert.', telegramCode: result.error_code });
    }
    return res.status(200).json({ ok: true, messageId: result.result.message_id });
  } catch {
    return res.status(502).json({ error: 'Delivery is unconfirmed. Check the Telegram topic before retrying.' });
  }
};
