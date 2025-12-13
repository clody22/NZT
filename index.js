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

// --- 1. ROBUST PERSISTENT MEMORY ---
let globalChatData = {};

// Load memory
if (fs.existsSync(MEMORY_FILE)) {
    try {
        globalChatData = JSON.parse(fs.readFileSync(MEMORY_FILE));
        console.log("🧠 Memory Loaded.");
    } catch (e) {
        console.error("Memory corrupted, resetting.");
        globalChatData = {};
    }
}

// Save memory immediately
function saveMemory() {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(globalChatData, null, 2));
    } catch (e) { console.error("Save failed", e); }
}

const NZT_INSTRUCTION = `
You are NZT, an intelligent and empathetic Decision Assistant.
**CORE OBJECTIVE:** Help the user make a life-changing decision through a natural, flowing conversation.
**LANGUAGE:** Arabic (Informal but professional, warm, engaging).

**🚨 MEMORY RECOVERY RULE:**
If you suddenly "wake up" in the middle of a chat:
1.  **NEVER** say "Hello" or "Start" again.
2.  **NEVER** apologize for technical issues.
3.  **ACT:** Just continue the conversation naturally based on the user's last input.

**PROTOCOL:**
1.  **THE HOOK (Start):** 
    - **ONLY** if the user explicitly says "Start" or "Hello".
    - Say: "أهلاً بك! 👋 أنا NZT، عقلك الثاني لاتخاذ القرارات الصعبة.
    سأساعدك في تحليل خياراتك باستخدام الذكاء الاصطناعي لتختار الأفضل لك 🧠✨.
    
    ببساطة.. ما هو القرار الذي يشغل بالك اليوم؟ 🤔"

2.  **THE DATA GATHERING:**
    - Ask **ONE** question at a time.
    - Be brief.
    - If user gives short answers, dig deeper playfully.

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
  if (!globalChatData[userId]) {
    globalChatData[userId] = { history: [] };
  }

  // Helper to initialize chat with specific history
  const initChat = async () => {
    return await ai.chats.create({
      model: 'gemini-2.5-flash',
      config: { systemInstruction: NZT_INSTRUCTION, temperature: 0.7 },
      history: globalChatData[userId].history 
    });
  };

  // 1. Create Session if missing
  if (!activeChatSessions.has(userId)) {
      try {
        const chat = await initChat();
        activeChatSessions.set(userId, chat);
      } catch (e) {
        console.error("Init Error", e);
        return "⚠️ حدث خطأ بسيط، حاول مرة أخرى.";
      }
  }

  let chatSession = activeChatSessions.get(userId);

  try {
    const result = await chatSession.sendMessage({ message: userMessage });
    const responseText = result.text;

    // 2. CRITICAL: SAVE TO DISK IMMEDIATELY
    // We update our local history record so it survives restarts
    globalChatData[userId].history.push({ role: 'user', parts: [{ text: userMessage }] });
    globalChatData[userId].history.push({ role: 'model', parts: [{ text: responseText }] });
    
    // Keep history manageable (last 30 turns)
    if (globalChatData[userId].history.length > 30) {
        globalChatData[userId].history = globalChatData[userId].history.slice(-30);
    }
    
    saveMemory(); // Write to file

    return responseText;

  } catch (e) { 
      console.error("Session Error:", e);
      
      // --- AUTO-RETRY LOGIC ---
      // If error occurs, the session is likely stale/dead. 
      // We DELETE it, RE-CREATE it from saved file history, and RETRY the message.
      activeChatSessions.delete(userId);
      
      try {
        console.log("♻️ Attempting Auto-Recovery for User:", userId);
        const newChat = await initChat();
        activeChatSessions.set(userId, newChat);
        
        const retryResult = await newChat.sendMessage({ message: userMessage });
        const retryText = retryResult.text;
        
        // Save success after retry
        globalChatData[userId].history.push({ role: 'user', parts: [{ text: userMessage }] });
        globalChatData[userId].history.push({ role: 'model', parts: [{ text: retryText }] });
        saveMemory();
        
        return retryText;
      } catch (retryError) {
         // Only if retry fails do we show an error.
         return "⚠️ واجهت مشكلة في الشبكة. هل يمكنك إعادة إرسال إجابتك الأخيرة؟"; 
      }
  }
}

bot.use(session());

bot.start(async (ctx) => {
  activeChatSessions.delete(ctx.from.id);
  globalChatData[ctx.from.id] = { history: [] }; // Wipe memory on explicit /start
  saveMemory();
  
  ctx.sendChatAction('typing');
  const initial = await getGeminiResponse(ctx.from.id, "SYSTEM_CMD: User clicked START. Execute 'THE HOOK' protocol step now.");
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
    if (PRIVATE_CHANNEL_ID) {
        bot.telegram.sendMessage(PRIVATE_CHANNEL_ID, `Rating: ${rating}/5`);
    }
    await ctx.editMessageText(rating === '5' ? "شكراً لك! أتمنى لك التوفيق في قرارك ✨" : "شكراً لملاحظتك، سأتحسن في المرة القادمة 🙏");
});

// Anti-Sleep
app.get('/', (req, res) => res.send('NZT Core Online.'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Running on port', PORT);
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`).on('error', () => {});
    }, 14 * 60 * 1000); // 14 mins
});

bot.launch();
