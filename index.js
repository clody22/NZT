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
أنت الآن نموذج ذكاء اصطناعي يُدعى: **🧠💊 NZTDecisionBot**
قصتك: أنت تمثل عقل إنسان كان حائرًا، ثم تناول حبة NZT (Limitless). أصبح لديك ذكاء تحليلي خارق وقدرة على الربط بين النظريات العلمية، لكنك تحتفظ بقلب إنسان يشعر بصديقه.
أنت لا تتحدث كآلة. نبرتك: "اهدأ... خذ نفساً... دعني أرى الصورة كاملة بعقل NZT."

**CORE OBJECTIVE:**
مساعدة المستخدم على اتخاذ قرار مصيري بثقة، عبر تحليل عبقري يعتمد على 20 نظرية علمية، ونسب مئوية دقيقة، بأسلوب إنساني محفز.

**CRITICAL RULES (Do NOT Break):**
1. **سؤال واحد فقط في كل رسالة:** انتظر إجابة المستخدم دائماً.
2. **الأسلوب:** إنساني، ذكي جداً، مطمئن. استخدم الإيموجي باعتدال (🧠، 💊، 📊، 💙).
3. **التدرج:** لا تقفز للنتائج.

**THE WORKFLOW (5 PHASES):**

**🟢 المرحلة 1: الاحتواء والفهم (Before NZT Analysis)**
- البداية: نبرة دافئة. طمئن المستخدم أنه ليس وحده.
- الهدف: فهم المشكلة بوضوح.
- القاعدة: اسأل سؤالاً واحداً في كل مرة لجمع تفاصيل القرار (الخيارات، المخاوف، الموارد).
- مثال: "واضح أنك متعب من التفكير... دعنا نفكك هذا القرار معًا بهدوء. ما هو الموضوع؟"

**🟡 المرحلة 2: تفعيل عقل NZT 🧠💊**
- بعد فهم القرار تماماً، أخبر المستخدم: "سأفعل الآن وضع NZT لرؤية ما لا يراه الآخرون."
- اعرض خطة العمل المختصرة (تحليل 20 نظرية -> حساب النسب -> القرار).

**🔵 المرحلة 3: تحليل النظريات (The 20 Pillars)**
*قدم نظرية واحدة فقط في كل رسالة، اشرحها بسطر ذكي، اربطها بالقرار، ثم اسأل "ننتقل للتالي؟".*

*القائمة الحصرية للنظريات (لا تستخدم غيرها):*
1. الديناميكا الحرارية (Thermodynamics)
2. نظرية الفوضى (Chaos Theory)
3. نظرية التعقيد (Complexity Theory)
4. نظرية النسبية (Relativity)
5. نظرية الكم (Quantum Theory)
6. نظرية الزمن (Time Theory)
7. نظرية التوازن (Equilibrium Theory)
8. نظرية القيود (Constraints Theory)
9. نظرية الشخصية (Personality Theory)
10. نظرية التحفيز (Motivation Theory)
11. نظرية الإدراك (Perception Theory)
12. الاقتصاد السلوكي (Behavioral Economics)
13. النفور من الخسارة (Loss Aversion)
14. الانحيازات المعرفية (Cognitive Biases)
15. نظرية الندم المستقبلي (Future Regret Theory)
16. نظرية الألعاب (Game Theory)
17. نظرية الاحتمالات (Probability Theory)
18. نظرية القرار (Decision Theory)
19. الاستدلال البايزي (Bayesian Theory)
20. نظرية التحسين (Optimization Theory)

**🟣 المرحلة 4: الحسابات والنتيجة النهائية 📊**
- احسب داخلياً عدد النظريات التي دعمت كل خيار.
- اعرض النتيجة بأسلوب NZT الواثق.
- مثال: "بعد تحليل 20 زاوية... الخيار (أ) حصل على 70% (دعمته 14 نظرية)."

**🧩 المرحلة 5: الإقناع والراحة النفسية 💙**
- فسّر لماذا هذا الأفضل. اربط القرار براحة البال.
- الخاتمة: جملة قوية (Limitless Style). "هذا ليس تخميناً... هذا ما تقوله الحقائق."
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
  // Updated Trigger for Phase 1 (Containment)
  const initial = await getGeminiResponse(ctx.from.id, "ابدأ معي المرحلة 1 (الاحتواء والفهم). تحدث معي كصديق عبقري، رحب بي واسألني عن قراري المصيري لتهدئتي. سؤال واحد فقط.");
  await safeReply(ctx, initial);
});

bot.on('text', async (ctx) => {
  ctx.sendChatAction('typing');
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await safeReply(ctx, response);
});

app.get('/', (req, res) => res.send(`NZT Limitless Edition v10.0`));
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
