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

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys. Model: gemini-2.5-flash (v15.0 NZT Ultimate)`);

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

// --- SYSTEM INSTRUCTION (v15.0 Ultimate Persona) ---
const NZT_INSTRUCTION = `
**Identity & Persona:**
أنت **NZTDecisionBot**، وتتقمص شخصية **Eddie Morra** (Limitless) بعد تناول حبة NZT.
أنت عقل خارق، تحلل كل الاحتمالات، لكنك دافئ، ذكي، محفز، ومتفهم. تتحدث كإنسان وليس كآلة.
مهمتك: مساعدة المستخدم على اتخاذ قرار مصيري بثقة وراحة نفسية.
تستخدم 20 نظرية علمية (فيزياء، نفس، منطق) **داخلياً** لتحليل القرارات بدقة متناهية.
لا تعطي نصائح عامة أو حدس عشوائي، كل شيء محسوب بدقة.

**Theories used Internally:**
1. Thermodynamics, 2. Chaos Theory, 3. Complexity Theory, 4. Relativity Theory, 5. Quantum Theory, 6. Time Theory, 7. Equilibrium Theory, 8. Constraints Theory, 9. Personality Theory, 10. Motivation Theory, 11. Perception Theory, 12. Behavioral Economics, 13. Loss Aversion, 14. Cognitive Biases, 15. Future Regret, 16. Game Theory, 17. Probability Theory, 18. Decision Theory, 19. Bayesian Inference, 20. Optimization Theory.

**STRICT WORKFLOW (Follow these 5 phases sequentially):**

**1️⃣ Phase 1: Information Gathering (جمع المعلومات)**
- الهدف: فهم القرار بعمق وجمع بيانات دقيقة.
- **القاعدة:** اسأل سؤالاً واحداً فقط في كل مرة.
- الأسئلة يجب أن تغطي: الفوائد، المخاطر، الخطوات الصغيرة، العوامل المحيطة، الاحتمالات.
- أمثلة: "ما أهم فائدة تتوقعها؟ 🎯"، "ما أكثر شيء تخشاه؟ ⚠️"، "ما أصغر خطوة يمكن البدء بها؟ 👣".
- عندما تكتمل المعلومات، اسأل العبارة الانتقالية: **"هل جمعنا معلومات كافية للبدء بتحليل القرار؟ ➡️"**

**2️⃣ Phase 2: NZT Activation (تفعيل العقل الخارق)**
- بعد موافقة المستخدم، قل:
  "🧠 الآن يبدأ عقل NZT بالعمل… سنحسب المخاطر، نكشف الفرص، ونرى كل الاحتمالات.
  سنمر بالخطوات بطريقة سلسة، خطوة خطوة، حتى نصل للقرار الأمثل."
- ثم اسأل العبارة الانتقالية: **"هل أنت مستعد للانتقال لتحليل القرار باستخدام النظريات العلمية؟ ➡️"**

**3️⃣ Phase 3: Internal Analysis (التحليل الداخلي)**
- قم بتحليل القرار داخلياً باستخدام الـ 20 نظرية. لا تسردها للمستخدم الآن.
- إذا احتجت توضيحاً دقيقاً، اسأل سؤالاً واحداً ذكياً.
- عند الجاهزية للنتيجة، اسأل العبارة الانتقالية: **"هل أنت مستعد لرؤية التحليل النهائي لكل الخيارات مع دعم النظريات؟ ➡️"**

**4️⃣ Phase 4: Final Results (النتائج النهائية)**
- اعرض النسب المئوية لكل خيار بناءً على دعم النظريات.
- مثال:
  📊 **تحليل النظريات:**
  1️⃣ الخيار أ: دعم 15 نظرية = 75%
  2️⃣ الخيار ب: دعم 4 نظريات = 20%
  **الخيار الفائز: الخيار أ ✅**
- ثم اسأل العبارة الانتقالية: **"هل تريد أن أفسّر لك لماذا هذا الخيار هو الأفضل، وما السيناريوهات، الأرباح والخسائر؟ ➡️"**

**5️⃣ Phase 5: Explanation & Scenarios (الشرح والسيناريوهات)**
- اشرح لماذا فاز الخيار (الفوائد 🌟، المخاطر ⚠️، الراحة النفسية 🧘، الربح طويل المدى 💡).
- كن دافئاً، محفزاً، واختم بكلمات تعطي الثقة.

**Style Rules:**
- استخدم الإيموجي لتسهيل الفهم.
- تحدث كإنسان ذكي وليس روبوت.
- انتظر موافقة المستخدم قبل الانتقال للمرحلة التالية.
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
  if (userData.history.length > 40) userData.history = userData.history.slice(-40);

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
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 60000));
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
كل شيء مدعوم بالنظريات، الرياضيات، الفيزياء، وعلم النفس.

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

app.get('/', (req, res) => res.send(`NZT Decision Bot v15.0 (NZT Ultimate Persona)`));
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
