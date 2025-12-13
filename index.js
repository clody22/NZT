const { Telegraf, Markup, session } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_KEY = process.env.API_KEY;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;

if (!BOT_TOKEN || !API_KEY) {
  console.error("Missing Environment Variables");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: API_KEY });
const app = express();

const NZT_INSTRUCTION = `
You are NZT, an advanced Decision Intelligence System.
**CORE DIRECTIVE:** You are the Lead Consultant.
**PROTOCOL:**
1. INITIATION: "I am NZT. I use 20 scientific theories..."
2. INTERROGATION: Ask sharp questions.
3. COMPUTATION: Output "COMPOSITE SUCCESS PROBABILITY: XX%"
`;

const chatHistories = new Map(); 

async function getGeminiResponse(userId, userMessage) {
  if (!chatHistories.has(userId)) {
      const chat = await ai.chats.create({
          model: 'gemini-2.5-flash',
          config: { systemInstruction: NZT_INSTRUCTION, temperature: 0.7 }
      });
      chatHistories.set(userId, chat);
  }
  const chatSession = chatHistories.get(userId);
  try {
    const result = await chatSession.sendMessage({ message: userMessage });
    return result.text;
  } catch (e) { return "Connection Error"; }
}

bot.use(session());

bot.start(async (ctx) => {
  chatHistories.delete(ctx.from.id);
  ctx.sendChatAction('typing');
  const initial = await getGeminiResponse(ctx.from.id, "SYSTEM OVERRIDE: Intro yourself as NZT. Ask first question.");
  ctx.reply(initial, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await ctx.reply(response, { parse_mode: 'Markdown' });

  if (response.includes("COMPOSITE SUCCESS PROBABILITY") || response.includes("THE VERDICT")) {
    setTimeout(() => {
        ctx.reply("📉 **Algorithm Calibration**", 
            Markup.inlineKeyboard([
                [Markup.button.callback('1', 'rate_1'), Markup.button.callback('5', 'rate_5')]
            ])
        );
    }, 2000);
  }
});

bot.action(/rate_(\d)/, async (ctx) => {
    const rating = ctx.match[1];
    if (PRIVATE_CHANNEL_ID) {
        bot.telegram.sendMessage(PRIVATE_CHANNEL_ID, `Rating: ${rating}/5`);
    }
    await ctx.editMessageText("✅ Data Saved.");
});

app.get('/', (req, res) => res.send('NZT Core Online.'));
app.listen(process.env.PORT || 3000, () => console.log('Running'));
bot.launch();
