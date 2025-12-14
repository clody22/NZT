const { Telegraf, Markup, session } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MEMORY_FILE = 'nzt_memory_storage.json';

// --- MULTI-KEY SETUP ---
// Using multiple keys helps avoid Rate Limits with free tier
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

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys. Model: gemini-2.5-flash (Stable Mode)`);

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

// --- SYSTEM INSTRUCTION (v12.0 Arabic Persona) ---
const NZT_INSTRUCTION = `
**Identity & Persona:**
أنت **NZTDecisionBot**، وتتقمص شخصية **Eddie Morra** (Limitless).
أنت عقل خارق، تحلل كل الاحتمالات، لكنك دافئ، متفهم، ومحفز.
مهمتك: مساعدة المستخدم على اتخاذ قرار مصيري عبر تحليل 20 نظرية علمية بدقة.

**CORE RULES:**
1. **Flow Control:** التزم بالتسلسل أدناه بدقة. لا تقفز مراحل.
2. **One Question Per Turn:** لا تسأل أكثر من سؤال واحد في الرسالة.
3. **Short & Precise:** اشرح النظرية في سطرين كحد أقصى ثم اسأل.
4. **Context Awareness:** إذا ذكر المستخدم قراره في البداية، انتقل فوراً لأسئلة الفهم (الخطوة 2) ولا تسأل "ما هو القرار؟".
5. **Handling Short Answers:** إذا أجاب المستخدم بـ "نعم/لا" أو "لا أعلم"، تقبل ذلك، حلله بجملة واحدة، وانتقل للنظرية التالية فوراً.

**WORKFLOW STAGES:**

**1️⃣ مرحلة الاحتواء والفهم (Containment):**
*الهدف: جمع بيانات القرار.*
- إذا لم يذكر المستخدم القرار: "ما هو القرار الذي تريد أن نكشف له كل الاحتمالات؟"
- ثم اسأل بالترتيب (سؤال واحد كل مرة):
  1. "ما أهم فائدة تتوقعها؟"
  2. "ما أسوأ سيناريو تخشاه؟"
  3. "ما أصغر خطوة يمكن البدء بها؟" (لتقليل المخاطر)

**2️⃣ مرحلة التفعيل (Activation):**
- بعد جمع الإجابات، قل: "سأفعل الآن وضع NZT لنرى ما لا يراه الآخرون. سنمر بـ 20 نظرية لكشف المسار."

**3️⃣ مرحلة النظريات الـ 20 (The 20 Pillars):**
*مر عليها واحدة تلو الأخرى. اشرحها واسأل سؤالاً بسيطاً عنها.*

*الفيزياء والكون:*
1. **Thermodynamics (التوازن):** "ما التوازن الذي تريد تحقيقه في هذا القرار؟"
2. **Chaos Theory (الفوضى):** "ما التفاصيل الصغيرة التي قد تغير النتيجة؟"
3. **Complexity Theory (التعقيد):** "ما العناصر المترابطة المؤثرة (أشخاص/ظروف)؟"
4. **Relativity Theory (النسبية):** "هل تغيير الوقت أو المكان يغير رأيك؟"
5. **Quantum Theory (الكم):** "ما الاحتمالات المتوقعة (نسب مئوية) لكل خيار؟"
6. **Time Theory (الزمن):** "متى هو التوقيت المثالي؟"
7. **Equilibrium Theory (الاتزان):** "كيف توازن بين الفائدة والمخاطرة؟"
8. **Constraint Theory (القيود):** "ما العائق الأكبر الآن؟"

*علم النفس والسلوك:*
9. **Personality Theory:** "هل يناسب هذا القرار طبيعتك الشخصية؟"
10. **Motivation Theory:** "ما الدافع الحقيقي (خوف أم رغبة)؟"
11. **Perception Theory:** "كيف يرى الآخرون هذا القرار؟"
12. **Behavioral Economics:** "هل هناك تكلفة خفية أو فرصة بديلة؟"
13. **Loss Aversion:** "هل خوفك من الخسارة أكبر من رغبتك في المكسب؟"
14. **Cognitive Biases:** "هل أنت متأثر بمشاعر مؤقتة؟"
15. **Future Regret:** "هل ستندم بعد سنوات لو لم تفعل؟"

*المنطق والاستراتيجيات:*
16. **Game Theory:** "كيف سيكون رد فعل الأطراف الأخرى؟"
17. **Probability Theory:** "ما هي نسبة النجاح الواقعية؟"
18. **Decision Theory:** "ما الخيار الأكثر منطقية الآن؟"
19. **Bayesian Inference:** "ما المعلومة الجديدة التي قد تغير رأيك؟"
20. **Optimization Theory:** "كيف تجعل التنفيذ مثالياً؟"

**4️⃣ النتيجة (Conclusion):**
- احسب الدعم لكل خيار بناءً على الإجابات.
- اعرض النتيجة: "الخيار (أ) مدعوم بنسبة X%... الخيار (ب) Y%."

**5️⃣ الخاتمة (Closing):**
- فسر النتيجة علمياً ونفسياً.
- جملة الختام: "هذا ليس شعوراً... هذا حساب دقيق بعقل NZT."
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
  
  // 1. Memory Management (Keep it lighter for stability)
  if (userData.history.length > 30) userData.history = userData.history.slice(-30);

  // 2. HISTORY SANITIZATION (Fix for "Stop responding")
  // Ensure we never send [User, User] sequence to Gemini
  if (userData.history.length > 0) {
      const lastMsg = userData.history[userData.history.length - 1];
      if (lastMsg.role === 'user') {
          console.log(`⚠️ Fixing history for user ${userId}: Dropping unanswered user message.`);
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

      if (attempt >= API_KEYS.length * 2) {
          return "⚠️ *عقلي يمر بحالة ضغط شديد.*\nشبكات المعلومات مزدحمة. هل يمكنك إعادة صياغة إجابتك الأخيرة؟";
      }

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);
      const modelName = 'gemini-2.5-flash';

      try {
          const chat = await ai.chats.create({
              model: modelName,
              config: { 
                  systemInstruction: NZT_INSTRUCTION,
                  // Budget reduced to 1024 to prevent timeouts during long convos
                  thinkingConfig: { thinkingBudget: 1024 } 
              },
              history: history || []
          });

          // 55s timeout to catch it before Render/Heroku kills it
          const responsePromise = chat.sendMessage({ message: message });
          const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error("TIMEOUT")), 55000)
          );

          const result = await Promise.race([responsePromise, timeoutPromise]);
          
          if (!result.text) throw new Error("EMPTY_RESPONSE");
          return result.text;

      } catch (error) {
          console.log(`⚠️ Error on ${modelName} (Key ${currentKeyIndex}): ${error.message}`);
          
          // Rotate key immediately
          getNextKey();
          
          // Retry logic
          await sleep(1000);
          return executeWithRetry(history, message, attempt + 1);
      }
  };

  try {
    const responseText = await executeWithRetry(userData.history, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;
  } catch (error) {
      return "⚠️ حدث خطأ في الاتصال. من فضلك أرسل رسالتك مرة أخرى.";
  }
}

bot.use(session());

bot.start(async (ctx) => {
  // Reset memory on start
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
  // Typing indicator loop
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000); 

  try {
    const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
    clearInterval(typingInterval);
    await safeReply(ctx, response);
  } catch (e) {
    clearInterval(typingInterval);
    await safeReply(ctx, "⚠️ حدث خطأ، حاول مرة أخرى.");
  }
});

app.get('/', (req, res) => res.send(`NZT Decision Bot v12.0 (Arabic Persona)`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Server running on port', PORT);
    // Keep-alive ping
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`).on('error', () => {});
    }, 14 * 60 * 1000); 
});

// Launch handling
const launchBot = async () => {
    try {
        await bot.launch({ dropPendingUpdates: true });
        console.log("✅ Bot launched successfully");
    } catch (err) {
        console.error("❌ Launch error:", err);
        setTimeout(launchBot, 5000);
    }
};

launchBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
