const axios = require('axios');
const { igdl } = require("ruhend-scraper");

// Store processed message IDs to prevent duplicates
const processedMessages = new Map();

// Fallback API functions
async function fetchRapidAPI(url) {
  const res = await axios.post('https://instagram-downloader-download-instagram-videos-stories.p.rapidapi.com/index', 
    new URLSearchParams({ url }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'X-RapidAPI-Key': 'e2b3e27dc3msh3f7d8e9c1a4b5c6d7e8f9a0b1c',
        'X-RapidAPI-Host': 'instagram-downloader-download-instagram-videos-stories.p.rapidapi.com'
      },
      timeout: 15000
    }
  );
  if (res.data?.media) return res.data.media;
  throw new Error('RapidAPI: no media');
}

async function fetchInstaSave(url) {
  const res = await axios.get('https://instasave.io/wp-json/instasave/v1/get-data', {
    params: { url },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://instasave.io/'
    },
    timeout: 20000
  });
  if (res.data?.medias?.length) return res.data.medias.map(m => ({ url: m.url, type: m.type === 'video' ? 'video' : 'image' }));
  throw new Error('InstaSave: no media');
}

async function fetchInstaDownloader(url) {
  const res = await axios.get('https://api.instasave.io/v1/media', {
    params: { url },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    },
    timeout: 20000
  });
  if (res.data?.items?.length) return res.data.items.map(item => ({ url: item.url, type: item.type || 'image' }));
  throw new Error('InstaDownloader: no media');
}

async function downloadBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(res.data);
}

async function instagramCommand(sock, chatId, message) {
  try {
    if (processedMessages.has(message.key.id)) return;
    processedMessages.set(message.key.id, Date.now());
    setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000);

    const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
    if (!text) return await sock.sendMessage(chatId, { text: 'Please provide an Instagram link.' });

    const instagramUrl = text.match(/(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:p|reel|tv|stories)\/[a-zA-Z0-9_\-]+/i) ||
                          text.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-]+/i);
    if (!instagramUrl) return await sock.sendMessage(chatId, { text: 'Invalid Instagram link. Provide a valid post, reel, or video link.' });

    const url = instagramUrl[0].startsWith('http') ? instagramUrl[0] : 'https://' + instagramUrl[0];

    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

    // Try multiple APIs
    let mediaItems = null;
    const apis = [
      { name: 'ruhend-scraper', fn: async () => { const d = await igdl(url); return d?.data || null; } },
      { name: 'InstaDownloader', fn: () => fetchInstaDownloader(url) },
      { name: 'InstaSave', fn: () => fetchInstaSave(url) },
    ];

    for (const { name, fn } of apis) {
      try {
        const result = await fn();
        if (result && result.length > 0) {
          mediaItems = result;
          console.log(`✅ Instagram: ${name} success for ${url.slice(0, 60)}`);
          break;
        }
      } catch (e) {
        console.log(`Instagram: ${name} failed - ${e.message.slice(0, 60)}`);
      }
    }

    if (!mediaItems || mediaItems.length === 0) {
      return await sock.sendMessage(chatId, {
        text: '❌ Could not download this Instagram content. The post might be private or the link is invalid.'
      });
    }

    // Deduplicate and limit
    const seen = new Set();
    const uniqueItems = mediaItems.filter(m => {
      if (!m.url || seen.has(m.url)) return false;
      seen.add(m.url);
      return true;
    }).slice(0, 20);

    for (let i = 0; i < uniqueItems.length; i++) {
      try {
        const item = uniqueItems[i];
        const isVideo = item.type === 'video' || /\.(mp4|mov|webm)$/i.test(item.url) || url.includes('/reel/') || url.includes('/tv/');

        if (isVideo) {
          // Try to download buffer first for reliability
          try {
            const buf = await downloadBuffer(item.url);
            await sock.sendMessage(chatId, {
              video: buf,
              mimetype: 'video/mp4',
              caption: '𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗥𝗨𝗝𝗢𝗩'
            }, { quoted: message });
          } catch {
            await sock.sendMessage(chatId, {
              video: { url: item.url },
              mimetype: 'video/mp4',
              caption: '𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗥𝗨𝗝𝗢𝗩'
            }, { quoted: message });
          }
        } else {
          await sock.sendMessage(chatId, {
            image: { url: item.url },
            caption: '𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗥𝗨𝗝𝗢𝗩'
          }, { quoted: message });
        }

        if (i < uniqueItems.length - 1) await new Promise(r => setTimeout(r, 1000));
      } catch (mediaError) {
        console.error(`Instagram media ${i + 1} error:`, mediaError.message);
      }
    }

  } catch (error) {
    console.error('Instagram command error:', error.message);
    await sock.sendMessage(chatId, { text: '❌ Error processing Instagram request. Try again later.' });
  }
}

module.exports = instagramCommand;
