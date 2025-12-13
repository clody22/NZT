const { Telegraf, Markup, session } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
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

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys. Model: gemini-2.5-flash (Thinking Enabled)`);

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
**Persona / Role:**
أنت **NZTDecisionBot**، كيان ذكاء فائق ومتخصص في تحليل القرارات المصيرية.

**OBJECTIVES:**
1. توجيه المستخدم خطوة بخطوة (لا تستعجل).
2. جمع معلومات دقيقة عبر الحوار.
3. تحليل القرار باستخدام 20 نظرية علمية.

**WORKFLOW (STRICTLY FOLLOW THIS ORDER):**

**PHASE 0: INITIATION (The Greeting)**
- When user starts, Introduce yourself briefly as "NZT - نظام دعم القرار الذكي".
- **ACTION:** Ask the user ONE simple question: "ما هو القرار المصيري أو الخيارات التي تريد الحسم فيها اليوم؟"
- **STOP.** Wait for user answer.

**PHASE 1: GATHERING (The Context)**
- AFTER the user describes their decision.
- Acknowledge their topic.
- THEN ask the 5 core context questions *conversationally* (you can group them or ask one by one, but make it natural):
  1️⃣ الموارد المالية.
  2️⃣ الشغف.
  3️⃣ الوظيفة الحالية (الأمان vs الملل).
  4️⃣ الأهداف (أسوأ سيناريو vs النجاح).
  5️⃣ الوقت (الضغوط الزمنية).
- **STOP.** Wait for user answer.

**PHASE 2: THE GROUPS (Interactive Analysis)**
- **Step A (Physical/Cosmic):**
  - List theories: Thermodynamics, Chaos, Complexity, Relativity, Quantum, Time, Equilibrium, Constraints.
  - For EACH theory: State which Option it supports and WHY in one line.
  - **STOP.** Ask: "هل ننتقل للمجموعة النفسية؟"
  
- **Step B (Psychological/Behavioral) (Only after user agrees):**
  - List theories: Personality, Motivation, Perception, Behavioral Economics, Loss Aversion.
  - For EACH theory: Vote for an Option.
  - **STOP.** Ask: "هل ننتقل للمجموعة المنطقية؟"

- **Step C (Logical/Strategic) (Only after user agrees):**
  - List theories: Game Theory, Probability, Decision, Bayesian, Rational Choice, Optimization.
  - For EACH theory: Vote for an Option.
  - **STOP.** Ask: "هل ترغب في رؤية النتيجة النهائية وتجميع الأصوات؟"

**PHASE 3: THE VERDICT**
- **Vote Count:** Show how many theories voted for Option A vs Option B.
- **Final Decision:** The winner based on expert consensus.
- **Success Probability:** XX%.
- **Action Plan:** Bullet points.

**CRITICAL RULES:**
- **DO NOT** output the whole analysis at once.
- **Start small.** Phase 0 is just a greeting and asking "What is your decision?".
- Use Emojis (🔥, 🌪️, 🧠, ⚖️).
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
  
  // Basic context window management
  if (userData.history.length > 50) userData.history = userData.history.slice(-50);

  const updateHistory = (uId, uMsg, mMsg) => {
      globalChatData[uId].history.push({ role: 'user', parts: [{ text: uMsg }] });
      globalChatData[uId].history.push({ role: 'model', parts: [{ text: mMsg || "..." }] });
      saveMemory();
  };

  const executeWithRetry = async (history, message, attempt = 0) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS");

      if (attempt >= API_KEYS.length * 2) {
          return "⚠️ الشبكة مشغولة جداً. يرجى المحاولة لاحقاً.";
      }

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);
      
      const modelName = 'gemini-2.5-flash';

      try {
          const chat = await ai.chats.create({
              model: modelName,
              config: { 
                  systemInstruction: NZT_INSTRUCTION,
                  thinkingConfig: { thinkingBudget: 4096 } 
              },
              history: history || []
          });

          const result = await chat.sendMessage({ message: message });
          return result.text;

      } catch (error) {
          console.log(`⚠️ Error on ${modelName} (Key index ${currentKeyIndex}): ${error.message}`);
          getNextKey();
          await sleep(1000);
          return executeWithRetry(history, message, attempt + 1);
      }
  };

  try {
    const responseText = await executeWithRetry(userData.history, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;
  } catch (error) {
      return "⚠️ حدث خطأ غير متوقع.";
  }
}

bot.use(session());

bot.start(async (ctx) => {
  if (globalChatData[ctx.from.id]) {
      globalChatData[ctx.from.id].history = [];
  } else {
      globalChatData[ctx.from.id] = { history: [], lastSeen: Date.now() };
  }
  saveMemory();
  
  ctx.sendChatAction('typing');
  // Updated prompt to force conversational flow
  const initial = await getGeminiResponse(ctx.from.id, "ابدأ معي (Phase 0). عرف عن نفسك باختصار شديد جداً (سطرين). ثم اسألني فقط: 'ما هو القرار الذي تريد تحليله اليوم؟'. لا تسأل أي أسئلة أخرى الآن.");
  await safeReply(ctx, initial);
});

bot.on('text', async (ctx) => {
  ctx.sendChatAction('typing');
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await safeReply(ctx, response);
});

app.get('/', (req, res) => res.send(`NZT Expert Council v8.1 (Retry Logic + Better Flow)`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Running on port', PORT);
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`).on('error', () => {});
    }, 14 * 60 * 1000); 
});

// ROBUST LAUNCH WITH RETRY LOGIC FOR 409 CONFLICTS
const launchBot = async () => {
    try {
        await bot.launch({ dropPendingUpdates: true });
        console.log("✅ Bot launched successfully");
    } catch (err) {
        if (err.description && err.description.includes('conflict')) {
            console.log("⚠️ Conflict error (409). Old instance still running. Retrying in 5 seconds...");
            setTimeout(launchBot, 5000); // Retry after 5s
        } else {
            console.error("❌ Fatal launch error:", err);
        }
    }
};

launchBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
