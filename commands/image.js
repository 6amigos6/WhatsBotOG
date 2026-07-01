const axios = require('axios');
const aiKeys = require('../lib/ai_keys');

async function imageCommand(sock, chatId, message) {
  try {
    const text = message.message?.conversation?.trim() || 
                 message.message?.extendedTextMessage?.text?.trim() || '';
    const prompt = text.replace(/^\.image\s+/i, '').trim();

    if (!prompt) {
      await sock.sendMessage(chatId, {
        text: '🎨 *Image Generation*\n\nUsage: `.image <your prompt>`\nExample: `.image a beautiful sunset`'
      }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatId, { react: { text: '🎨', key: message.key } });

    // Check if user has their own API key configured
    const apiKey = aiKeys.getKey('image');
    
    if (apiKey) {
      // Use user's configured API
      try {
        const response = await axios.post('https://api.openai.com/v1/images/generations', {
          prompt: prompt,
          n: 1,
          size: '1024x1024',
        }, {
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          timeout: 30000,
        });
        
        if (response.data?.data?.[0]?.url) {
          const imgResp = await axios.get(response.data.data[0].url, { responseType: 'arraybuffer', timeout: 30000 });
          await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
          await sock.sendMessage(chatId, {
            image: Buffer.from(imgResp.data),
            caption: '╭─ 🎨 *AI IMAGE*\n│\n│ 📝 ' + prompt + '\n╰────────────────'
          }, { quoted: message });
          return;
        }
      } catch (e) {
        console.log('API key image failed:', e.message);
        // Fall through to free API
      }
    }

    // Free fallback: Pollinations.ai
    const imageUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=1024&height=1024&nofeed=true';
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    
    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
    await sock.sendMessage(chatId, {
      image: Buffer.from(response.data),
      caption: '╭─ 🎨 *AI IMAGE*\n│\n│ 📝 ' + prompt + '\n╰────────────────'
    }, { quoted: message });

  } catch (error) {
    console.error('[image] error:', error.message);
    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
    try {
      await sock.sendMessage(chatId, { text: '❌ Failed to generate image. Try again.' }, { quoted: message });
    } catch {}
  }
}

module.exports = imageCommand;
