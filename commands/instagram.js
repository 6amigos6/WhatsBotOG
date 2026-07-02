const axios = require('axios');
const { igdl } = require('ruhend-scraper');
const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { tmpdir } = require('os');
const Crypto = require('crypto');

const processedMessages = new Map();
const CAPTION = 'Downloaded By Gasham';

const IG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Referer': 'https://www.instagram.com/',
  'Accept': '*/*',
};

// ===== API METHODS =====

async function fetchRuhend(url) {
  const d = await igdl(url);
  if (d?.data?.length) {
    const items = d.data.filter(item => {
      if (item.type === 1 || item.type === '1') return true;
      if (item.type === 'video' || item.type === 'Video') return true;
      const u = (item.url || '').toLowerCase();
      if (/\.(mp4|mov|webm)$/i.test(u)) return true;
      return false;
    });
    if (items.length) return items;
  }
  throw new Error('no video');
}

async function fetchInstaDownloader(url) {
  const res = await axios.get('https://api.instasave.io/v1/media', {
    params: { url },
    headers: { 'User-Agent': IG_HEADERS['User-Agent'], 'Accept': 'application/json' },
    timeout: 20000
  });
  const items = (res.data?.items || []).filter(item => {
    if (item.type === 'video') return true;
    if (/\.(mp4|mov|webm)$/i.test(item.url || '')) return true;
    return false;
  });
  if (items.length) return items;
  throw new Error('no video');
}

async function fetchInstaSave(url) {
  const res = await axios.get('https://instasave.io/wp-json/instasave/v1/get-data', {
    params: { url },
    headers: { 'User-Agent': IG_HEADERS['User-Agent'], 'Referer': 'https://instasave.io/' },
    timeout: 20000
  });
  const items = (res.data?.medias || []).filter(m => m.type === 'video');
  if (items.length) return items;
  throw new Error('no video');
}

// ===== VIDEO DOWNLOAD & CONVERSION =====

async function downloadBuffer(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: IG_HEADERS,
    maxRedirects: 5,
  });
  if (!res.data || res.data.length < 100) throw new Error('empty response');
  return Buffer.from(res.data);
}

function convertToCompatible(inputPath, outputPath, timeout = 60000) {
  // Strategy 1: Fast copy + faststart (<1 second, for already H.264 videos)
  const r1 = spawnSync('ffmpeg', [
    '-y', '-err_detect', 'ignore_err',
    '-i', inputPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-fflags', '+genpts',
    outputPath
  ], { timeout: 15000 });
  if (r1.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) return true;

  // Strategy 2: Full H.264 + AAC re-encode
  try { fs.unlinkSync(outputPath); } catch {}
  const r2 = spawnSync('ffmpeg', [
    '-y', '-err_detect', 'ignore_err',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '23',
    '-fflags', '+genpts',
    outputPath
  ], { timeout });
  return r2.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000;
}

async function downloadAndPrepare(url) {
  const tmpIn = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.mp4');
  const tmpOut = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.mp4');

  try {
    // Download buffer
    const buf = await downloadBuffer(url);

    // Try sending as-is first (fast path)
    try {
      return { buffer: buf, needsConversion: false };
    } catch {}

    // If direct send fails, convert
    fs.writeFileSync(tmpIn, buf);
    if (convertToCompatible(tmpIn, tmpOut)) {
      return { buffer: fs.readFileSync(tmpOut), needsConversion: true };
    }
    return { buffer: buf, needsConversion: false };
  } catch (e) {
    // Stream download + convert as fallback
    try {
      fs.writeFileSync(tmpIn, '');
      const res = await axios({ url, responseType: 'stream', timeout: 60000, headers: IG_HEADERS, maxRedirects: 5 });
      const writer = fs.createWriteStream(tmpIn);
      res.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      if (convertToCompatible(tmpIn, tmpOut)) {
        return { buffer: fs.readFileSync(tmpOut), needsConversion: true };
      }
    } catch {}
    throw e;
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

// ===== URL EXTRACTION =====

const IG_URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[a-zA-Z0-9_\-]+/i,
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/stories\/[a-zA-Z0-9_.\-]+\/[0-9]+/i,
  /(?:https?:\/\/)?(?:www\.)?instagr\.am\/(?:p|reel|tv)\/[a-zA-Z0-9_\-]+/i,
];

function extractUrl(text) {
  for (const p of IG_URL_PATTERNS) {
    const m = text.match(p);
    if (m) return m[0].startsWith('http') ? m[0] : 'https://' + m[0];
  }
  return null;
}

// ===== MAIN COMMAND =====

async function instagramCommand(sock, chatId, message) {
  try {
    if (processedMessages.has(message.key.id)) return;
    processedMessages.set(message.key.id, Date.now());
    setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000);

    const text = message.message?.conversation ||
                 message.message?.extendedTextMessage?.text ||
                 message.message?.imageMessage?.caption || '';
    if (!text) return;

    const url = extractUrl(text);
    if (!url) return;

    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

    // Try APIs for video URLs
    let videoUrl = null;
    const apis = [
      { name: 'ruhend', fn: () => fetchRuhend(url) },
      { name: 'InstaDownloader', fn: () => fetchInstaDownloader(url) },
      { name: 'InstaSave', fn: () => fetchInstaSave(url) },
    ];

    for (const { name, fn } of apis) {
      try {
        const items = await fn();
        if (items && items.length > 0) {
          videoUrl = items[0].url || items[0];
          console.log(`📸 IG: ${name} found video`);
          break;
        }
      } catch (e) {
        console.log(`📸 IG: ${name} fail`);
      }
    }

    if (!videoUrl) {
      return await sock.sendMessage(chatId, {
        text: '❌ Could not download this video. The post might be private or the link is invalid.'
      });
    }

    // Download and prepare video
    const result = await downloadAndPrepare(videoUrl);

    if (result && result.buffer) {
      await sock.sendMessage(chatId, {
        video: result.buffer,
        mimetype: 'video/mp4',
        caption: CAPTION
      });
    } else {
      // Last resort: send via URL
      try {
        await sock.sendMessage(chatId, {
          video: { url: videoUrl },
          mimetype: 'video/mp4',
          caption: CAPTION
        });
      } catch {
        await sock.sendMessage(chatId, {
          text: '❌ Failed to download video. Try again later.'
        });
      }
    }

  } catch (error) {
    console.error('📸 IG error:', error.message);
    try {
      await sock.sendMessage(chatId, { text: '❌ Error processing request. Try again later.' });
    } catch {}
  }
}

module.exports = instagramCommand;
