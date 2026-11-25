// Run this locally to test the bot with `node local.js` (uses long polling, no Vercel needed)
const bot = require('./bot');

bot.launch();
console.log('Bot is running locally with long polling. Ctrl+C to stop.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
