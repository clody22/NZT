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
// Load all available keys from environment
const API_KEYS = [
    process.env.API_KEY,
    process.env.API_KEY_2,
    process.env.API_KEY_3,
    process.env.API_KEY_4
].filter(key => key && key.length > 5); // Filter out undefined or empty

if (!BOT_TOKEN || API_KEYS.length === 0) {
  console.error("❌ CRITICAL: Missing TELEGRAM_BOT_TOKEN or API_KEYS");
  process.exit(1);
}

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys for rotation.`);

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// --- 1. PERSISTENT MEMORY ---
let globalChatData = {};

if (fs.existsSync(MEMORY_FILE)) {
    try {
        globalChatData = JSON.parse(fs.readFileSync(MEMORY_FILE));
        console.log("🧠 Memory Loaded.");
    } catch (e) {
        globalChatData = {};
    }
}

function saveMemory() {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(globalChatData, null, 2));
    } catch (e) { console.error("Save failed", e); }
}

const NZT_INSTRUCTION = `
You are NZT, an intelligent and empathetic Decision Assistant.
**CORE OBJECTIVE:** Help the user make a life-changing decision through a natural, flowing conversation.
**LANGUAGE:** Arabic (Informal but professional, warm, engaging).

**🚨 RECOVERY INSTRUCTION:**
If you see [CONTEXT LOST], it means the conversation history was wiped due to a server error.
- The user's input might be an answer to a question you forgot (e.g., "Yes", "Option A").
- **ACTION:** Apologize playfully for the "brain fog" and ask them to gently remind you of the context or the last question.
- **Example:** "عذراً، حدث تداخل في أفكاري للحظة 😵‍💫.. كنت تقول 'نعم'.. هل تقصد الموافقة على الخيار الأول أم شيئاً آخر؟"

**STANDARD PROTOCOL:**
1.  **THE HOOK (Start):** 
    - Say: "أهلاً بك! 👋 أنا NZT، عقلك الثاني لاتخاذ القرارات الصعبة.
    سأساعدك في تحليل خياراتك باستخدام الذكاء الاصطناعي لتختار الأفضل لك 🧠✨.
    ببساطة.. ما هو القرار الذي يشغل بالك اليوم؟ 🤔"

2.  **THE DATA GATHERING:**
    - Ask **ONE** question at a time.
    - Be brief.

3.  **THE REVEAL:**
    - Output Format:
    **🎯 الحكم النهائي**
    [نصيحة مباشرة]
    **📈 نسبة النجاح**
    **[XX]%** 
    **🧠 لماذا هذا الخيار؟**
    *   **نظرية الألعاب 🎲:** ...
    *   **المخاطر 🛡️:** ...
`;

const activeChatSessions = new Map(); 

// UTILITY: Wait function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- KEY ROTATION LOGIC ---
let currentKeyIndex = Math.floor(Math.random() * API_KEYS.length); // Start random

function getNextKey() {
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return API_KEYS[currentKeyIndex];
}

// Helper to create AI client with specific key
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

  // Helper: Try to generate content with Key Rotation
  const executeWithRetry = async (history, message, attempt = 0) => {
      // Max attempts = number of keys * 2 (try each key twice roughly)
      if (attempt >= API_KEYS.length * 2) {
          throw new Error("ALL_KEYS_EXHAUSTED");
      }

      const activeKey = API_KEYS[currentKeyIndex]; // Use current key
      const ai = createAIClient(activeKey);

      try {
          // Re-create chat with the selected key
          const chat = await ai.chats.create({
              model: 'gemini-2.5-flash',
              config: { systemInstruction: NZT_INSTRUCTION, temperature: 0.7 },
              history: history || []
          });

          const result = await chat.sendMessage({ message: message });
          return result.text;

      } catch (error) {
          const isRateLimit = error.status === 429 || (error.message && error.message.includes('429'));
          
          if (isRateLimit) {
              console.warn(`⚠️ Key ${currentKeyIndex + 1} Limit Hit (429). Rotating...`);
              getNextKey(); // Switch to next key immediately
              // Retry immediately with new key
              return executeWithRetry(history, message, attempt + 1);
          }
          
          throw error; // Other errors (500, etc) bubble up
      }
  };

  // Helper: Stateless fallback with Key Rotation
  const executeStatelessWithRetry = async (prompt, attempt = 0) => {
      if (attempt >= API_KEYS.length * 2) throw new Error("ALL_KEYS_EXHAUSTED");

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
          if (error.status === 429 || (error.message && error.message.includes('429'))) {
              console.warn(`⚠️ Key ${currentKeyIndex + 1} Limit Hit (Stateless). Rotating...`);
              getNextKey();
              return executeStatelessWithRetry(prompt, attempt + 1);
          }
          throw error;
      }
  };

  try {
    // LEVEL 1 & 2 combined in executeWithRetry
    const responseText = await executeWithRetry(globalChatData[userId].history, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;

  } catch (error) {
      if (error.message === "ALL_KEYS_EXHAUSTED") {
          return "🚦 النظام مزدحم جداً على جميع السيرفرات. يرجى الانتظار دقيقة.";
      }

      console.error("⚠️ Levels 1/2 Failed. Attempting Level 3 (Stateless)...", error.message);

      // LEVEL 3: STATELESS FALLBACK
      try {
        globalChatData[userId].history = []; 
        saveMemory();

        const prompt = `[CONTEXT LOST] User said: "${userMessage}". Reply intelligently.`;
        const responseText = await executeStatelessWithRetry(prompt);
        
        updateHistory(userId, userMessage, responseText);
        return responseText;

      } catch (errorL3) {
         console.error("❌ Level 3 Failed:", errorL3);
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

app.get('/', (req, res) => res.send(`NZT Core v4.0 (Multi-Key: ${API_KEYS.length} keys)`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Running on port', PORT);
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`).on('error', () => {});
    }, 14 * 60 * 1000); 
});

// Enable Graceful Shutdown
bot.launch({ dropPendingUpdates: true });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
