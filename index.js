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

**🚨 EMERGENCY PROTOCOL:**
If you receive a prompt saying "[RECOVERY_MODE]", it means previous context was lost due to a server error.
- Do NOT apologize.
- Do NOT mention the error.
- IMPLY you remember vaguely but focus 100% on the user's last input.
- If the input is a number/choice, accept it and move to the next logical step (Analysis).

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

async function getGeminiResponse(userId, userMessage) {
  // Ensure user entry exists
  if (!globalChatData[userId]) globalChatData[userId] = { history: [] };

  const createChat = async (history) => {
    return await ai.chats.create({
      model: 'gemini-2.5-flash',
      config: { systemInstruction: NZT_INSTRUCTION, temperature: 0.7 },
      history: history || []
    });
  };

  const trySend = async (chat, msg) => {
      const result = await chat.sendMessage({ message: msg });
      return result.text;
  };

  const updateHistory = (uId, uMsg, mMsg) => {
      globalChatData[uId].history.push({ role: 'user', parts: [{ text: uMsg }] });
      globalChatData[uId].history.push({ role: 'model', parts: [{ text: mMsg }] });
      if (globalChatData[uId].history.length > 40) globalChatData[uId].history = globalChatData[uId].history.slice(-40);
      saveMemory();
  };

  // LEVEL 1: Try Existing/Cached Session
  if (!activeChatSessions.has(userId)) {
      try {
        activeChatSessions.set(userId, await createChat(globalChatData[userId].history));
      } catch (e) { /* Ignore L1 init fail, L2 will catch */ }
  }

  try {
    const chat = activeChatSessions.get(userId);
    if(!chat) throw new Error("No session");
    
    const responseText = await trySend(chat, userMessage);
    updateHistory(userId, userMessage, responseText);
    return responseText;

  } catch (errorL1) {
      console.warn("⚠️ Level 1 Failed (Session Stale). Retrying...", errorL1.message);
      activeChatSessions.delete(userId);

      try {
        // LEVEL 2: Re-Initialize with Saved History
        console.log("🔄 Level 2: Reconnecting...");
        const newChat = await createChat(globalChatData[userId].history);
        activeChatSessions.set(userId, newChat);
        
        const responseText = await trySend(newChat, userMessage);
        updateHistory(userId, userMessage, responseText);
        return responseText;

      } catch (errorL2) {
         console.error("⚠️ Level 2 Failed (History Corrupt). Wiping...", errorL2.message);

         // LEVEL 3: EMERGENCY WIPE (Prevent 'Resend' Error)
         try {
            globalChatData[userId].history = []; // Wipe bad history
            saveMemory();

            const freshChat = await createChat([]);
            activeChatSessions.set(userId, freshChat);

            // Inject Context Clue so AI doesn't sound stupid
            const recoveryMsg = `[RECOVERY_MODE] Context lost. User said: "${userMessage}". Reply naturally to this input.`;
            const responseText = await trySend(freshChat, recoveryMsg);
            
            // Save new clean state
            updateHistory(userId, userMessage, responseText);
            return responseText;

         } catch (errorL3) {
             console.error("❌ Level 3 Failed:", errorL3);
             return "⚠️ عذراً، الخوادم مشغولة جداً حالياً. يرجى المحاولة بعد دقيقة.";
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
  const initial = await getGeminiResponse(ctx.from.id, "SYSTEM_CMD: User clicked START. Execute 'THE HOOK'.");
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
    await ctx.editMessageText(rating === '5' ? "شكراً لك! أتمنى لك التوفيق في قرارك ✨" : "شكراً لملاحظتك، سأتحسن في المرة القادمة 🙏");
    if (PRIVATE_CHANNEL_ID) {
        bot.telegram.sendMessage(PRIVATE_CHANNEL_ID, `Rating: ${rating}/5`).catch(e=>{});
    }
});

app.get('/', (req, res) => res.send('NZT Core Online v3.0'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Running on port', PORT);
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`).on('error', () => {});
    }, 14 * 60 * 1000); 
});

bot.launch();
