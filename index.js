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

console.log(`✅ Loaded ${API_KEYS.length} Gemini API Keys.`);

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// --- 1. ADVANCED PERSISTENT MEMORY ---
let globalChatData = {};

// Load memory safely
if (fs.existsSync(MEMORY_FILE)) {
    try {
        globalChatData = JSON.parse(fs.readFileSync(MEMORY_FILE));
    } catch (e) {
        console.error("Failed to load memory file, starting fresh.");
        globalChatData = {};
    }
}

// Debounced Save to prevent file corruption
let saveTimeout;
function saveMemory() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        try {
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(globalChatData, null, 2));
        } catch (e) { console.error("Save failed", e); }
    }, 1000); // Save 1 second after last change
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
**RELATIONSHIP:** You are a long-term partner. You remember past dilemmas.
**LANGUAGE:** Arabic (Informal but professional, warm, engaging).

**FORMATTING RULES:**
- Use single asterisks for *bold*. No markdown errors.

**THEORIES:**
${THEORIES_LIST}

**PROTOCOL:**
1.  **Start:** Ask about the decision if new, or follow up if returning.
2.  **Gather:** Ask ONE question at a time.
3.  **Analyze:** Use theories. Format output with:
    *🎯 الحكم النهائي*
    *📈 نسبة النجاح*
    *🧠 زوايا التحليل* (Pick top 3 theories)
4.  **Follow Up:** If the user returns later, ALWAYS ask: "How did your decision regarding [Topic] go? Did the theory help?"
`;

// --- UTILITIES ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function safeReply(ctx, text) {
    try {
        const formatted = text.replace(/\*\*/g, '*');
        await ctx.reply(formatted, { parse_mode: 'Markdown' });
    } catch (error) {
        console.warn("⚠️ Markdown failed. Falling back to plain text.");
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
  
  // Initialize User Memory Structure
  if (!globalChatData[userId]) {
      globalChatData[userId] = { 
          history: [], 
          lastSeen: now,
          userName: "User"
      };
  }
  
  const userData = globalChatData[userId];
  
  // --- SMART MEMORY CHECK ---
  // Check if user has been away for more than 24 hours
  const hoursSinceLastSeen = (now - (userData.lastSeen || now)) / (1000 * 60 * 60);
  let finalPrompt = userMessage;
  
  // If returning after a day (and has history), inject a system note to the model
  if (hoursSinceLastSeen > 24 && userData.history.length > 2) {
      console.log(`User ${userId} returned after ${hoursSinceLastSeen.toFixed(1)} hours. Injecting follow-up prompt.`);
      finalPrompt = `[SYSTEM NOTE: The user has returned after ${Math.floor(hoursSinceLastSeen)} hours since the last conversation. 
      Briefly welcome them back warmly and ask for an update on the results of their previous decision/dilemma. 
      Then answer their new message: "${userMessage}"]`;
  }

  userData.lastSeen = now; // Update timestamp

  const updateHistory = (uId, uMsg, mMsg) => {
      const safeText = mMsg || "...";
      // Don't save the [SYSTEM NOTE] part to history, only the user's actual text
      globalChatData[uId].history.push({ role: 'user', parts: [{ text: uMsg }] });
      globalChatData[uId].history.push({ role: 'model', parts: [{ text: safeText }] });
      
      // Increased history limit for better long-term context
      if (globalChatData[uId].history.length > 40) {
          globalChatData[uId].history = globalChatData[uId].history.slice(-40);
      }
      saveMemory();
  };

  const executeWithRetry = async (history, message, attempt = 0) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS_AVAILABLE");
      if (attempt >= API_KEYS.length * 3) throw new Error("ALL_KEYS_EXHAUSTED");
      if (attempt > 0 && attempt % API_KEYS.length === 0) await sleep(5000);

      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);

      try {
          const chat = await ai.chats.create({
              model: 'gemini-2.5-flash',
              config: { systemInstruction: NZT_INSTRUCTION },
              history: history || []
          });

          // Send the manipulated prompt (with system note if applicable)
          const result = await chat.sendMessage({ message: message });
          return result.text;

      } catch (error) {
          const isInvalid = error.status === 400 || (error.message && (error.message.includes('API_KEY_INVALID') || error.message.includes('expired')));
          if (isInvalid) {
              API_KEYS.splice(currentKeyIndex, 1);
              if (API_KEYS.length === 0) throw new Error("NO_KEYS_AVAILABLE");
              currentKeyIndex = currentKeyIndex % API_KEYS.length;
              return executeWithRetry(history, message, attempt);
          }
          if (error.status === 429 || (error.message && error.message.includes('429'))) {
              getNextKey();
              await sleep(1000);
              return executeWithRetry(history, message, attempt + 1);
          }
          throw error;
      }
  };

  // Fallback for context loss
  const executeStatelessWithRetry = async (prompt, attempt = 0) => {
      if (API_KEYS.length === 0) throw new Error("NO_KEYS");
      const activeKey = API_KEYS[currentKeyIndex];
      const ai = createAIClient(activeKey);
      try {
          const result = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              config: { systemInstruction: NZT_INSTRUCTION },
              contents: prompt
          });
          return result.text;
      } catch(e) { 
          getNextKey();
          if(attempt < 3) return executeStatelessWithRetry(prompt, attempt+1);
          throw e;
      }
  };

  try {
    const responseText = await executeWithRetry(userData.history, finalPrompt);
    // Important: We pass 'userMessage' (original) to history, not 'finalPrompt' (injected)
    updateHistory(userId, userMessage, responseText);
    return responseText;

  } catch (error) {
      console.error("Exec failed", error.message);
      try {
        const prompt = `User: "${userMessage}". (Context unavailable). Reply helpfully.`;
        const responseText = await executeStatelessWithRetry(prompt);
        updateHistory(userId, userMessage, responseText);
        return responseText;
      } catch (e) {
         return "نواجه مشكلة تقنية بسيطة.. هل يمكنك المحاولة مجدداً؟";
      }
  }
}

bot.use(session());

bot.start(async (ctx) => {
  // Only clear history if requested explicitly via a command, 
  // but for /start we might want to keep it OR reset. 
  // For "Long term memory", usually we DON'T reset on /start unless user asks to reset.
  // But to be safe for a decision bot, let's reset to start a NEW decision, 
  // BUT we could archive the old one (omitted for simplicity).
  // Current behavior: Reset for a fresh start.
  
  if (globalChatData[ctx.from.id]) {
      // Archive or just clear
      globalChatData[ctx.from.id].history = [];
      globalChatData[ctx.from.id].lastSeen = Date.now();
  } else {
      globalChatData[ctx.from.id] = { history: [], lastSeen: Date.now() };
  }
  saveMemory();
  
  ctx.sendChatAction('typing');
  const initial = await getGeminiResponse(ctx.from.id, "مرحبا، أريد البدء في اتخاذ قرار جديد.");
  await safeReply(ctx, initial);
});

bot.on('text', async (ctx) => {
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await safeReply(ctx, response);

  if (response.includes("نسبة النجاح") || response.includes("الحكم النهائي")) {
    setTimeout(() => {
        ctx.reply("📉 **تقييم التجربة:**", 
            Markup.inlineKeyboard([
                [Markup.button.callback('1', 'rate_1'), Markup.button.callback('5', 'rate_5')]
            ])
        );
    }, 4000);
  }
});

bot.action(/rate_(\d)/, async (ctx) => {
    const rating = ctx.match[1];
    await ctx.editMessageText("شكراً لتقييمك! تم حفظه في السجل لتحسين دقة القرارات القادمة.");
    if (PRIVATE_CHANNEL_ID) {
        bot.telegram.sendMessage(PRIVATE_CHANNEL_ID, `⭐ Rating: ${rating}/5 - User: @${ctx.from.username}`).catch(()=>{});
    }
});

app.get('/', (req, res) => res.send(`NZT Memory Core v5.0 (Active)`));
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
