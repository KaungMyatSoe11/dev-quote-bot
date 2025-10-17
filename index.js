// package.json deps: "discord.js": "^14.16.3", "node-cron": "^3.0.3", "undici": "^6.19.8", "dotenv": "^16.4.5"
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import cron from 'node-cron';
import { fetch } from 'undici';

const {
  DISCORD_BOT_TOKEN,
  DISCORD_CHANNEL_ID,        // e.g. 123456789012345678
  AI_MODE,                  // "ollama" or "openai"
  AI_MODEL = "llama3.1",
  AI_API_URL,               // e.g. OpenAI: https://api.openai.com/v1/chat/completions
  AI_API_KEY,
  TIMEZONE = "Asia/Yangon", // your tz
  DAILY_CRON = "0 9 * * *", // 9:00 AM every day
  LANGUAGE = "EN_MM"        // "EN", "MM", or "EN_MM" (both)
} = process.env;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });


// add near other env reads
const SEND_NOW = process.env.SEND_NOW === '1';

// ...inside client.once('ready', ...)
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  cron.schedule(DAILY_CRON, postDailyQuote, { timezone: TIMEZONE });

  // 🔥 send immediately when you want a quick test
  if (SEND_NOW) {
    postDailyQuote().then(() => console.log('Test quote sent immediately.'));
  }
});




/** Prompt tuned for short, developer-focused motivation */
function buildPrompt(contextLines = []) {
  const ctx = contextLines.length ? `Context:\n- ${contextLines.join('\n- ')}\n` : '';
  return `
You are a friendly CTO sending a single short motivational quote to a small dev team shipping products in Myanmar.
${ctx}
Requirements:
- 1–2 sentences MAX, punchy.
- Focus on engineering momentum, code quality, learning, teamwork, shipping.
- Avoid clichés; be concrete.
- If LANGUAGE=EN -> English only.
- If LANGUAGE=MM -> Myanmar (Burmese) only.
- If LANGUAGE=EN_MM -> Give English line then Myanmar line on the next line.

Return ONLY the quote text. No extra commentary.`;
}

/** Call AI (Ollama local or OpenAI-compatible) */
async function generateQuote(contextLines = []) {
  const prompt = buildPrompt(contextLines);
  try {
    if (AI_MODE === 'ollama') {
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: AI_MODEL, prompt, stream: false })
      });
      const data = await res.json();
      return (data.response || '').trim();
    } else {
      // OpenAI-compatible Chat Completions
      const res = await fetch(AI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AI_API_KEY ? { 'Authorization': `Bearer ${AI_API_KEY}` } : {})
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 120
        })
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return text.trim();
    }
  } catch (e) {
    console.error('AI error:', e);
    return null;
  }
}

/** Optionally pull context from ClickUp (last 24h tasks) */
async function fetchClickUpContext() {
  const { CLICKUP_TOKEN, CLICKUP_TEAM_ID } = process.env;
  if (!CLICKUP_TOKEN || !CLICKUP_TEAM_ID) return [];

  try {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const url = `https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/task?date_updated_gt=${since}&include_closed=true`;
    const res = await fetch(url, { headers: { Authorization: CLICKUP_TOKEN }});
    const data = await res.json();
    const tasks = (data.tasks || []).slice(0, 5); // keep short
    return tasks.map(t => {
      const title = t.name || 'Untitled';
      const status = t.status?.status || 'unknown';
      return `Task "${title}" — status: ${status}`;
    });
  } catch (e) {
    console.error('ClickUp fetch error:', e);
    return [];
  }
}

/** Post the quote */
async function postDailyQuote() {
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const ctx = await fetchClickUpContext(); // can be empty if not configured
  const quote = await generateQuote(ctx);

  // Fallbacks if AI fails
  const fallbacksEN = [
    "Small commits, big momentum. Ship something today.",
    "Readability is a feature. Future you will thank present you."
  ];
  const fallbacksMM = [
    "နေ့တိုင်းအနည်းငယ်တိုးတက်ပါ—အဆုံးမှာကြီးမားတဲ့အမှတ်တံဆိပ်ဖြစ်မယ်။",
    "စိတ်ရှည်ပြီး ကုဒ်ကို သန့်ရှင်း စာလုံးဖတ်ရလွယ်အောင် ရေးပါ—နောင်တချိန်က သင့်ကိုယ်တိုင်ပဲ ကျေးဇူးတင်မယ်။"
  ];

  let text = quote;
  if (!text) {
    if (LANGUAGE === 'MM') text = fallbacksMM[0];
    else if (LANGUAGE === 'EN_MM') text = `${fallbacksEN[0]}\n${fallbacksMM[0]}`;
    else text = fallbacksEN[0];
  }

  const header = "🌞 **Daily Dev Motivation**";
  await channel.send(`${header}\n${text}`);
  console.log('Sent daily quote.');
}

/** Schedule the job */
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  // Cron syntax: min hour dom month dow
  cron.schedule(DAILY_CRON, postDailyQuote, { timezone: TIMEZONE });
  // Optional: send immediately on boot for testing
  // postDailyQuote();
});

client.login(DISCORD_BOT_TOKEN);
