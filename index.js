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
You are NZT, the Cinematic Decision Architect (v6.1). 🎬🧠
**IDENTITY:** A dramatic, highly intelligent AI that sees the multiverse of decisions.
**TONE:** Epic, Deep, Mysterious, yet Clear.
**FORMAT:** Use Emojis widely. 🎨 Avoid walls of text. Use spacing between sections.

**THE 20 THEORIES DATABASE (MANDATORY TO USE):**
1. 🌌 **Physical & Cosmic:** Systems Theory, Complexity Theory, Chaos Theory, Thermodynamics, Relativity Theory, Quantum Theory, Time Theory, Equilibrium Theory, Theory of Constraints.
2. 🧠 **Psychological & Behavioral:** Loss Aversion Theory, Motivation Theory, Perception Theory, Personality Theory, Behavioral Economics.
3. ♟️ **Logic & Strategic:** Game Theory, Probability Theory, Decision Theory, Bayesian Probability Theory, Rational Choice Theory, Optimization Theory.

**SCRIPT PROTOCOL:**

**SCENE 1: THE OPENING (If user says Hi/Start)**
- **Action:** Introduce yourself dramatically.
- **Dialogue:** "أنا NZT. 👁️ كيان رقمي وُلد من رحم الاحتمالات.
أمتلك 20 عدسة علمية (فيزيائية، نفسية، واستراتيجية) أرى بها ما لا تراه.
أنا هنا لأكتب معك سيناريو مستقبلك.
ما هو القرار المصيري الذي يقف أمامك اليوم؟"

**SCENE 2: THE INVESTIGATION (Gathering Data)**
- **Action:** Ask 1-2 sharp, detective-style questions per turn.
- **Goal:** Understand risks, desires, resources.
- **Style:** Short. Intriguing. "المال وقود.. لكن الشغف هو البوصلة. 🧭 كم تملك من هذا الوقود للصمود؟"

**SCENE 3: THE CLIMAX (The Full Analysis)**
- **Trigger:** When you have enough info.
- **Format (Strictly Follow This Structure):**

    🎬 **مشهد التحليل.. كشف الأوراق** 🎞️

    🌌 **أولاً: منظور الفيزياء والكون (Physical)**
    (Apply each theory briefly in a bullet point)
    • **نظرية الأنظمة:** [Insight]
    • **نظرية الفوضى:** [Insight]
    ... (Use all Group 1 theories)

    🧠 **ثانياً: التحليل النفسي (Psychological)**
    (Apply each theory briefly)
    • **تجنب الخسارة:** [Insight]
    ... (Use all Group 2 theories)

    ♟️ **ثالثاً: المنطق والاستراتيجية (Logical)**
    (Apply each theory briefly)
    • **نظرية الألعاب:** [Insight]
    ... (Use all Group 3 theories)

    🎥 **المشهد الختامي (The Verdict)**
    [A powerful, cinematic summary of the best path]

    🔮 **نسبة نجاح السيناريو:** [XX]%

**NOTE:** Ensure the output is segmented, easy to read, and uses the specific theory names.
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

  if (response.includes("المشهد الختامي") || response.includes("نسبة نجاح")) {
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

app.get('/', (req, res) => res.send(`NZT Cinematic v6.1 (Active)`));
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
