const bot = require('../bot');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('Bot is running.');
    return;
  }

  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).send('OK'); // always 200 so Telegram doesn't retry-storm
  }
};
