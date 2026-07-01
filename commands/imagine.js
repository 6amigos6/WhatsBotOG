const axios = require('axios');
const ai = require('../lib/ai_keys');

async function imagineCommand(sock, chatId, message) {
  try {
    const text = message.message?.conversation?.trim() || 
                 message.message?.extendedTextMessage?.text?.trim() || '';
    const prompt = text.replace(/^\.imagine\s+/i, '').trim();

    if (!prompt) {
      await sock.sendMessage(chatId, {
        text: '🎨 *Image Generation*\n\nUsage: `.imagine <your prompt>`\nExample: `.imagine a beautiful sunset over mountains`'
      }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatId, { react: { text: '🎨', key: message.key } });

    // Try user's own API key first
    const userKey = ai.getKey('imagine');
    if (userKey) {
      try {
        const response = await axios.post('https://api.openai.com/v1/images/generations', {
          prompt: prompt,
          n: 1,
          size: '1024x1024',
        }, {
          headers: { 'Authorization': 'Bearer ' + userKey, 'Content-Type': 'application/json' },
          timeout: 30000,
        });
        
        if (response.data?.data?.[0]?.url) {
          const imgResp = await axios.get(response.data.data[0].url, { responseType: 'arraybuffer', timeout: 30000 });
          await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
          await sock.sendMessage(chatId, {
            image: Buffer.from(imgResp.data),
            caption: `╭─ 🎨 *AI GENERATED*\n│\n│ 📝 ${prompt}\n╰────────────────`
          }, { quoted: message });
          return;
        }
      } catch (e) {
        const status = e.response?.status;
        const errMsg = e.response?.data?.error?.message || e.message;
        if (status === 401) {
          await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
          await sock.sendMessage(chatId, {
            text: "❌ *Invalid API Key*\n\nThe Imagine API key is invalid. Update it in AI Management."
          }, { quoted: message });
          return;
        }
        if (status === 429) {
          await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
          await sock.sendMessage(chatId, {
            text: "❌ *Rate Limit*\n\nAPI key rate limit exceeded. Try again later."
          }, { quoted: message });
          return;
        }
        console.log('Imagine API key failed:', errMsg);
        // Fall through to free API
      }
    }

    // Free fallback: Pollinations.ai
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nofeed=true`;
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    
    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
    await sock.sendMessage(chatId, {
      image: Buffer.from(response.data),
      caption: `╭─ 🎨 *AI GENERATED*\n│\n│ 📝 ${prompt}\n╰────────────────`
    }, { quoted: message });

  } catch (error) {
    console.error('[imagine] error:', error.message);
    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
    try {
      await sock.sendMessage(chatId, {
        text: '❌ Failed to generate image. Try again with a different prompt.'
      }, { quoted: message });
    } catch {}
  }
}

module.exports = imagineCommand;
