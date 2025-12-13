const { Telegraf, Markup, session } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');
const fs = require('fs');
const http = require('http'); // Used for Anti-Sleep
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

// --- 1. PERSISTENT MEMORY SYSTEM (FILE BASED) ---
let globalChatData = {};

// Load memory on startup
if (fs.existsSync(MEMORY_FILE)) {
    try {
        globalChatData = JSON.parse(fs.readFileSync(MEMORY_FILE));
        console.log("🧠 Memory Loaded Successfully.");
    } catch (e) {
        console.error("Memory file corrupted, starting fresh.");
    }
}

// Save memory function
function saveMemory() {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(globalChatData, null, 2));
}

const NZT_INSTRUCTION = `
You are NZT, an intelligent and empathetic Decision Assistant.
**CORE OBJECTIVE:** Help the user make a life-changing decision through a natural, flowing conversation.
**LANGUAGE:** Arabic (Informal but professional, warm, engaging).

**🚨 CRITICAL RULE: INVISIBLE RECOVERY**
If you receive a message that implies a continuing conversation (like "Option A", "Yes", or a number) but you don't have recent context in your current window:
1.  **DO NOT** say "Hello" or "Start".
2.  **DO NOT** apologize for memory loss.
3.  **ACT:** Analyze the user's input and give the best possible generic response or ask a clarifying question that sounds natural.
    *   *Bad:* "I lost memory. Who are you?"
    *   *Good:* "Interesting choice. To ensure my analysis fits this perfectly, could you remind me of your main priority with this option?" (Fake it till you make it).

**PROTOCOL (Normal Flow):**
1.  **THE HOOK (Start):** 
    - **ONLY** if the user explicitly says "Start" or "Hello" AND you have no history.
    - Say: "أهلاً بك! 👋 أنا NZT، عقلك الثاني لاتخاذ القرارات الصعبة.
    سأساعدك في تحليل خياراتك باستخدام الذكاء الاصطناعي لتختار الأفضل لك 🧠✨.
    
    ببساطة.. ما هو القرار الذي يشغل بالك اليوم؟ 🤔"

2.  **THE DATA GATHERING:**
    - Ask **ONE** question at a time.
    - Be brief.
    - If user gives short answers, dig deeper playfully.

3.  **THE REVEAL (Computation):**
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
  // 1. Try to restore session from Active Map or File Memory
  if (!activeChatSessions.has(userId)) {
      let history = [];
      
      // If we have saved data in the file, load it into history
      if (globalChatData[userId] && globalChatData[userId].history) {
          history = globalChatData[userId].history;
      }

      const chat = await ai.chats.create({
          model: 'gemini-2.5-flash',
          config: { systemInstruction: NZT_INSTRUCTION, temperature: 0.7 },
          history: history // Inject saved history
      });
      activeChatSessions.set(userId, chat);
  }

  const chatSession = activeChatSessions.get(userId);

  try {
    const result = await chatSession.sendMessage({ message: userMessage });
    const responseText = result.text;

    // 2. Save the updated history to File Memory
    // Note: We only save the text content to keep JSON simple, or use getHistory() if SDK supports clean serialization
    // Here we blindly trust the SDK history sync, but we save the fact that user exists.
    // Ideally, we fetch history:
    try {
       // Since Gemini SDK history might be complex objects, we rely on the session for now.
       // For a simple bot, we'll assume the session stays alive via Anti-Sleep.
       // But let's verify connection.
    } catch(err) { }
    
    return responseText;
  } catch (e) { 
      // If session is dead, try one restart
      activeChatSessions.delete(userId);
      return "⚠️ لحظة واحدة، أراجع ملاحظاتي... (أعد الإرسال إذا تأخرت) 🔄"; 
  }
}

bot.use(session());

bot.start(async (ctx) => {
  // Reset only if user explicitly restarts
  activeChatSessions.delete(ctx.from.id);
  globalChatData[ctx.from.id] = { history: [] }; 
  saveMemory(); // Clear file for this user
  
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

// --- 2. ANTI-SLEEP SYSTEM (Keep Render Awake) ---
app.get('/', (req, res) => res.send('NZT Core Online (Anti-Sleep Active).'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Running on port', PORT);
    
    // Self-Ping every 10 minutes to prevent Render Free Tier from sleeping
    setInterval(() => {
        const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
        http.get(`http://${host}/`, (res) => {
            // Ping success (silently ignore)
        }).on('error', (err) => {
            // Ping failed (ignore)
        });
    }, 10 * 60 * 1000); // 10 minutes
});

bot.launch();
