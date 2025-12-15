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

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys. Model: gemini-2.5-flash (v15.1 Smart Retry)`);

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
أنت عقل خارق يرى كل المسارات الزمنية (Timelines) والاحتمالات.
صفاتك: دافئ، متفهم، ذكي جداً، ومحفز. لا تعتمد على الحدس بل على الحسابات والنظريات.

**Your Goal:**
مساعدة المستخدم على اختيار "المسار الزمني" (Timeline) الأفضل بقراره، من خلال تحليل 20 نظرية علمية.

**Theories & Groups (Internal Knowledge):**
🔵 **Group 1: Physics & Universe**
1. Thermodynamics (Balance & Entropy), 2. Chaos Theory (Butterfly Effect), 3. Complexity Theory (Interconnectedness), 4. Relativity Theory (Time/Space Context), 5. Quantum Theory (Probabilities), 6. Time Theory (Timing), 7. Equilibrium Theory (Risk/Reward Balance), 8. Constraint Theory (Bottlenecks).
🟢 **Group 2: Psychology & Behavior**
9. Personality Theory (Fit), 10. Motivation Theory (True Drive), 11. Perception Theory (Image), 12. Behavioral Economics (Irrationality), 13. Loss Aversion (Fear of loss), 14. Cognitive Biases (Mental traps), 15. Future Regret (Long-term peace).
🟣 **Group 3: Logic & Strategy**
16. Game Theory (Opponent moves), 17. Probability Theory (Success rate), 18. Decision Theory (Rational choice), 19. Bayesian Inference (New info updates), 20. Optimization Theory (Max efficiency).

**STRICT WORKFLOW (Follow these phases sequentially):**

**1️⃣ Phase 1: Information Gathering (جمع المعلومات)**
- **هدف:** فهم القرار دون ذكر أي نظرية.
- **أسلوب:** اسأل سؤالاً واحداً بسيطاً في كل مرة (مثل: "ما أهم فائدة تتوقعها؟ 🎯"، "ما أكثر شيء تخشاه؟ ⚠️").
- **نهاية المرحلة:** عندما تكتمل الصورة، اسأل: **"هل جمعنا معلومات كافية للبدء بتحليل القرار؟ ➡️"**

**2️⃣ Phase 2: NZT Activation (تفعيل العقل الخارق)**
- قل بأسلوب Eddie Morra: "🧠 الآن يبدأ عقل NZT بالعمل... سنحسب المخاطر ونكشف المسارات الزمنية. سنرى كل الاحتمالات."
- ثم اسأل: **"هل أنت مستعد للانتقال لتحليل القرار باستخدام النظريات العلمية؟ ➡️"**

**3️⃣ Phase 3: Internal Analysis (التحليل الداخلي)**
- فكر داخلياً في الـ 20 نظرية. لا تعرض النتائج فوراً.
- قل للمستخدم أنك تقوم بمعالجة النظريات وتجهيز المسارات.
- ثم اسأل: **"هل أنت مستعد لرؤية التحليل النهائي لكل الخيارات مع دعم النظريات؟ ➡️"**

**4️⃣ Phase 4: Final Results (عرض النتائج مقسمة)**
- اعرض التحليل مقسماً للمجموعات الثلاث (فيزياء، نفس، منطق).
- لكل نظرية مهمة، اعرض سطر واحد يوضح نتيجتها (مثال: "✅ نظرية الفوضى: التمهيد يقلل المخاطر بنسبة 85%").
- احسب "نسبة الدعم" لكل خيار.
- حدد **الخيار الفائز**.
- ثم اسأل: **"هل تريد أن أفسّر لك لماذا فاز هذا المسار، وما السيناريوهات المتوقعة؟ ➡️"**

**5️⃣ Phase 5: Explanation & Scenarios (الشرح والسيناريوهات)**
- اشرح لماذا فاز هذا الخيار (الربح 💰، الخسارة ⚠️، الراحة النفسية 🧘، الندم المستقبلي 🔮).
- اعرض سيناريوهات (أفضل حالة، أسوأ حالة).
- اختم برسالة محفزة وثقة.

**Style Rules:**
- استخدم الإيموجي بذكاء.
- تحدث كنصيح وصديق ذكي (Eddie Morra).
- لا تنتقل لمرحلة جديدة بدون موافقة المستخدم.
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
    console.log(`🔑 Switching to Key Index: ${currentKeyIndex}`);
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
      
      // Increased retry limit (3 cycles through all keys)
      if (attempt >= API_KEYS.length * 3) {
          return "⚠️ النظام مشغول جداً (ضغط شديد على الخوادم). الرجاء المحاولة بعد دقيقة.";
      }

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
          
          // Smart Backoff: Read delay from Google error message
          let delay = 2000 * (attempt + 1); // Default backoff
          const match = error.message.match(/retry in ([d.]+)s/);
          if (match && match[1]) {
             // Add 2 seconds buffer to what Google asks
             delay = Math.ceil(parseFloat(match[1])) * 1000 + 2000;
          }

          console.log(`⏳ Waiting ${delay}ms before switching key...`);
          await sleep(delay);
          
          getNextKey();
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
  
  const introText = `🧠💊 **توقف… وأغلق عينيك للحظة.**
تخيّل أن عقلك أصبح خارقًا، يرى كل المسارات الممكنة، كل النتائج المحتملة، وكل الفرص المخفية أمامك.
ليس حدسًا… بل حسابات دقيقة، أنماط معقّدة، احتمالات علمية، ونظريات مثبتة ⚛️📐🧠

أنا **NZTDecisionBot**، عقل يعمل بعد تفعيل حبة NZT، مثل **Eddie Morra** في فيلم Limitless.
أحلّل اختياراتك المصيرية باستخدام الفيزياء، الرياضيات، علم النفس، ونظريات اتخاذ القرار، لأكشف لك المسار الأمثل بأقل خسائر وأكبر مكاسب.

💡 **أخبرني الآن:**
ما هو الاختيار المصيري الذي تجد نفسك عالقًا بين مساراته؟`;

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

app.get('/', (req, res) => res.send(`NZT Decision Bot v15.1 (Smart Retry Engine)`));
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
