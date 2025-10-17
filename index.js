import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, Events } from 'discord.js';
import cron from 'node-cron';
import { fetch } from 'undici';

const {
  DISCORD_BOT_TOKEN,
  DISCORD_CHANNEL_ID,
  AI_MODE,
  AI_MODEL,
  AI_API_URL,
  AI_API_KEY,
  TIMEZONE = 'Asia/Yangon',
  DAILY_CRON = '0 9 * * *',
  LANGUAGE = 'EN_MM',
  DISCORD_WEBHOOK_URL,
  OLLAMA_URL,
  AI_MAX_TOKENS,
  AI_TEMPERATURE,
  OPENROUTER_REFERER,
  OPENROUTER_TITLE
} = process.env;

const SEND_NOW = process.env.SEND_NOW === '1';
const USE_WEBHOOK = !!DISCORD_WEBHOOK_URL;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Create client only in bot mode
const client = !USE_WEBHOOK ? new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] }) : null;

// Boot and scheduling
if (USE_WEBHOOK) {
  console.log('Running in Webhook mode (no Discord client).');
  cron.schedule(DAILY_CRON, postDailyQuote, { timezone: TIMEZONE });
  if (SEND_NOW) postDailyQuote().then(() => console.log('Test quote sent via webhook.'));
} else {
  client.login(DISCORD_BOT_TOKEN);
}

// Bot ready
if (!USE_WEBHOOK && client) {
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
    client.user.setPresence({ activities: [{ name: 'Daily Dev Quotes' }], status: 'online' });
    console.log(`Status: online, ping=${client.ws.ping}ms`);
    console.log('Guilds:', [...client.guilds.cache.values()].map(g => `${g.name} (${g.id})`).join(', '));
    cron.schedule(DAILY_CRON, postDailyQuote, { timezone: TIMEZONE });
    if (SEND_NOW) { await postDailyQuote(); console.log('Test quote send attempted.'); }
  });
}

function buildPrompt(contextLines = []) {
  const ctx = contextLines.length ? `Context:\n- ${contextLines.join('\n- ')}\n` : '';
  return `\nYou are a friendly CTO sending a single short motivational quote to a small dev team shipping products in Myanmar.\n${ctx}Requirements:\n- 1–2 sentences MAX, punchy.\n- Focus on engineering momentum, code quality, learning, teamwork, shipping.\n- Avoid clichés; be concrete.\n- If LANGUAGE=EN -> English only.\n- If LANGUAGE=MM -> Myanmar (Burmese) only.\n- If LANGUAGE=EN_MM -> Give English line then Myanmar line on the next line.\n\nReturn ONLY the quote text. No extra commentary.`;
}

async function generateQuote(contextLines = []) {
  const prompt = buildPrompt(contextLines);
  try {

    const endpoint = AI_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
    const model = AI_MODEL || 'qwen/qwen3-coder:free';
    const maxTokens = Number(AI_MAX_TOKENS ?? '') || 120;
    const temperature = Number(AI_TEMPERATURE ?? '') || 0.8;
    const headers = {
      'Authorization': `Bearer ${AI_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    // if (endpoint.includes('openrouter.ai')) {
    //   if (OPENROUTER_REFERER) headers['HTTP-Referer'] = OPENROUTER_REFERER;
    //   if (OPENROUTER_TITLE) headers['X-Title'] = OPENROUTER_TITLE;
    // }

    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature, max_tokens: maxTokens })
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const raw = data?.choices?.[0]?.message?.content || '';
        const tokens = ['<|begin_of_text|>', '<|end_of_text|>', '<｜begin▁of▁sentence｜>', '<s>', '</s>', '<BOS>', '<EOS>', '<|im_start|>', '<|im_end|>'];
        let cleaned = raw;
        for (const t of tokens) cleaned = cleaned.split(t).join('');
        return cleaned.trim();
      }
      lastErr = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 429) {
        const waitMs = 600 * (attempt + 1);
        console.warn(`Rate limited (429). Retrying in ${waitMs}ms...`);
        await delay(waitMs);
        continue;
      }
      console.error('OpenAI error:', lastErr);
      return null;
    }
    console.error('OpenAI error after retries:', lastErr);
    return null;

  } catch (e) {
    console.error('AI error:', e);
    return null;
  }
}

async function fetchClickUpContext() {
  const { CLICKUP_TOKEN, CLICKUP_TEAM_ID } = process.env;
  if (!CLICKUP_TOKEN || !CLICKUP_TEAM_ID) return [];
  try {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const url = `https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/task?date_updated_gt=${since}&include_closed=true`;
    const res = await fetch(url, { headers: { Authorization: CLICKUP_TOKEN } });
    const data = await res.json();
    const tasks = (data.tasks || []).slice(0, 5);
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

async function postDailyQuote() {
  const ctx = await fetchClickUpContext();
  const quote = await generateQuote(ctx);
  const fallbacksEN = [
    'Small commits, big momentum. Ship something today.',
    'Readability is a feature. Future you will thank present you.'
  ];
  const fallbacksMM = [
    'နေ့တိုင်းအနည်းငယ်တိုးတက်ပါ—အဆုံးမှာကြီးမားတဲ့အမှတ်တံဆိပ်ဖြစ်မယ်။',
    'စိတ်ရှည်ပြီး ကုဒ်ကို သန့်ရှင်း စာလုံးဖတ်ရလွယ်အောင် ရေးပါ—နောင်တချိန်က သင့်ကိုယ်တိုင်ပဲ ကျေးဇူးတင်မယ်။'
  ];
  let text = quote;
  if (!text) {
    if (LANGUAGE === 'MM') text = fallbacksMM[0];
    else if (LANGUAGE === 'EN_MM') text = `${fallbacksEN[0]}\n${fallbacksMM[0]}`;
    else text = fallbacksEN[0];
  }
  const payloadText = `🌞 **Daily Dev Motivation**\n${text}`;
  if (USE_WEBHOOK) {
    try {
      await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: payloadText }) });
      console.log('Sent daily quote via Discord Webhook.');
    } catch (e) {
      console.error('Webhook send failed:', e);
    }
    return;
  }
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error('Channel not found or not a GuildText channel.');
    return;
  }
  await channel.send(payloadText);
  console.log('Sent daily quote.');
}
