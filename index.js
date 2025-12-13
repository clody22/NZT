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
You are NZT, an intelligent and empathetic Decision Assistant.
**CORE OBJECTIVE:** Help the user make a life-changing decision through a natural, flowing conversation.
**LANGUAGE:** Arabic (Informal but professional, warm, engaging).

**BEHAVIOR GUIDELINES:**
1.  **NO LECTURING:** Never list the 20 theories in the beginning. Keep the science hidden behind the curtain until the final result.
2.  **ONE QUESTION AT A TIME:** This is a chat, not an interrogation. Ask one specific question, wait for the answer, then ask the next.
3.  **USE EMOJIS:** Use emojis (✨, 🤔, 💡, 💰, 🚀) to make the conversation friendly and visual.
4.  **ADAPTIVE FLOW:**
    - If the user is emotional -> Show empathy first, then ask for facts.
    - If the user is vague -> Ask for specifics playfully ("يعني كم المبلغ بالضبط؟ 😉").

**PROTOCOL:**
1.  **THE HOOK (Start):** 
    - Say: "أهلاً بك! 👋 أنا NZT، عقلك الثاني لاتخاذ القرارات الصعبة.
    سأساعدك في تحليل خياراتك باستخدام الذكاء الاصطناعي لتختار الأفضل لك 🧠✨.
    
    ببساطة.. ما هو القرار الذي يشغل بالك اليوم؟ 🤔"
    - (Do not say anything else. Wait for the user).

2.  **THE DATA GATHERING:**
    - Step 1: Understand the Options. ("ما هي الخيارات المتاحة أمامك حالياً؟")
    - Step 2: Understand the Goal. ("ما هو هدفك الرئيسي من هذا القرار؟ راحة البال أم الربح؟ 🎯")
    - Step 3: Understand the Risks/Fears.
    - Keep asking briefly until you have a full picture.

3.  **THE REVEAL (Computation):**
    - ONLY when you have all info, say: "جاري تحليل البيانات باستخدام 20 نظرية علمية... 🔄"
    - Then output the **FINAL REPORT** in this format:

    **🎯 الحكم النهائي**
    [نصيحة مباشرة وواضحة جداً لما يجب فعله]

    **📈 نسبة النجاح المتوقعة**
    **[XX]%** 

    **🧠 لماذا هذا الخيار؟ (تحليل النظريات)**
    *   **من منظور نظرية الألعاب 🎲:** [شرح مبسط]
    *   **من منظور المخاطر 🛡️:** [شرح مبسط]
    *   **من منظور المستقبل 🔭:** [شرح مبسط]

    *ثم اطلب منهم التقييم.*
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
  } catch (e) { return "حدث خطأ بسيط في الاتصال.. هل يمكننا المحاولة مرة أخرى؟ 🔄"; }
}

bot.use(session());

bot.start(async (ctx) => {
  chatHistories.delete(ctx.from.id);
  ctx.sendChatAction('typing');
  // Trigger the AI to start with the specific HOOK defined in instructions
  const initial = await getGeminiResponse(ctx.from.id, "SYSTEM: Start the conversation now using the 'THE HOOK' protocol defined in your instructions. Be warm and short.");
  ctx.reply(initial, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
  const response = await getGeminiResponse(ctx.from.id, ctx.message.text);
  await ctx.reply(response, { parse_mode: 'Markdown' });

  if (response.includes("نسبة النجاح المتوقعة") || response.includes("الحكم النهائي")) {
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

app.get('/', (req, res) => res.send('NZT Core Online.'));
app.listen(process.env.PORT || 3000, () => console.log('Running'));
bot.launch();
