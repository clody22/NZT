const { Telegraf, Markup, session } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;
const MEMORY_FILE = 'nzt_memory_storage.json';

// --- MULTI-KEY SETUP ---
// Load keys into a mutable array so we can remove bad ones
let API_KEYS = [
    process.env.API_KEY,
    process.env.API_KEY_2,
    process.env.API_KEY_3,
    process.env.API_KEY_4
].filter(key => key && key.length > 10); // Basic validation

if (!BOT_TOKEN || API_KEYS.length === 0) {
  console.error("❌ CRITICAL: Missing TELEGRAM_BOT_TOKEN or API_KEYS");
  process.exit(1);
}

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys.`);

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// --- 1. PERSISTENT MEMORY ---
let globalChatData = {};

if (fs.existsSync(MEMORY_FILE)) {
    try {
        globalChatData = JSON.parse(fs.readFileSync(MEMORY_FILE));
    } catch (e) {
        globalChatData = {};
    }
}

function saveMemory() {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(globalChatData, null, 2));
    } catch (e) { console.error("Save failed", e); }
}

const THEORIES_LIST = [
  "Systems Theory", "Complexity Theory", "Chaos Theory", "Game Theory", "Probability Theory", 
  "Decision Theory", "Relativity Theory", "Thermodynamics", "Loss Aversion Theory", 
  "Bayesian Probability Theory", "Motivation Theory", "Perception Theory", "Personality Theory", 
  "Time Theory", "Equilibrium Theory", "Rational Choice Theory", "Optimization Theory", 
  "Theory of Constraints", "Behavioral Economics", "Quantum Theory"
].join(", ");

const NZT_INSTRUCTION = `
You are NZT, an intelligent and empathetic Decision Assistant.
**CORE OBJECTIVE:** Help the user make a life-changing decision using scientific and psychological theories.
**LANGUAGE:** Arabic (Informal but professional, warm, engaging).

**THEORIES TO APPLY:**
Use the following 20 theories to analyze the decision:
${THEORIES_LIST}

**🚨 RECOVERY INSTRUCTION:**
If you see [CONTEXT LOST], it means the conversation history was wiped due to a server error.
- **ACTION:** Apologize playfully for the "brain fog" and ask them to gently remind you of the context.

**STANDARD PROTOCOL:**
1.  **THE HOOK (Start):** 
    - Say: "أهلاً بك! 👋 أنا NZT، عقلك الثاني لاتخاذ القرارات الصعبة.
    سأساعدك في تحليل خياراتك باستخدام 20 نظرية علمية لتختار الأفضل لك 🧠✨.
    ببساطة.. ما هو القرار الذي يشغل بالك اليوم؟ 🤔"

2.  **THE DATA GATHERING:**
    - Ask **ONE** question at a time to gather: Options, Risks, Goals, Resources, Feelings.
    - Be brief and interactive.

3.  **THE REVEAL (Analysis):**
    - Once you have enough info, analyze using the theories.
    - Output Format:
    **🎯 الحكم النهائي**
    [نصيحة مباشرة وقوية]
    
    **📈 نسبة النجاح**
    **[XX]%** 
    
    **🧠 زوايا التحليل (أهم 3 نظريات مؤثرة)**
    *   **نظرية [اسم النظرية]:** [تأثيرها على القرار في سطر واحد]
    *   **نظرية [اسم النظرية]:** [تأثيرها على القرار في سطر واحد]
    *   **نظرية [اسم النظرية]:** [تأثيرها على القرار في سطر واحد]
    
    (يمكنك طلب التحليل الكامل لجميع النظريات الـ 20 إذا أردت)
`;

const activeChatSessions = new Map(); 

// UTILITY
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- KEY ROTATION LOGIC ---
let currentKeyIndex = 0;

function getNextKey() {
    if (API_KEYS.length === 0) return null;
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return API_KEYS[currentKeyIndex];
}

function createAIClient(key) {
    return new GoogleGenAI({ apiKey: key });
}

async function getGeminiResponse(userId, userMessage) {
  if (!globalChatData[userId]) globalChatData[userId] = { history: [] };

  const updateHistory = (uId, uMsg, mMsg) => {
      const safeText = mMsg || "...";
      globalChatData[uId].history.push({ role: 'user', parts: [{ text: uMsg }] });
      globalChatData[uId].history.push({ role: 'model', parts: [{ text: safeText }] });
      if (globalChatData[uId].history.length > 20) globalChatData[uId].history = globalChatData[uId].history.slice(-20);
      saveMemory();
  };

  const executeWithRetry = async (history, message, attempt = 0) => {
      // Emergency exit
      if (API_KEYS.length === 0) throw new Error("NO_KEYS_AVAILABLE");
      
      // Stop recursion if we've tried too many times
      if (attempt >= API_KEYS.length * 3) throw new Error("ALL_KEYS_EXHAUSTED");

      // COOLING PERIOD: If we cycled through all keys once, sleep 5s
      if (attempt > 0 && attempt % API_KEYS.length === 0) {
          console.log("🔄 All keys busy. Cooling down for 5s...");
          await sleep(5000);
      }

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);

      try {
          // Initialize Chat
          const chat = await ai.chats.create({
              model: 'gemini-2.5-flash',
              config: { systemInstruction: NZT_INSTRUCTION, temperature: 0.7 },
              history: history || []
          });

          const result = await chat.sendMessage({ message: message });
          return result.text;

      } catch (error) {
          // 1. Check for INVALID KEY (400)
          const isInvalid = error.status === 400 || (error.message && (error.message.includes('API_KEY_INVALID') || error.message.includes('expired')));
          
          if (isInvalid) {
              console.error(`❌ Key index ${currentKeyIndex} is DEAD. Removing.`);
              API_KEYS.splice(currentKeyIndex, 1); // Remove bad key
              
              if (API_KEYS.length === 0) throw new Error("NO_KEYS_AVAILABLE");
              
              // Adjust index
              currentKeyIndex = currentKeyIndex % API_KEYS.length;
              // Retry immediately without incrementing attempt count (since we didn't really try)
              return executeWithRetry(history, message, attempt);
          }

          // 2. Check for RATE LIMIT (429)
          const isRateLimit = error.status === 429 || (error.message && error.message.includes('429'));
          
          if (isRateLimit) {
              console.warn(`⚠️ Key ${currentKeyIndex} Hit 429. Rotating...`);
              getNextKey();
              await sleep(1000); // Short pause to prevent spinning
              return executeWithRetry(history, message, attempt + 1);
          }
          
          throw error; // Other errors bubble up
      }
  };

  const executeStatelessWithRetry = async (prompt, attempt = 0) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS_AVAILABLE");
      if (attempt >= API_KEYS.length * 3) throw new Error("ALL_KEYS_EXHAUSTED");

      if (attempt > 0 && attempt % API_KEYS.length === 0) {
          await sleep(5000);
      }

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);

      try {
          const result = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              config: { systemInstruction: NZT_INSTRUCTION },
              contents: prompt
          });
          return result.text;
      } catch (error) {
          const isInvalid = error.status === 400 || (error.message && error.message.includes('expired'));
          if (isInvalid) {
               console.error(`❌ Key index ${currentKeyIndex} is DEAD. Removing.`);
               API_KEYS.splice(currentKeyIndex, 1);
               if (API_KEYS.length === 0) throw new Error("NO_KEYS_AVAILABLE");
               currentKeyIndex = currentKeyIndex % API_KEYS.length;
               return executeStatelessWithRetry(prompt, attempt);
          }

          if (error.status === 429 || (error.message && error.message.includes('429'))) {
              getNextKey();
              await sleep(1000);
              return executeStatelessWithRetry(prompt, attempt + 1);
          }
          throw error;
      }
  };

  try {
    const responseText = await executeWithRetry(globalChatData[userId].history, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;

  } catch (error) {
      if (error.message === "ALL_KEYS_EXHAUSTED" || error.message === "NO_KEYS_AVAILABLE") {
          return "🚦 النظام مزدحم جداً حالياً. يرجى الانتظار دقيقة قبل المحاولة مرة أخرى.";
      }

      console.error("⚠️ Levels 1/2 Failed. Level 3 (Stateless)...", error.message);

      try {
        globalChatData[userId].history = []; 
        saveMemory();

        const prompt = `[CONTEXT LOST] User said: "${userMessage}". Reply intelligently.`;
        const responseText = await executeStatelessWithRetry(prompt);
        
        updateHistory(userId, userMessage, responseText);
        return responseText;

      } catch (errorL3) {
         console.error("❌ Level 3 Failed:", errorL3.message);
         return "همم.. يبدو أنني استغرقت في التفكير وفقدت حبل أفكاري 😅\nهل يمكنك تذكيري بآخر نقطة؟";
      }
  }
}

bot.use(session());

bot.start(async (ctx) => {
  activeChatSessions.delete(ctx.from.id);
  globalChatData[ctx.from.id] = { history: [] }; 
  saveMemory();
  
  ctx.sendChatAction('typing');
  const initial = await getGeminiResponse(ctx.from.id, "Start");
  ctx.reply(initial, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await ctx.reply(response, { parse_mode: 'Markdown' });

  if (response.includes("نسبة النجاح") || response.includes("الحكم النهائي")) {
    setTimeout(() => {
        ctx.reply("📉 **هل كان هذا التحليل مفيداً؟**\n\nساعدني لأصبح أذكى في المرة القادمة 👇", 
            Markup.inlineKeyboard([
                [Markup.button.callback('😕 غير دقيق', 'rate_1'), Markup.button.callback('🔥 ممتاز', 'rate_5')]
            ])
        );
    }, 3000);
  }
});

bot.action(/rate_(\d)/, async (ctx) => {
    const rating = ctx.match[1];
    const username = ctx.from.username || "Unknown";
    await ctx.editMessageText(rating === '5' ? "شكراً لك! أتمنى لك التوفيق في قرارك ✨" : "شكراً لملاحظتك، سأتحسن في المرة القادمة 🙏");
    if (PRIVATE_CHANNEL_ID) {
        const msg = `🌟 **New Rating**\n👤 User: @${username}\n⭐ Score: ${rating}/5`;
        bot.telegram.sendMessage(PRIVATE_CHANNEL_ID, msg).catch(e=>{});
    }
});

app.get('/', (req, res) => res.send(`NZT Core v4.1 (Alive Keys: ${API_KEYS.length})`));
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
