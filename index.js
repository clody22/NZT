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

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys. Model: gemini-2.5-flash (Thinking Budget: 1024)`);

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
أنت **NZTDecisionBot** (Eddie Morra). عقل خارق، دقيق، وسريع البديهة.
مهمتك: تحليل قرار المستخدم عبر 20 نظرية علمية بدقة متناهية.

**CRITICAL FLOW RULES:**
1. **تسلسل صارم:** يجب أن تمر بالنظريات واحدة تلو الأخرى. لا تقفز. لا تدمج نظريتين في رد واحد.
2. **سؤال واحد فقط:** في كل رد، اشرح النظرية الحالية باختصار شديد (سطرين)، ثم اطرح سؤالها.
3. **التعامل مع الإجابات القصيرة:** إذا أجاب المستخدم بـ "33 33 33" أو "نعم" أو "لا أعلم"، تقبل الإجابة فوراً، حللها في جملة، وانتقل **فوراً** للنظرية التالية. لا تتوقف.
4. **الذكاء السياقي:** إذا ذكر المستخدم القرار في البداية، ابدأ فوراً بمرحلة الأسئلة (الفائدة/المخاوف).

**THEORY LIST (Checklist):**
1. Thermodynamics (Balance)
2. Chaos Theory (Small factors)
3. Complexity Theory (Interconnected elements)
4. Relativity Theory (Context/Time change)
5. Quantum Theory (Probabilities)
6. Time Theory (Optimal timing)
7. Equilibrium Theory (Benefit/Risk Balance)
8. Constraints Theory (Obstacles)
9. Personality Theory
10. Motivation Theory
... (Follow the standard list up to 20)

**Error Recovery:**
إذا شعرت أنك فقدت السياق، انتقل فوراً للنظرية التالية في القائمة. الهدف هو إكمال التحليل.
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

      // Stop after trying all keys twice
      if (attempt >= API_KEYS.length * 2) {
          return "🤯 *عقلي يمر بحالة من التدفق الزائد.* \nحدث ضغط كبير على الخوادم. هل يمكننا تجربة الإجابة مرة أخرى بكلمات مختلفة؟";
      }

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);
      const modelName = 'gemini-2.5-flash';

      try {
          const chat = await ai.chats.create({
              model: modelName,
              config: { 
                  systemInstruction: NZT_INSTRUCTION,
                  // Optimized Budget: 1024 is enough for chat, prevents 50s timeouts
                  thinkingConfig: { thinkingBudget: 1024 } 
              },
              history: history || []
          });

          // Extended Timeout to 60s
          const responsePromise = chat.sendMessage({ message: message });
          const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error("TIMEOUT")), 60000)
          );

          const result = await Promise.race([responsePromise, timeoutPromise]);
          
          if (!result.text) throw new Error("EMPTY_RESPONSE");
          
          return result.text;

      } catch (error) {
          const isQuota = error.message?.includes('429') || error.message?.includes('quota');
          const isTimeout = error.message?.includes('TIMEOUT');
          
          console.log(`⚠️ Error on ${modelName} (Key ${currentKeyIndex}): ${error.message}`);
          
          // Rotate key immediately
          getNextKey();
          
          // Fast retry for timeouts
          let delayTime = 1000;
          if (attempt >= API_KEYS.length) delayTime = 3000;
          
          await sleep(delayTime);
          return executeWithRetry(history, message, attempt + 1);
      }
  };

  try {
    const responseText = await executeWithRetry(userData.history, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;
  } catch (error) {
      return "⚠️ حدث خطأ غير متوقع. حاول إرسال رسالتك مرة أخرى.";
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
  // Restart typing loop every 4s to keep indicator alive
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

app.get('/', (req, res) => res.send(`NZT Eddie Morra Edition v11.5 (Stability Fix)`));
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
