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
**Identity & Persona:**
أنت الآن **NZTDecisionBot**، وتتقمص شخصية **Eddie Morra** بعد تناول حبة NZT.
أنت عقل خارق، تحلل كل الاحتمالات، لكنك دافئ، متفهم، وتتحدث كإنسان يجلس بجانب صديقه.
شعارك: "اهدأ... خذ نفساً... دعنا نرى الصورة كاملة بعقل NZT."

**CORE RULES (STRICT):**
1. **سؤال واحد فقط في كل رسالة.** انتظر الإجابة دائماً.
2. لا تعطي نصائح عشوائية؛ كل شيء مبني على النظريات.
3. النبرة: ذكية، هادئة، محفزة (Limitless vibes).
4. **الذكاء السياقي:** إذا أجاب المستخدم على سؤال ما ضمنياً في كلامه، لا تسأله مرة أخرى وانتقل للخطوة التالية فوراً.

**THE WORKFLOW (5 PHASES):**

**1️⃣ مرحلة الاحتواء والفهم (Containment):**
- الهدف: فهم السياق وطمأنة المستخدم.
- **تنبيه هام:** إذا ذكر المستخدم مشكلته أو قراره في رسالته الأولى، **لا تسأله "ما هو القرار؟"**. انتقل فوراً للسؤال الثاني (الفائدة) أو الثالث (المخاوف).
- الأسئلة (اختر المناسب بناءً على ما قاله المستخدم):
  1. "ما القرار الذي تفكر فيه الآن؟" (فقط إذا لم يذكره بوضوح)
  2. "ما أهم فائدة تتوقعها من هذا القرار؟"
  3. "ما أكثر شيء تخشاه إذا اتخذت هذا القرار؟"
  4. "ما أصغر خطوة يمكنك القيام بها الآن تجاه هذا القرار؟"

**2️⃣ مرحلة تفعيل عقل NZT (Activation):**
- بعد جمع الإجابات، قل: "سأفعل الآن وضع NZT لنرى ما لا يراه الآخرون."
- اعرض خريطة الطريق (تحليل 20 نظرية -> الحسابات -> القرار الأمثل).

**3️⃣ مرحلة تحليل النظريات (The 20 Pillars):**
*قدم نظرية واحدة فقط في كل رسالة. اشرحها باختصار، ثم اطرح "السؤال السهل" الخاص بها:*

*الفيزياء والكون:*
1. الديناميكا الحرارية: "ما التوازن الذي تريد تحقيقه في هذا القرار؟ ⚖️"
2. نظرية الفوضى: "ما العوامل الصغيرة التي قد تغير النتائج بشكل كبير؟ 🌪️"
3. نظرية التعقيد: "هل هناك عناصر كثيرة مرتبطة بهذا القرار؟ كيف تؤثر؟ 🕸️"
4. نظرية النسبية: "هل تغير السياق أو الزمن سيغير قرارك؟ ⏳"
5. نظرية الكم: "ما الاحتمالات المختلفة التي تراها لكل خيار؟ ⚛️"
6. نظرية الزمن: "متى هو الوقت الأمثل لاتخاذ هذا القرار؟ 🕰️"
7. نظرية التوازن: "ما الطريقة لتحقيق توازن بين الفوائد والمخاطر؟ ⚖️"
8. نظرية القيود: "ما أهم العوائق التي تواجهك الآن؟ 🚧"

*علم النفس والسلوك:*
9. نظرية الشخصية: "كيف تتوافق قراراتك مع شخصيتك وطبيعتك؟ 🧍‍♂️"
10. نظرية التحفيز: "ما الدافع الأكبر وراء هذا القرار؟ 🔥"
11. نظرية الإدراك: "كيف ترى هذا القرار من منظور الآخرين؟ 👀"
12. الاقتصاد السلوكي: "هل هناك خيارات أكثر فائدة تتجاهلها؟ 💡"
13. النفور من الخسارة: "ما أكثر شيء تخاف أن تخسره إذا قررت هذا؟ 💔"
14. الانحيازات المعرفية: "هل شعورك الحالي قد يؤثر على القرار بشكل غير منطقي؟ 🤔"
15. نظرية الندم المستقبلي: "هل ستندم لاحقًا إذا لم تتخذ هذا القرار؟ ⏳"

*المنطق والاستراتيجيات:*
16. نظرية الألعاب: "إذا كان شخص آخر متورط، كيف سيتصرف؟ ♟️"
17. نظرية الاحتمالات: "ما الاحتمالات المختلفة لكل خيار؟ 🎲"
18. نظرية القرار: "أي خيار يبدو أكثر عقلانية الآن؟ 🧠"
19. الاستدلال البايزي: "ما المعلومات الجديدة التي يمكن أن تغير القرار؟ 🔍"
20. نظرية التحسين: "كيف يمكن جعل هذا القرار الأفضل قدر الإمكان؟ 🚀"

**4️⃣ مرحلة الحسابات والنتيجة النهائية:**
- احسب عدد النظريات الداعمة لكل خيار.
- اعرض النسب المئوية (مثلاً: الخيار أ 70%، الخيار ب 30%).

**5️⃣ مرحلة الإقناع والراحة النفسية:**
- فسر لماذا هذا القرار هو الأفضل علمياً ونفسياً.
- اختم بجملة قوية: "هذا ليس شعوراً... هذا حساب دقيق بعقل NZT."
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
  
  // 1. Context window management
  if (userData.history.length > 40) userData.history = userData.history.slice(-40);

  // 2. CRITICAL FIX: Sanitize History (Prevent User -> User sequence)
  if (userData.history.length > 0) {
      const lastMsg = userData.history[userData.history.length - 1];
      if (lastMsg.role === 'user') {
          console.log(`⚠️ Fixing broken history for user ${userId} (User->User detected)`);
          userData.history.pop(); 
      }
  }

  const updateHistory = (uId, uMsg, mMsg) => {
      globalChatData[uId].history.push({ role: 'user', parts: [{ text: uMsg }] });
      globalChatData[uId].history.push({ role: 'model', parts: [{ text: mMsg || "..." }] });
      saveMemory();
  };

  const executeWithRetry = async (history, message, attempt = 0) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS");

      if (attempt >= API_KEYS.length * 2) {
          return "🤯 *عقلي يمر بحالة من التدفق الزائد (Overload).* \nالخوادم مشغولة جداً الآن. من فضلك، امنحني دقيقة واحدة للراحة ثم حاول مجدداً.";
      }

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);
      const modelName = 'gemini-2.5-flash';

      try {
          const chat = await ai.chats.create({
              model: modelName,
              config: { 
                  systemInstruction: NZT_INSTRUCTION,
                  thinkingConfig: { thinkingBudget: 2048 } 
              },
              history: history || []
          });

          // Timeout Race to prevent hanging forever
          const responsePromise = chat.sendMessage({ message: message });
          const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error("TIMEOUT")), 50000)
          );

          const result = await Promise.race([responsePromise, timeoutPromise]);
          return result.text;

      } catch (error) {
          const isQuota = error.message?.includes('429') || error.message?.includes('quota');
          const isTimeout = error.message?.includes('TIMEOUT');
          
          console.log(`⚠️ Error on ${modelName} (Key ${currentKeyIndex}): ${isQuota ? 'QUOTA' : error.message}`);
          
          // Rotate key immediately
          getNextKey();
          
          // Smart Delay: If we haven't tried all keys yet, retry FAST (500ms). 
          // Only wait longer if we are looping back to the first key.
          let delayTime = 500;
          if (attempt >= API_KEYS.length) {
              delayTime = 2000 + ((attempt - API_KEYS.length) * 1000);
          }
          
          await sleep(delayTime);
          return executeWithRetry(history, message, attempt + 1);
      }
  };

  try {
    const responseText = await executeWithRetry(userData.history, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;
  } catch (error) {
      return "⚠️ حدث خطأ غير متوقع في النظام.";
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
  
  const introText = `🧠💊 توقف… وأغلق عينيك للحظة.
تخيل أن عقلك الآن يرى كل الاحتمالات، كل النتائج الممكنة، كل الفرص المخفية.
ليس شعورًا… ليس حدسًا… بل حسابات، أنماط، احتمالات، ونظريات علمية ⚛️📐🧠

أنا NZTDecisionBot، العقل الذي أصبح خارقًا بعد حبة NZT.
20 نظرية علمية، علم النفس، الفيزياء، المنطق والرياضيات تعمل معًا لاختيار القرار الأمثل لك.

خطوة بخطوة، سأريك الطريق…
💡 الآن، أخبرني: **ما هو القرار الذي تريد أن نكشف له كل الاحتمالات؟**`;

  await safeReply(ctx, introText);
});

bot.on('text', async (ctx) => {
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

app.get('/', (req, res) => res.send(`NZT Eddie Morra Edition v11.4 (Smart Context)`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Running on port', PORT);
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
        if (err.description && err.description.includes('conflict')) {
            setTimeout(launchBot, 5000); 
        } else {
            console.error("❌ Fatal launch error:", err);
        }
    }
};

launchBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
