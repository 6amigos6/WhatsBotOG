const axios = require('axios');
const { igdl } = require('ruhend-scraper');
const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { tmpdir } = require('os');
const Crypto = require('crypto');

const processedMessages = new Map();
const CAPTION = 'Downloaded By Gasham';

// Instagram URL patterns
const IG_URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[a-zA-Z0-9_\-]+/i,
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/stories\/[a-zA-Z0-9_.\-]+\/[0-9]+/i,
  /(?:https?:\/\/)?(?:www\.)?instagr\.am\/(?:p|reel|tv)\/[a-zA-Z0-9_\-]+/i,
];

// Headers required for Instagram CDN access
const IG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Referer': 'https://www.instagram.com/',
  'Accept': '*/*',
  'Origin': 'https://www.instagram.com',
  'Accept-Encoding': 'gzip, deflate',
};

// ===== API FUNCTIONS =====

async function fetchRuhend(url) {
  const d = await igdl(url);
  if (d?.data?.length) return d.data;
  throw new Error('no media');
}

async function fetchInstaDownloader(url) {
  const res = await axios.get('https://api.instasave.io/v1/media', {
    params: { url },
    headers: { 'User-Agent': IG_HEADERS['User-Agent'], 'Accept': 'application/json' },
    timeout: 20000
  });
  if (res.data?.items?.length) return res.data.items.map(item => ({ url: item.url, type: item.type || 'image' }));
  throw new Error('no media');
}

async function fetchInstaSave(url) {
  const res = await axios.get('https://instasave.io/wp-json/instasave/v1/get-data', {
    params: { url },
    headers: { 'User-Agent': IG_HEADERS['User-Agent'], 'Referer': 'https://instasave.io/' },
    timeout: 20000
  });
  if (res.data?.medias?.length) return res.data.medias.map(m => ({ url: m.url, type: m.type === 'video' ? 'video' : 'image' }));
  throw new Error('no media');
}

// ===== MEDIA DOWNLOAD & CONVERSION =====

async function downloadBuffer(url) {
  const res = await axios.get(url, { 
    responseType: 'arraybuffer', 
    timeout: 60000,
    headers: IG_HEADERS,
    maxRedirects: 5,
  });
  if (!res.data || res.data.length < 100) throw new Error('Empty response');
  return Buffer.from(res.data);
}

async function streamToFile(url, filePath) {
  const res = await axios({ 
    url, 
    responseType: 'stream', 
    timeout: 60000, 
    headers: IG_HEADERS, 
    maxRedirects: 5 
  });
  const writer = fs.createWriteStream(filePath);
  res.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 100) throw new Error('Empty file');
}

function convertVideo(inputPath, outputPath, timeout = 45000) {
  // Strategy 1: Fast re-mux with copy (fixes moov atom, <1 second)
  const r1 = spawnSync('ffmpeg', [
    '-y', '-err_detect', 'ignore_err',
    '-i', inputPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-fflags', '+genpts',
    outputPath
  ], { timeout: 15000 });
  
  if (r1.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
    return true;
  }
  
  // Strategy 2: Full re-encode to H.264/AAC
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
  
  if (r2.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
    return true;
  }
  
  return false;
}

async function ensureVideoCompatible(buffer) {
  const tmpIn = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.mp4');
  const tmpOut = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.mp4');
  
  try {
    fs.writeFileSync(tmpIn, buffer);
    if (convertVideo(tmpIn, tmpOut)) {
      return fs.readFileSync(tmpOut);
    }
    return buffer;
  } catch (e) {
    console.error('[IG] Convert error:', e.message);
    return buffer;
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

async function downloadAndConvert(url) {
  const tmpIn = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.mp4');
  const tmpOut = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.mp4');
  
  try {
    await streamToFile(url, tmpIn);
    if (convertVideo(tmpIn, tmpOut, 60000)) {
      return fs.readFileSync(tmpOut);
    }
    return null;
  } catch (e) {
    console.error('[IG] Download+convert error:', e.message);
    return null;
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

function detectMediaType(item, url) {
  // 1. Check item.type field (most reliable when present)
  if (item.type === 1 || item.type === '1' || item.type === 'video' || item.type === 'Video') return 'video';
  if (item.type === 2 || item.type === '2' || item.type === 'image' || item.type === 'Image') return 'image';
  
  // 2. Check URL extension
  const urlLower = (item.url || '').toLowerCase();
  if (/.(mp4|mov|webm|avi)$/i.test(urlLower)) return 'video';
  if (/.(jpg|jpeg|png|webp|gif)$/i.test(urlLower)) return 'image';
  
  // 3. Check for Instagram video CDN paths (most Instagram video URLs have /v/ in path)
  if (/\/v[\/\d]/.test(item.url)) return 'video';
  if (/\/vp\//.test(item.url)) return 'video';
  
  // 4. Check parent URL pattern
  if (/\/reel\//i.test(url)) return 'video';
  if (/\/tv\//i.test(url)) return 'video';
  
  // 5. Check if URL has video-related query params
  if (/video|_v_|mp4/i.test(item.url)) return 'video';
  
  // 6. For stories
  if (/\/stories\//i.test(url)) return 'video';
  
  // 7. Default: check file size or content-type via URL patterns
  // If the URL looks like an image CDN (has /n/ or /p/ path), assume image
  if (/\/[iopn]\//.test(item.url)) return 'image';
  
  // 8. Final heuristic: if URL starts with CDN and has no clear indicators, 
  // try a HEAD request to check content-type
  return null; // uncertain - caller should handle this
}
function extractUrl(text) {
  for (const pattern of IG_URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0].startsWith('http') ? match[0] : 'https://' + match[0];
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

    // Try APIs in order of reliability
    let mediaItems = null;
    const apis = [
      { name: 'ruhend-scraper', fn: () => fetchRuhend(url) },
      { name: 'InstaDownloader', fn: () => fetchInstaDownloader(url) },
      { name: 'InstaSave', fn: () => fetchInstaSave(url) },
    ];

    for (const { name, fn } of apis) {
      try {
        const result = await fn();
        if (result && result.length > 0) {
          mediaItems = result;
          console.log(`📸 IG: ${name} OK`);
          break;
        }
      } catch (e) {
        console.log(`📸 IG: ${name} fail - ${e.message.slice(0, 60)}`);
      }
    }

    if (!mediaItems || mediaItems.length === 0) {
      return await sock.sendMessage(chatId, {
        text: '❌ Could not download this content. The post might be private or the link is invalid.'
      });
    }

    // Deduplicate and limit
    const seen = new Set();
    const items = [];
    for (const m of mediaItems) {
      if (!m.url || seen.has(m.url)) continue;
      seen.add(m.url);
      items.push(m);
      if (items.length >= 10) break;
    }

    let sentCount = 0;

    for (let i = 0; i < items.length; i++) {
      try {
        const item = items[i];
        let isVideo = detectMediaType(item, url);
        // If uncertain, try HEAD request to check content-type
        if (isVideo === null) {
          try {
            const headRes = await axios.head(item.url, { 
              timeout: 5000, 
              headers: { ...IG_HEADERS, 'Range': 'bytes=0-0' } 
            });
            const ct = (headRes.headers['content-type'] || '').toLowerCase();
            isVideo = ct.startsWith('video/');
          } catch {
            // If HEAD fails, assume video if URL contains reel
            isVideo = /\/reel\//i.test(url);
          }
        }

        if (isVideo) {
          // Path A: Download buffer + convert (most reliable)
          let sent = false;
          try {
            const buf = await downloadBuffer(item.url);
            const compatBuf = await ensureVideoCompatible(buf);
            await sock.sendMessage(chatId, {
              video: compatBuf,
              mimetype: 'video/mp4',
              caption: CAPTION
            });
            sent = true;
          } catch (e1) {
            console.log(`📸 IG buffer fail: ${e1.message.slice(0, 50)}`);
          }

          // Path B: Stream download + convert
          if (!sent) {
            try {
              const convBuf = await downloadAndConvert(item.url);
              if (convBuf) {
                await sock.sendMessage(chatId, {
                  video: convBuf,
                  mimetype: 'video/mp4',
                  caption: CAPTION
                });
                sent = true;
              }
            } catch (e2) {
              console.log(`📸 IG stream fail: ${e2.message.slice(0, 50)}`);
            }
          }

          // Path C: URL send (last resort)
          if (!sent) {
            try {
              await sock.sendMessage(chatId, {
                video: { url: item.url },
                mimetype: 'video/mp4',
                caption: CAPTION
              });
              sent = true;
            } catch (e3) {
              console.log(`📸 IG URL fail: ${e3.message.slice(0, 50)}`);
            }
          }

          if (sent) sentCount++;
        } else {
          // Image: try buffer first
          let sent = false;
          try {
            const buf = await downloadBuffer(item.url);
            await sock.sendMessage(chatId, { image: buf, caption: CAPTION });
            sent = true;
          } catch {
            try {
              await sock.sendMessage(chatId, { image: { url: item.url }, caption: CAPTION });
              sent = true;
            } catch {}
          }
          if (sent) sentCount++;
        }

        if (i < items.length - 1) await new Promise(r => setTimeout(r, 1000));
      } catch (mediaError) {
        console.error(`📸 IG item ${i + 1} error:`, mediaError.message);
      }
    }

    if (sentCount === 0) {
      await sock.sendMessage(chatId, {
        text: '❌ Failed to download media. Try again later.'
      });
    }

  } catch (error) {
    console.error('📸 IG error:', error.message);
    try {
      await sock.sendMessage(chatId, { text: '❌ Error processing request. Try again later.' });
    } catch {}
  }
}

module.exports = instagramCommand;
