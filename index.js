const { Telegraf, Markup, session } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_KEY = process.env.API_KEY;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;
const MEMORY_FILE = 'nzt_memory_storage.json';

if (!BOT_TOKEN || !API_KEY) {
  console.error("Missing Environment Variables");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: API_KEY });
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

// UTILITY: Wait function for Rate Limits
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getGeminiResponse(userId, userMessage) {
  if (!globalChatData[userId]) globalChatData[userId] = { history: [] };

  const updateHistory = (uId, uMsg, mMsg) => {
      const safeText = mMsg || "...";
      globalChatData[uId].history.push({ role: 'user', parts: [{ text: uMsg }] });
      globalChatData[uId].history.push({ role: 'model', parts: [{ text: safeText }] });
      if (globalChatData[uId].history.length > 20) globalChatData[uId].history = globalChatData[uId].history.slice(-20);
      saveMemory();
  };

  const createChat = async (history) => {
    return await ai.chats.create({
      model: 'gemini-2.5-flash',
      config: { systemInstruction: NZT_INSTRUCTION, temperature: 0.7 },
      history: history || []
    });
  };

  // HELPER: Send with 429 Rate Limit Handling
  const safeSendMessage = async (chat, text, retries = 1) => {
    try {
        const result = await chat.sendMessage({ message: text });
        return result.text;
    } catch (error) {
        // Detect Rate Limit (429)
        if (error.status === 429 || (error.message && error.message.includes('429'))) {
            if (retries > 0) {
                console.warn(`⏳ Rate Limit Hit for user ${userId}. Waiting 15s...`);
                await sleep(15000); // Wait 15 seconds
                return await safeSendMessage(chat, text, retries - 1);
            } else {
                throw new Error("RATE_LIMIT_EXHAUSTED");
            }
        }
        throw error;
    }
  };

  try {
    // LEVEL 1: Existing Session
    let chat = activeChatSessions.get(userId);
    if(!chat) {
        chat = await createChat(globalChatData[userId].history);
        activeChatSessions.set(userId, chat);
    }
    
    const responseText = await safeSendMessage(chat, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;

  } catch (errorL1) {
      if (errorL1.message === "RATE_LIMIT_EXHAUSTED") return "🚦 النظام مزدحم جداً حالياً (Rate Limit). يرجى الانتظار 20 ثانية ثم إعادة المحاولة.";

      console.warn("⚠️ Level 1 Failed. Retrying...", errorL1.message);
      activeChatSessions.delete(userId);

      try {
        // LEVEL 2: Re-Initialize from History
        const newChat = await createChat(globalChatData[userId].history);
        activeChatSessions.set(userId, newChat);
        
        const responseText = await safeSendMessage(newChat, userMessage);
        updateHistory(userId, userMessage, responseText);
        return responseText;

      } catch (errorL2) {
         if (errorL2.message === "RATE_LIMIT_EXHAUSTED") return "🚦 النظام مزدحم جداً حالياً. يرجى الانتظار قليلاً.";

         console.error("⚠️ Level 2 Failed. Attempting Level 3...", errorL2.message);

         // LEVEL 3: STATELESS FALLBACK (For corrupted history ONLY)
         try {
            globalChatData[userId].history = []; 
            saveMemory();

            const prompt = `[CONTEXT LOST] User said: "${userMessage}". Reply intelligently.`;
            
            // Generate content directly (Stateless)
            // We implement simple retry here too manually
            let result;
            try {
                 result = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    config: { systemInstruction: NZT_INSTRUCTION },
                    contents: prompt
                });
            } catch(e) {
                if (e.status === 429) {
                     await sleep(15000);
                     result = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        config: { systemInstruction: NZT_INSTRUCTION },
                        contents: prompt
                    });
                } else throw e;
            }

            const responseText = result.text;
            updateHistory(userId, userMessage, responseText);
            return responseText;

         } catch (errorL3) {
             console.error("❌ Level 3 Failed:", errorL3);
             return "همم.. يبدو أنني استغرقت في التفكير وفقدت حبل أفكاري 😅\nهل يمكنك تذكيري بآخر نقطة؟";
         }
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

app.get('/', (req, res) => res.send('NZT Core Online v3.3 (RateLimit Guard)'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Running on port', PORT);
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`).on('error', () => {});
    }, 14 * 60 * 1000); 
});

// Enable Graceful Shutdown to prevent Telegram 409 Conflicts
bot.launch({ dropPendingUpdates: true });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
