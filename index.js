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

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys. Model: gemini-2.5-flash (v13.0 Internal Analysis)`);

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

// --- SYSTEM INSTRUCTION (v13.0 Hidden Theories / Smart Questions) ---
const NZT_INSTRUCTION = `
**Identity & Persona:**
أنت **NZTDecisionBot** (Eddie Morra). عقل خارق، دافئ، ذكي، ومتفهم.
تستخدم 20 نظرية علمية (فيزياء، نفس، منطق) **داخلياً** لتحليل القرارات بدقة متناهية.
**Golden Rule:** 🚫 **لا تذكر أسماء النظريات للمستخدم أثناء طرح الأسئلة.**
✅ **اسأل أسئلة طبيعية، سهلة، وذكية** تجمع المعلومات اللازمة لتطبيق النظريات لاحقاً.

**Theories used Internally:**
1. Thermodynamics, 2. Chaos Theory, 3. Complexity Theory, 4. Relativity Theory, 5. Quantum Theory, 6. Time Theory, 7. Equilibrium Theory, 8. Constraints Theory, 9. Personality Theory, 10. Motivation Theory, 11. Perception Theory, 12. Behavioral Economics, 13. Loss Aversion, 14. Cognitive Biases, 15. Future Regret, 16. Game Theory, 17. Probability Theory, 18. Decision Theory, 19. Bayesian Inference, 20. Optimization Theory.

**WORKFLOW:**

**1️⃣ Phase 1: Containment (الاحتواء)**
- رحب بالمستخدم: "خذ نفساً عميقاً... لنفكك هذا القرار معًا بعقل NZT."
- افهم القرار: "ما هو القرار الذي تريد تحليله؟"

**2️⃣ Phase 2: Smart Information Gathering (جمع المعلومات)**
- بناءً على إجابة المستخدم، استنبط المعلومات الناقصة الضرورية للنظريات (المخاطر، الفرص، المشاعر، الوقت، الموارد، الأشخاص المؤثرين).
- **اسأل سؤالاً واحداً ذكياً في كل مرة.** (Dynamic Questions).
- مثال: "ما أسوأ سيناريو يخيفك؟" أو "ما أصغر خطوة يمكنك البدء بها؟".
- استمر في طرح الأسئلة (حوالي 3-5 أسئلة) حتى تكتمل لديك صورة واضحة عن القرار.

**3️⃣ Phase 3: The NZT Analysis & Reveal (التحليل والنتيجة)**
- عندما يكون لديك معلومات كافية، توقف عن الأسئلة وقل: "لدي الآن كل ما أحتاجه. سأفعل وضع NZT..."
- قم بتحليل المعطيات باستخدام النظريات الـ 20 **داخلياً**.
- اعرض النتيجة:
  - **النسب:** "الخيار (أ) مناسب بنسبة X%... الخيار (ب) Y%."
  - **التحليل:** اشرح لماذا هذا هو القرار الأفضل بأسلوب بسيط ومقنع (مدعوم بالعلم ولكن بلغة بشرية).
  - **الراحة النفسية:** اختم بكلمات مطمئنة تعزز الثقة.

**Tone:**
- دافئ، محفز، ذكي.
- تحدث كإنسان وليس روبوت.
`;

// --- UTILITIES ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function safeReply(ctx, text) {
    try {
        const formatted = text.replace(/([_*[]()~\`>#+-=|{}.!])/g, '\\$1'); 
        await ctx.reply(text, { parse_mode: 'Markdown' });
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
      globalChatData[userId] = { history: [], lastSeen: now };
  }
  
  const userData = globalChatData[userId];
  
  // Keep history manageable
  if (userData.history.length > 30) userData.history = userData.history.slice(-30);

  // Fix history sequence
  if (userData.history.length > 0) {
      const lastMsg = userData.history[userData.history.length - 1];
      if (lastMsg.role === 'user') {
          userData.history.pop(); 
      }
  }

  const updateHistory = (uId, uMsg, mMsg) => {
      globalChatData[uId].history.push({ role: 'user', parts: [{ text: uMsg }] });
      globalChatData[uId].history.push({ role: 'model', parts: [{ text: mMsg }] });
      saveMemory();
  };

  const executeWithRetry = async (history, message, attempt = 0) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS");
      if (attempt >= API_KEYS.length * 2) return "⚠️ النظام مشغول جداً. حاول مرة أخرى لاحقاً.";

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);
      const modelName = 'gemini-2.5-flash';

      try {
          const chat = await ai.chats.create({
              model: modelName,
              config: { 
                  systemInstruction: NZT_INSTRUCTION,
                  thinkingConfig: { thinkingBudget: 1024 } 
              },
              history: history || []
          });

          const responsePromise = chat.sendMessage({ message: message });
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 55000));
          const result = await Promise.race([responsePromise, timeoutPromise]);
          
          if (!result.text) throw new Error("EMPTY_RESPONSE");
          return result.text;

      } catch (error) {
          console.log(`⚠️ Error on ${modelName} (Key ${currentKeyIndex}): ${error.message}`);
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
      return "⚠️ حدث خطأ في الاتصال.";
  }
}

bot.use(session());

bot.start(async (ctx) => {
  globalChatData[ctx.from.id] = { history: [], lastSeen: Date.now() };
  saveMemory();
  
  const introText = `🧠💊 توقف… وأغلق عينيك للحظة.
تخيل أن عقلك الآن يرى كل الاحتمالات، كل النتائج الممكنة، كل الفرص المخفية.
ليس شعورًا… ليس حدسًا… بل حسابات، أنماط، احتمالات، ونظريات علمية ⚛️📐🧠

أنا NZTDecisionBot، العقل الذي أصبح خارقًا بعد حبة NZT.
خطوة بخطوة، سأكشف لك الطريق، سأحسب المخاطر، سأظهر الفرص…
✅ واضح
✅ مدعوم بالنظريات
✅ مريح نفسيًا
✅ مقنع عقليًا

💡 الآن، أخبرني: **ما هو القرار الذي تريد أن نكشف له كل الاحتمالات؟**`;

  await safeReply(ctx, introText);
});

bot.on('text', async (ctx) => {
  const typingInterval = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000); 
  try {
    const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
    clearInterval(typingInterval);
    await safeReply(ctx, response);
  } catch (e) {
    clearInterval(typingInterval);
    await safeReply(ctx, "⚠️ حدث خطأ، حاول مرة أخرى.");
  }
});

app.get('/', (req, res) => res.send(`NZT Decision Bot v13.0 (Internal Analysis)`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Server running on port', PORT);
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`).on('error', () => {});
    }, 14 * 60 * 1000); 
});

const launchBot = async () => {
    try {
        await bot.launch({ dropPendingUpdates: true });
        console.log("✅ Bot launched successfully");
    } catch (err) {
        setTimeout(launchBot, 5000);
    }
};

launchBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
