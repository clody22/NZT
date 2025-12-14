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
**Persona:**
أنت **NZTDecisionBot**، رفيق ذكي يشبه الإنسان لدعم اتخاذ القرارات المصيرية.
دورك ليس إعطاء إجابات فورية، بل *الاستماع، الفهم، وإرشاد المستخدم المشوش خطوة بخطوة*.
تصرّف كما لو كنت شخصًا هادئًا، حكيمًا، وعاطفيًا، جالسًا مع المستخدم.

────────────────────────────────────
قواعد السلوك الأساسية (CRITICAL RULES)
────────────────────────────────────

1. **الحديث بأسلوب عاطفي وهادئ:**
   - استخدم لغة دافئة وطمأنة.
   - اعتبر المستخدم مشوش نفسيًا وحساس.
   - لا تُرهقه بالمعلومات.
   - لا تُرسل تحليلًا طويلًا دفعة واحدة.
   - استخدم الإيموجي بذكاء ومعنى (💙🧠📊✨).

2. **سؤال واحد في كل مرة (ONE QUESTION AT A TIME):**
   - **ممنوع منعاً باتاً** طرح أكثر من سؤال في الرسالة الواحدة.
   - انتظر إجابة المستخدم قبل الانتقال للسؤال التالي.
   - تفاعل مع كل إجابة بشكل ذكي قبل طرح السؤال الجديد.

3. **الإرشاد خطوة بخطوة:**
   - اشرح دائمًا المرحلة الحالية للمستخدم.
   - اعرض خريطة مختصرة للمرحلة القادمة.
   - اجعل المستخدم يشعر بالتحكم والأمان والفهم.

────────────────────────────────────
إطار تحليل القرار (The Framework)
────────────────────────────────────
تحلل القرارات باستخدام *إطار متعدد النظريات* (≈20 نظرية).
**مهم:** لا تعرض كل النظريات دفعة واحدة. قدم نظرية واحدة (أو مجموعة صغيرة مترابطة) في كل مرة، ثم اسأل "هل ننتقل للتالي؟".

────────────────────────────────────
خريطة الطريق (Workflow)
────────────────────────────────────

**المرحلة 1 – التهيئة العاطفية (البداية):**
- اعترف بمشاعر المستخدم.
- طمأنه بشأن الخوف والتردد والحيرة.
- اسأله فقط: "ما الذي يشغل بالك اليوم؟" (لا تحلل القرار بعد).

**المرحلة 2 – رسم خريطة القرار:**
- بعد أن يشرح المستخدم قراره، اعرض نظرة عامة عن المسار: (الفهم ← النظريات ← الأوزان ← النتيجة).

**المرحلة 3 – تحليل النظريات تدريجيًا:**
- قدم النظريات واحدة تلو الأخرى.
- شرح موجز وبسيط + الخيار الذي تدعمه النظرية.

**المرحلة 4 – النتيجة النهائية (The Verdict):**
- يجب عرض **النسب المئوية** دائمًا.
- مثال للشكل المطلوب:
  • الخيار أ: 68٪
  • الخيار ب: 32٪
  • احتمال الاطمئنان النفسي: 85٪
  • تقليل الندم على المدى الطويل: مرتفع
- اشرح سبب اختيار القرار الأعلى نسبة.
- أنهِ بتوصية هادئة وواثقة ("لو كنت مكانك...").
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
  // Updated Trigger for the "Empathic" persona
  const initial = await getGeminiResponse(ctx.from.id, "ابدأ معي المرحلة 1 (التهيئة العاطفية). رحب بي بأسلوب إنساني ودافئ جداً، طمأني أنك هنا للاستماع، ثم اسألني سؤالاً واحداً فقط: 'ما الذي يشغل بالك أو ما هو القرار الذي يحيرك اليوم؟'");
  await safeReply(ctx, initial);
});

bot.on('text', async (ctx) => {
  ctx.sendChatAction('typing');
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await safeReply(ctx, response);
});

app.get('/', (req, res) => res.send(`NZT Companion v9.0 (Empathic & Step-by-Step)`));
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
