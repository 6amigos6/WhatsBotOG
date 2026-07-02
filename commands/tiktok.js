const axios = require('axios');

// Store processed message IDs to prevent duplicates (5 min TTL)
const processedMessages = new Map();

// TikTok URL patterns
const TIKTOK_URL_PATTERNS = [
  /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/i,
  /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/\d+/i,
  /https?:\/\/(?:www\.)?tiktok\.com\/t\/[\w-]+\/?/i,
  /https?:\/\/(?:vm|vt)\.tiktok\.com\/[\w-]+\/?/i,
  /https?:\/\/(?:m|mobile)\.tiktok\.com\/v\/\d+/i,
];

function isValidTikTokUrl(text) {
  return TIKTOK_URL_PATTERNS.some(pattern => pattern.test(text));
}

function extractUrl(text) {
  const isCommand = /^\.(tiktok|tt)\b/i.test(text.trim());
  let url = isCommand ? text.replace(/^\.(tiktok|tt)\s*/i, '').trim() : text.trim();
  if (!url.startsWith('http')) {
    const urlMatch = text.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) url = urlMatch[0];
  }
  return url;
}

// ====== API FUNCTIONS ======

// API 1: TikTok direct download (most reliable - no watermark)
async function fetchTikWM(url) {
  const res = await axios.get('https://tikwm.com/api', {
    params: { url, hd: '1' },
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://tikwm.com/',
      'Origin': 'https://tikwm.com'
    }
  });
  if (res.data?.code !== 0 || !res.data?.data) throw new Error(res.data?.msg || 'TikWM: invalid response');
  const d = res.data.data;
  return {
    videoUrl: d.hdplay || d.play || d.wmplay || '',
    watermarkUrl: d.wmplay || '',
    title: d.title || 'Video',
    cover: d.cover || '',
    music: d.music || '',
    author: d.author || d.unique_id || '',
    duration: d.duration || 0,
    noWatermark: !!(d.hdplay || d.play),
    images: d.images || [],
    isSlideshow: Array.isArray(d.images) && d.images.length > 0
  };
}

// API 2: TikTok downloader API
async function fetchTikDown(url) {
  const res = await axios.post('https://tikdown.org/api/ajaxSearch',
    new URLSearchParams({ q: url, lang: 'en' }),
    {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://tikdown.org',
        'Referer': 'https://tikdown.org/en/',
        'Accept': '*/*'
      }
    }
  );
  if (!res.data || res.data.status !== 'ok') throw new Error('TikDown: invalid response');
  let videoUrl = '', thumbUrl = '', title = '', author = '';
  if (res.data.data && typeof res.data.data === 'string') {
    const videoMatch = res.data.data.match(/href="([^"]+\.mp4[^"]*)"/);
    if (videoMatch) videoUrl = videoMatch[1];
    const thumbMatch = res.data.data.match(/src="([^"]+\.(jpg|jpeg|png)[^"]*)"/);
    if (thumbMatch) thumbUrl = thumbMatch[1];
    const titleMatch = res.data.data.match(/<h3[^>]*>([^<]+)<\/h3>/);
    if (titleMatch) title = titleMatch[1];
  } else if (res.data.video) {
    videoUrl = res.data.video;
    thumbUrl = res.data.thumbnail || '';
    title = res.data.title || '';
  }
  if (!videoUrl && res.data.video_url) videoUrl = res.data.video_url;
  if (!videoUrl) throw new Error('TikDown: no video URL');
  return { videoUrl, noWatermark: true, title, author };
}

// API 3: SaveFrom TikTok
async function fetchSaveFrom(url) {
  const res = await axios.post('https://worker.savetube.me/tiktok/', { url }, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  if (res.data?.video?.url) {
    return {
      videoUrl: res.data.video.url,
      noWatermark: !res.data.video.watermark,
      title: res.data.title || '',
      author: res.data.author || ''
    };
  }
  throw new Error('SaveFrom: no video URL');
}

// API 4: Snaptik
async function fetchSnapTik(url) {
  const res = await axios.post('https://snaptik.app/action.php',
    new URLSearchParams({ url, lang: 'en' }),
    {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://snaptik.app',
        'Referer': 'https://snaptik.app/en'
      }
    }
  );
  if (res.data?.video?.url) return { videoUrl: res.data.video.url, noWatermark: true, title: res.data.title || '', author: res.data.author || '' };
  throw new Error('SnapTik: no video');
}

// API 5: Ssstik
async function fetchSsstik(url) {
  const res = await axios.post('https://ssstik.io/abc',
    new URLSearchParams({ url, lang: 'en' }),
    {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://ssstik.io',
        'Referer': 'https://ssstik.io/en'
      }
    }
  );
  if (res.data?.video?.url) return { videoUrl: res.data.video.url, noWatermark: true, title: res.data.title || '', author: res.data.author || '' };
  throw new Error('Ssstik: no video');
}

// API 6: Generic fallback
async function fetchGeneric(url) {
  const res = await axios.get(`https://api.agatz.xyz/api/tiktok?url=${encodeURIComponent(url)}`, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (res.data?.data?.play) return { videoUrl: res.data.data.play, noWatermark: true, title: res.data.data.title || '', author: (res.data.data.author || {}).nickname || '' };
  throw new Error('Generic: no video');
}

async function downloadVideoBuffer(url, timeout = 45000) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout });
  return Buffer.from(res.data);
}

async function tiktokCommand(sock, chatId, message) {
  try {
    // Deduplication
    if (processedMessages.has(message.key.id)) return;
    processedMessages.set(message.key.id, Date.now());
    setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000);

    const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
    if (!text) return;

    const url = extractUrl(text);
    if (!url || !isValidTikTokUrl(url)) {
      if (/^\.(tiktok|tt)\b/i.test(text.trim())) {
        return await sock.sendMessage(chatId, {
          text: '❌ Usage: .tiktok <link>\n📝 Example: .tiktok https://vm.tiktok.com/xxxxxx/'
        }, { quoted: message });
      }
      return;
    }

    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

    // Try APIs in order of reliability with parallel first attempt
    const apis = [
      { name: 'TikWM', fn: () => fetchTikWM(url) },
      { name: 'TikDown', fn: () => fetchTikDown(url) },
      { name: 'SaveFrom', fn: () => fetchSaveFrom(url) },
      { name: 'Generic', fn: () => fetchGeneric(url) },
      { name: 'SnapTik', fn: () => fetchSnapTik(url) },
      { name: 'Ssstik', fn: () => fetchSsstik(url) },
    ];

    let result = null;
    let errors = [];

    // Try first 2 APIs in parallel for speed
    const firstResults = await Promise.allSettled(
      apis.slice(0, 2).map(({ name, fn }) =>
        fn().then(r => ({ name, result: r })).catch(e => { throw new Error(`${name}: ${e.message}`); })
      )
    );

    for (const r of firstResults) {
      if (r.status === 'fulfilled' && r.value.result?.videoUrl) {
        result = r.value.result;
        console.log(`✅ TikTok: ${r.value.name} success (parallel)`);
        break;
      }
      if (r.status === 'rejected') errors.push(r.reason.message);
    }

    // If first parallel batch failed, try remaining APIs sequentially
    if (!result) {
      for (const { name, fn } of apis.slice(2)) {
        try {
          result = await fn();
          if (result.videoUrl) {
            console.log(`✅ TikTok: ${name} success`);
            break;
          }
        } catch (e) {
          errors.push(`${name}: ${e.message}`);
          console.log(`TikTok: ${name} failed - ${e.message.slice(0, 60)}`);
        }
      }
    }

    if (!result?.videoUrl) {
      console.error(`All TikTok APIs failed: ${errors.join(' | ')}`);
      return await sock.sendMessage(chatId, {
        text: '❌ Download unavailable. The video may be private or restricted.'
      }, { quoted: message });
    }

    // Build caption
    let caption = 'Downloaded By Gasham';

    // Handle slideshow
    if (result.isSlideshow && result.images?.length > 0) {
      for (let i = 0; i < Math.min(result.images.length, 10); i++) {
        try {
          await sock.sendMessage(chatId, {
            image: { url: result.images[i] },
            caption: i === 0 ? caption : ''
          }, { quoted: message });
          if (i < result.images.length - 1) await new Promise(r => setTimeout(r, 800));
        } catch (imgErr) {
          console.error(`Slide ${i + 1} failed: ${imgErr.message}`);
        }
      }
      return;
    }

    // Try buffer download first for reliability
    try {
      const buffer = await downloadVideoBuffer(result.videoUrl);
      if (buffer?.length > 0) {
        await sock.sendMessage(chatId, { video: buffer, mimetype: 'video/mp4', caption }, { quoted: message });
        return;
      }
    } catch (bufErr) {
      console.log(`TikTok buffer download failed: ${bufErr.message}`);
    }

    // Fallback: URL stream
    try {
      await sock.sendMessage(chatId, { video: { url: result.videoUrl }, mimetype: 'video/mp4', caption }, { quoted: message });
      return;
    } catch (urlErr) {
      console.log(`TikTok URL send failed: ${urlErr.message}`);
    }

    // Try watermark version as last fallback
    if (result.watermarkUrl && result.watermarkUrl !== result.videoUrl) {
      try {
        const buf2 = await downloadVideoBuffer(result.watermarkUrl);
        if (buf2?.length > 0) {
          await sock.sendMessage(chatId, { video: buf2, mimetype: 'video/mp4', caption: caption }, { quoted: message });
          return;
        }
      } catch (e) {
        console.log(`Watermark download failed: ${e.message}`);
      }
    }

    return await sock.sendMessage(chatId, {
      text: '❌ Video too large or temporarily unavailable. Try a different link.'
    }, { quoted: message });

  } catch (error) {
    console.error('❌ TikTok command error:', error.message);
    await sock.sendMessage(chatId, { text: '❌ Unexpected error. Try again later.' }, { quoted: message });
  }
}

module.exports = tiktokCommand;
