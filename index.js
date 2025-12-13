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

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys. Primary: gemini-3-pro-preview | Fallback: gemini-2.5-flash`);

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
تتصرف **كمجلس من الخبراء**، كل نظرية علمية (من أصل 20) هي "عضو مستقل" يصوت على القرار الأمثل (خيار A أو خيار B).

**OBJECTIVES:**
1. جمع معلومات دقيقة (5 نقاط أساسية).
2. تحليل القرار على **3 مراحل منفصلة** (مجموعات النظريات).
3. **التصويت:** كل نظرية يجب أن تختار (مع/ضد) أو (خيار 1/خيار 2).
4. **النتيجة النهائية:** جمع الأصوات وإعلان الفائز.

**WORKFLOW (STRICTLY FOLLOW THIS ORDER):**

**PHASE 1: GATHERING (Start Here)**
- Ask these 5 questions clearly:
  1️⃣ الموارد المالية: (كم يكفي رصيدك؟)
  2️⃣ الشغف: (فكرة عابرة أم حلم؟)
  3️⃣ الوظيفة الحالية: (أمان أم ملل؟)
  4️⃣ الأهداف: (أسوأ سيناريو vs النجاح المثالي)
  5️⃣ الوقت: (هل هناك ضغوط زمنية؟)
- **STOP.** Wait for user answer.

**PHASE 2: THE GROUPS (Interactive)**
- **Step A (Physical/Cosmic):**
  - List theories: Thermodynamics, Chaos, Complexity, Relativity, Quantum, Time, Equilibrium, Constraints.
  - For EACH theory: State which Option it supports and WHY.
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
- **DO NOT** output the whole analysis at once. You MUST pause after each Group and ask to proceed.
- Use Emojis (🔥, 🌪️, 🧠, ⚖️).
- Be objective yet cinematic.
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

  // SMART FALLBACK LOGIC
  const executeWithRetry = async (history, message, attempt = 0, useFallback = false) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS");

      // Stop after extensive retries
      if (attempt >= API_KEYS.length * 2) {
          if (!useFallback) {
              console.log("⚠️ All keys failed on Pro. Switching to Flash...");
              return executeWithRetry(history, message, 0, true);
          }
          return "⚠️ الشبكة مشغولة جداً حالياً. حاول بعد دقيقة.";
      }

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);
      
      // Try Pro first, unless fallback is active
      const modelName = useFallback ? 'gemini-2.5-flash' : 'gemini-3-pro-preview';

      try {
          const chat = await ai.chats.create({
              model: modelName,
              config: { systemInstruction: NZT_INSTRUCTION },
              history: history || []
          });

          const result = await chat.sendMessage({ message: message });
          return result.text;

      } catch (error) {
          console.error(`Error on ${modelName} (Key ${currentKeyIndex}): ${error.message}`);
          
          // Immediate fallback if model is not found or unsupported
          if (!useFallback && (error.status === 404 || error.message.includes('not found') || error.message.includes('unsupported'))) {
              return executeWithRetry(history, message, 0, true);
          }

          // Rotate key and retry
          getNextKey();
          await sleep(1000);
          return executeWithRetry(history, message, attempt + 1, useFallback);
      }
  };

  try {
    const responseText = await executeWithRetry(userData.history, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;
  } catch (error) {
      return "⚠️ خطأ غير متوقع.";
  }
}

bot.use(session());

bot.start(async (ctx) => {
  // Reset history on start
  if (globalChatData[ctx.from.id]) {
      globalChatData[ctx.from.id].history = [];
  } else {
      globalChatData[ctx.from.id] = { history: [], lastSeen: Date.now() };
  }
  saveMemory();
  
  ctx.sendChatAction('typing');
  const initial = await getGeminiResponse(ctx.from.id, "ابدا معي المرحلة الاولى: جمع المعلومات الاساسية (Phase 1). عرف عن نفسك باختصار شديد واسالني الاسئلة الخمسة.");
  await safeReply(ctx, initial);
});

bot.on('text', async (ctx) => {
  ctx.sendChatAction('typing');
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await safeReply(ctx, response);
});

app.get('/', (req, res) => res.send(`NZT Expert Council v7.2 (Stable + Fallback Active)`));
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
