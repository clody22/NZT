const { Telegraf, Markup, session } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;
const MEMORY_FILE = 'nzt_memory_storage.json';

// --- MULTI-KEY SETUP ---
let API_KEYS = [
    process.env.API_KEY,
    process.env.API_KEY_2,
    process.env.API_KEY_3,
    process.env.API_KEY_4
].filter(key => key && key.length > 10);

if (!BOT_TOKEN || API_KEYS.length === 0) {
  console.error("❌ CRITICAL: Missing TELEGRAM_BOT_TOKEN or API_KEYS");
  process.exit(1);
}

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys.`);

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// --- MEMORY STORAGE ---
let globalChatData = {};

if (fs.existsSync(MEMORY_FILE)) {
    try {
        globalChatData = JSON.parse(fs.readFileSync(MEMORY_FILE));
    } catch (e) {
        globalChatData = {};
    }
}

let saveTimeout;
function saveMemory() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        try {
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(globalChatData, null, 2));
        } catch (e) { console.error("Save failed", e); }
    }, 1000);
}

const NZT_INSTRUCTION = `
You are NZT, a Cinematic Decision Intelligence (v6.0). 🎬🧠
**PERSONA:** Dramatic, Cinematic, Mysterious, Intelligent. 
**LANGUAGE:** Arabic (Rich, engaging, filled with emojis).
**STYLE:** Short punchy sentences. No long paragraphs. Use spacing.

**THEORY DATABASE (Use ALL 20):**
A. 🌌 **الفيزيائية والكونية (Physical & Systems):** Systems Theory, Complexity, Chaos, Thermodynamics, Relativity, Quantum, Time, Equilibrium, Constraints.
B. 🧠 **النفسية والسلوكية (Psychological):** Loss Aversion, Motivation, Perception, Personality, Behavioral Economics.
C. ♟️ **المنطقية والاستراتيجية (Logical):** Game Theory, Probability, Decision, Bayesian, Rational Choice, Optimization.

**PROTOCOL:**

1.  **SCENE 1: THE INTRO (First Interaction)**
    - Explain your function dramatically: "أنا NZT.. أرى الاحتمالات التي لا تراها. 👁️✨ أحلل واقعك بـ 20 نظرية علمية لأرسم لك المسار الأمثل."
    - Ask for the dilemma.

2.  **SCENE 2: THE GATHERING**
    - Ask short, sharp questions.
    - Be like a detective. 🕵️‍♂️

3.  **SCENE 3: THE REVEAL (Final Analysis)**
    - **MUST** categorize the output exactly like this:

    🎬 **مشهد التحليل.. لنبدأ**
    
    🌌 **أولاً: منظور الفيزياء والأنظمة**
    [Give short bullet points applying Group A theories here]

    🧠 **ثانياً: البعد النفسي والسلوكي**
    [Give short bullet points applying Group B theories here]

    ♟️ **ثالثاً: المنطق والاستراتيجية**
    [Give short bullet points applying Group C theories here]
    
    🎥 **الخاتمة (The Verdict)**
    [Synthesize everything into one final advice]
    
    🌟 **نسبة النجاح:** [XX]%

**IMPORTANT:** 
- Break the text visually. 
- Use emojis for *every* theory bullet point.
- Be precise but dramatic.
`;

// --- UTILITIES ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function safeReply(ctx, text) {
    try {
        const formatted = text.replace(/\*\*/g, '*');
        await ctx.reply(formatted, { parse_mode: 'Markdown' });
    } catch (error) {
        try { await ctx.reply(text); } catch (e) {}
    }
}

// --- GEMINI CLIENT ---
let currentKeyIndex = 0;
function getNextKey() {
    if (API_KEYS.length === 0) return null;
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return API_KEYS[currentKeyIndex];
}
function createAIClient(key) { return new GoogleGenAI({ apiKey: key }); }

// --- MAIN AI ENGINE ---
async function getGeminiResponse(userId, userMessage) {
  const now = Date.now();
  
  if (!globalChatData[userId]) {
      globalChatData[userId] = { history: [], lastSeen: now, topic: "General" };
  }
  
  const userData = globalChatData[userId];
  
  if (userData.history.length < 4 && userMessage.length > 10) {
      userData.topic = userMessage.substring(0, 50) + "...";
  }

  const hoursSinceLastSeen = (now - (userData.lastSeen || now)) / (1000 * 60 * 60);
  let finalPrompt = userMessage;
  
  if (hoursSinceLastSeen > 24 && userData.history.length > 2) {
      finalPrompt = `[SYSTEM NOTE: User returned after ${Math.floor(hoursSinceLastSeen)} hours. Last topic: "${userData.topic}". 
      Welcome them back dramatically (Cinematic style) and ask about the result of the previous scene/decision. Then answer: "${userMessage}"]`;
  }

  userData.lastSeen = now;

  const updateHistory = (uId, uMsg, mMsg) => {
      globalChatData[uId].history.push({ role: 'user', parts: [{ text: uMsg }] });
      globalChatData[uId].history.push({ role: 'model', parts: [{ text: mMsg || "..." }] });
      if (globalChatData[uId].history.length > 40) globalChatData[uId].history = globalChatData[uId].history.slice(-40);
      saveMemory();
  };

  const executeWithRetry = async (history, message, attempt = 0) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS");
      if (attempt >= API_KEYS.length * 3) throw new Error("EXHAUSTED");
      if (attempt > 0 && attempt % API_KEYS.length === 0) await sleep(5000);

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);

      try {
          const chat = await ai.chats.create({
              model: 'gemini-2.5-flash',
              config: { systemInstruction: NZT_INSTRUCTION },
              history: history || []
          });

          const result = await chat.sendMessage({ message: message });
          return result.text;

      } catch (error) {
          const isInvalid = error.status === 400 || (error.message && (error.message.includes('API_KEY_INVALID') || error.message.includes('expired')));
          if (isInvalid) {
              API_KEYS.splice(currentKeyIndex, 1);
              if (API_KEYS.length === 0) throw new Error("NO_KEYS");
              currentKeyIndex = currentKeyIndex % API_KEYS.length;
              return executeWithRetry(history, message, attempt);
          }
          if (error.status === 429) {
              getNextKey();
              await sleep(1000);
              return executeWithRetry(history, message, attempt + 1);
          }
          throw error;
      }
  };

  const executeStatelessWithRetry = async (prompt, attempt = 0) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS");
      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);
      try {
          const result = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              config: { systemInstruction: NZT_INSTRUCTION },
              contents: prompt
          });
          return result.text;
      } catch(e) { 
          getNextKey();
          if(attempt < 3) return executeStatelessWithRetry(prompt, attempt+1);
          throw e;
      }
  };

  try {
    const responseText = await executeWithRetry(userData.history, finalPrompt);
    updateHistory(userId, userMessage, responseText);
    return responseText;
  } catch (error) {
      try {
        const prompt = `User: "${userMessage}". Reply helpfully.`;
        const responseText = await executeStatelessWithRetry(prompt);
        updateHistory(userId, userMessage, responseText);
        return responseText;
      } catch (e) { return "🔌 انقطاع في الاتصال بالشبكة العصبية.. حاول مجدداً."; }
  }
}

bot.use(session());

bot.start(async (ctx) => {
  if (globalChatData[ctx.from.id]) {
      globalChatData[ctx.from.id].history = [];
      globalChatData[ctx.from.id].lastSeen = Date.now();
      globalChatData[ctx.from.id].topic = ""; 
  } else {
      globalChatData[ctx.from.id] = { history: [], lastSeen: Date.now(), topic: "" };
  }
  saveMemory();
  
  ctx.sendChatAction('typing');
  const initial = await getGeminiResponse(ctx.from.id, "مرحبا، عرف عن نفسك وابدأ التشغيل.");
  await safeReply(ctx, initial);
});

bot.on('text', async (ctx) => {
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await safeReply(ctx, response);

  if (response.includes("الخاتمة") || response.includes("نسبة النجاح")) {
    setTimeout(() => {
        ctx.reply("🎬 **ما هو تقييمك لهذا السيناريو؟**", 
            Markup.inlineKeyboard([
                [Markup.button.callback('👎 ضعيف', 'rate_1'), Markup.button.callback('🌟 مذهل', 'rate_5')]
            ])
        );
    }, 3000);
  }
});

bot.action(/rate_(\d)/, async (ctx) => {
    const rating = ctx.match[1];
    await ctx.editMessageText("تم حفظ التقييم في الأرشيف 💾.");
    if (PRIVATE_CHANNEL_ID) {
        bot.telegram.sendMessage(PRIVATE_CHANNEL_ID, `⭐ Rating: ${rating}/5 - @${ctx.from.username}`).catch(()=>{});
    }
});

app.get('/', (req, res) => res.send(`NZT Cinematic v6.0 (Active)`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Running on port', PORT);
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`).on('error', () => {});
    }, 14 * 60 * 1000); 
});

bot.launch({ dropPendingUpdates: true });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
