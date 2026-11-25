# Human Chat Bot

A Telegram bot that only speaks when @mentioned or replied to — replies like a person, not a bot with commands.

## 1. Create the bot
1. Message @BotFather on Telegram → `/newbot` → get your `BOT_TOKEN`.
2. Send `/setprivacy` to @BotFather → select your bot → choose **Disable**.
   (This lets it *see* group messages at all — it still only replies when mentioned, that logic is in the code.)

## 2. Get a DeepSeek API key
Create a key in the [DeepSeek API platform](https://platform.deepseek.com/api_keys) and set it as `DEEPSEEK_API_KEY`.

## 3. Test locally first
```
npm install
BOT_TOKEN=xxx DEEPSEEK_API_KEY=xxx node local.js
```
Add the bot to a test group, @mention it, confirm it replies.

## 4. Deploy to Vercel
```
vercel
```
Then in the Vercel dashboard → Project → Settings → Environment Variables, add:
- `BOT_TOKEN`
- `DEEPSEEK_API_KEY`

Redeploy after adding env vars.

## 5. Set the Telegram webhook
Once deployed, point Telegram at your Vercel URL (one-time):
```
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-vercel-domain>/api/webhook"
```

Done — add the bot to any group, @mention it or reply to its messages, and it'll respond casually.

## Notes
- Chat history is in-memory per chat (last 10 messages) — resets on cold start. Fine for banter; swap in a KV store if you want persistence.
- Tweak the `SYSTEM_PROMPT` in `bot.js` to change personality/tone.
