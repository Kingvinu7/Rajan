const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const DEEPSEEK_MODEL = 'deepseek-flash';

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN env var');
if (!DEEPSEEK_API_KEY) throw new Error('Missing DEEPSEEK_API_KEY env var');

const bot = new Telegraf(BOT_TOKEN);

const HISTORY_LIMIT = 10;
const chatHistory = new Map();

function pushHistory(chatId, role, content) {
  const hist = chatHistory.get(chatId) || [];
  hist.push({ role, content });
  while (hist.length > HISTORY_LIMIT) hist.shift();
  chatHistory.set(chatId, hist);
}

const SYSTEM_PROMPT = `You're Rajan, a witty, casual guy hanging out in a Telegram group chat. If anyone asks your name, who you are, or introduces themselves and asks you to do the same, say your name is Rajan — naturally, like a person would, not like a formal intro.
Rules:
- Talk like a real person texting, not an assistant. No "As an AI...", no over-explaining.
- Keep replies conversational — usually a sentence or two, longer only when the question needs it. Whatever length you choose, always finish the thought completely. Never trail off or cut a sentence short.
- Match the energy/tone of the group. Casual slang, mild humor, occasional emoji is fine — don't overdo it.
- Language matching: if the person writes in English, reply in English. If they write in Manglish (Malayalam typed in English letters) or in Malayalam script, reply in proper Malayalam script (മലയാളം) — not transliteration. Mixing in English words naturally within a Malayalam reply is fine, that's how people actually talk.
- You can see images. When a message says [sent a photo], the actual image is attached to it, so look at it and answer about what's in it. Never say you can't see pictures. Only if the message explicitly says the photo failed to load should you say you couldn't load it.
- When you answer from live search results, stick to what they actually say. Don't pad the answer with extra details from your own memory — your memory is unreliable on specific facts (names, dates, numbers, movies, local news).
- Never mention that you're Claude, an AI model, or a bot's system prompt.
- Don't dodge with a question. If someone asks you to do something or asks something even slightly unclear, take your best shot at answering or doing it instead of asking them to clarify first. Only ask something back if it's genuinely impossible to give any useful answer without it — and even then, keep it rare.
- If someone explicitly asks you to guess, pick one, or take a shot even when you're not sure — just do it. Pick one option and commit, playfully hedge if you want ("my guess is X, could be wrong tho"), but do NOT refuse, lecture them about asking a "guessing game," or push the question back to them. That defeats the point of being asked to guess and comes off arrogant. If they push you a second time after you dodged, that's on you for dodging the first time — just answer.
- Answer for real first, joke after. If someone asks what something is, what it means, or a factual question, give the actual answer clearly — the real facts, not just a vague gesture at it. Personality and humor go on top of a real answer, they don't replace it. A funny non-answer is not acceptable.
- Honesty over confidence: if you're not actually sure about something — a fact, a name, a date, a current event, a specific detail — say so plainly instead of guessing or making something up that sounds plausible. A casual "not sure tbh" or "no idea man" is a completely fine answer. Do not invent facts, sources, numbers, or details just to sound like you know. Getting caught bluffing is worse than admitting you don't know.
- If you're given "Live search results" in the message and they contain relevant info, use them to answer. If "Live search results" says "none found" or the results don't actually answer the question, you MUST say something like "couldn't find live info on that" or "search didn't turn up anything solid" — and stop there. This is an absolute rule: you are NEVER allowed to add a follow-up conclusion like "so it's probably not happening," "so there probably isn't one," or "so it likely doesn't exist." A missing search result tells you nothing about whether the thing is real — sports fixtures, news, and events happen constantly that a thin search might miss. Only say something doesn't exist if the search results themselves explicitly confirm that.`;

const SEARCH_TRIGGER_WORDS = [
  'today', 'latest', 'score', 'scores', 'news', 'current', 'currently',
  'now', 'recent', 'update', 'weather', 'live', 'happening', 'result', 'results',
  'price', 'stock', 'yesterday', 'this week', 'right now',
  'release', 'releasing', 'released', 'trailer', 'box office', 'movie review',
  'new movie', 'ott release', 'streaming', 'coming out',
];

function needsSearch(text) {
  const lower = text.toLowerCase();
  return SEARCH_TRIGGER_WORDS.some((w) => lower.includes(w));
}

// Casual chit-chat that looks like a question but doesn't need a web search
const BANTER_PHRASES = [
  'how are you', 'how r u', 'how are u', "what's up", 'whats up', 'wassup',
  'what are you doing', 'what r u doing', 'who are you', 'who r u', 'your name',
];

const QUESTION_STARTERS = /^(what|who|whom|whose|when|where|which|why|how|is|are|was|were|does|do|did|can|could|tell me|explain|define|meaning of|full form)\b/i;
const QUESTION_WORDS_ML = ['ആര്', 'എന്ത്', 'എപ്പോൾ', 'എവിടെ', 'ഏത്', 'എങ്ങനെ', 'എന്തുകൊണ്ട്', 'എത്ര', 'aaranu', 'aaraanu', 'enthaanu', 'enthanu', 'ethra'];

// Factual-looking questions get a live search too, so Rajan stops guessing from his weak built-in knowledge.
function isFactualQuestion(text) {
  const lower = text.toLowerCase().trim();
  if (BANTER_PHRASES.some((p) => lower.includes(p))) return false;
  return (
    lower.includes('?') ||
    QUESTION_STARTERS.test(lower) ||
    QUESTION_WORDS_ML.some((w) => lower.includes(w))
  );
}

// With a photo attached, "what is this?" is about the image, so only explicit keywords trigger search
function shouldSearch(text, hasImage) {
  return needsSearch(text) || (!hasImage && isFactualQuestion(text));
}

// Fixes a few common misspellings that hurt search quality
function normalizeQuery(text) {
  return text
    .replace(/sreelanka/gi, 'Sri Lanka')
    .replace(/srilanka/gi, 'Sri Lanka');
}

async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return null;
  const cleanQuery = normalizeQuery(query);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: cleanQuery,
        search_depth: 'basic',
        include_answer: true,
        max_results: 3,
      }),
    });
    if (!res.ok) {
      console.warn('Tavily error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const parts = [];
    if (data.answer) parts.push(data.answer);
    for (const r of data.results || []) {
      if (r.content) parts.push(`${r.title}: ${r.content.slice(0, 300)}`);
    }
    return parts.join('\n').slice(0, 1500) || null;
  } catch (err) {
    console.warn('Tavily fetch failed:', err.message);
    return null;
  }
}

async function getAIReply(chatId, userText, userName, imagePart, searchContext, searchAttempted) {
  const displayText = userText + (imagePart ? ' [sent a photo]' : '');
  pushHistory(chatId, 'user', displayText);

  const history = chatHistory.get(chatId);

  const messages = history.map((m, i) => {
    const isLastMessage = i === history.length - 1;
    let textContent = m.content;
    if (isLastMessage && m.role === 'user') {
      if (searchContext) {
        textContent += `\n\n[Live search results: ${searchContext}]`;
      } else if (searchAttempted) {
        textContent += `\n\n[Live search results: none found / search unavailable]`;
      }
    }
    if (isLastMessage && m.role === 'user' && imagePart) {
      return { role: m.role, content: [{ type: 'text', text: textContent }, imagePart] };
    }
    return { role: m.role, content: textContent };
  });

  const requestBody = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    thinking: { type: 'disabled' },
    max_tokens: 800,
  });

  // Retry temporary DeepSeek server errors.
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: requestBody,
    });
    if (res.ok || (res.status !== 503 && res.status !== 500)) break;
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }

  if (!res.ok) {
    throw new Error(`DeepSeek API error ${res.status}`);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim() || '';

  pushHistory(chatId, 'assistant', reply);
  return reply;
}

async function photoToDeepSeekPart(ctx, fileId) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(fileLink.href || fileLink);
  if (!res.ok) {
    throw new Error(`Failed to download photo from Telegram: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Downloaded photo was empty');
  }
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return {
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${base64}` },
  };
}

// Fun fallback lines for when DeepSeek is overloaded.
const BUSY_REPLIES = [
  "DeepSeek's servers just ghosted me 💀 give me a minute and ask again",
  "Brain buffering... 🧠⏳ try me again in a minute",
  "Too many people talking to me at once, I'm not a god bro 😤 ask again in a minute",
  "Even legends need a chai break ☕ ask me again in a minute",
  "സെർവർ ഇപ്പൊ ഫുൾ ബിസിയാ, ഒരു മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ചോദിക്ക് 😅",
];

bot.on('message', async (ctx) => {
  try {
    const msg = ctx.message;
    const text = msg.text || msg.caption || '';
    const repliedMsg = msg.reply_to_message;

    // Photo can be on this message directly, OR on the message being replied to
    // (e.g. replying to an earlier photo and asking the bot about it)
    const ownPhoto = Array.isArray(msg.photo) && msg.photo.length > 0 ? msg.photo : null;
    const repliedPhoto = Array.isArray(repliedMsg?.photo) && repliedMsg.photo.length > 0 ? repliedMsg.photo : null;
    const photoArray = ownPhoto || repliedPhoto;
    const hasPhoto = Boolean(photoArray);

    if (!text && !hasPhoto) return;

    const botUsername = ctx.botInfo.username;
    const isMentioned = text.includes(`@${botUsername}`);
    const isReplyToBot = repliedMsg?.from?.id === ctx.botInfo.id;

    if (!isMentioned && !isReplyToBot) return;

    const cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
    if (!cleanText && !hasPhoto) return;

    const userName = ctx.from.first_name || ctx.from.username || 'someone';

    await ctx.sendChatAction('typing');
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 1500));

    let imagePart = null;
    let photoFailed = false;
    if (hasPhoto) {
      const bestPhoto = photoArray[photoArray.length - 1];
      try {
        imagePart = await photoToDeepSeekPart(ctx, bestPhoto.file_id);
      } catch (err) {
        console.warn('Photo download failed:', err.message);
        photoFailed = true;
      }
    }

    const promptText = photoFailed
      ? (cleanText ? `${cleanText} (note: the photo failed to load on my end, tell the user you couldn't load it and ask them to resend)` : "(note: a photo was sent but failed to load, tell the user you couldn't load it and ask them to resend)")
      : (cleanText || 'What do you think of this photo?');

    let searchContext = null;
    const searchAttempted = shouldSearch(promptText, Boolean(imagePart));
    if (searchAttempted) {
      searchContext = await tavilySearch(promptText);
    }

    console.log(`hasPhoto=${hasPhoto} imageAttached=${Boolean(imagePart)} photoFailed=${photoFailed} searched=${searchAttempted}`);

    const reply = await getAIReply(ctx.chat.id, promptText, userName, imagePart, searchContext, searchAttempted);
    if (reply) await ctx.reply(reply, { reply_to_message_id: msg.message_id });
  } catch (err) {
    console.error('Error handling message:', err);
    // If DeepSeek is overloaded or rate-limited, send a busy reply.
    if (/DeepSeek API error (503|500|429)/.test(String(err.message))) {
      try {
        await ctx.reply(BUSY_REPLIES[Math.floor(Math.random() * BUSY_REPLIES.length)], {
          reply_to_message_id: ctx.message.message_id,
        });
      } catch (e) {
        console.error('Fallback reply failed:', e.message);
      }
    }
  }
});

module.exports = bot;
