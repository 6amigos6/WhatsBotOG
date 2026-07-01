const axios = require('axios');

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

    // Send processing reaction
    await sock.sendMessage(chatId, { react: { text: '🎨', key: message.key } });

    // Generate image using Pollinations.ai (free, returns image directly)
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nofeed=true`;

    // Download the image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const imageBuffer = Buffer.from(response.data);

    // Remove reaction
    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    // Send the generated image
    await sock.sendMessage(chatId, {
      image: imageBuffer,
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
