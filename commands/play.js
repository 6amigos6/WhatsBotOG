const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const { toAudio } = require('../lib/converter');
const { ytmp3 } = require('ruhend-scraper');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEMP_DIR = path.join(__dirname, '../temp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Clean temp files older than 10 minutes
setInterval(() => {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    for (const f of files) {
      try {
        const fp = path.join(TEMP_DIR, f);
        if (now - fs.statSync(fp).mtimeMs > 600000) fs.unlinkSync(fp);
      } catch {}
    }
  } catch {}
}, 300000);

// Download audio buffer from a URL with proper browser-like headers
async function downloadFromUrl(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.youtube.com/',
      'Origin': 'https://www.youtube.com',
      'Accept': '*/*',
    },
    maxRedirects: 5,
  });
  return Buffer.from(res.data);
}

async function playCommand(sock, chatId, message) {
  try {
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const searchQuery = text.replace(/^\.play\s+/i, '').trim();

    if (!searchQuery) {
      return await sock.sendMessage(chatId, {
        text: '🎵 *Play Music*\n\nUsage: `.play <song name>`\nExample: `.play mahir ay brat`'
      }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔎', key: message.key } });

    // Search YouTube
    const search = await yts(searchQuery);
    const videos = search.videos;
    if (!videos || videos.length === 0) {
      return await sock.sendMessage(chatId, { text: '❌ No results found for: ' + searchQuery }, { quoted: message });
    }

    const video = videos[0];
    const urlYt = video.url;
    const title = video.title || 'Unknown';
    const author = video.author?.name || 'Unknown';
    const duration = video.timestamp || '00:00';

    await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });

    // Send thumbnail with song info
    try {
      await sock.sendMessage(chatId, {
        image: { url: video.thumbnail },
        caption: `╭─ 🎵 *SONG FOUND*\n│\n│ 📌 *${title}*\n│ 👤 ${author}\n│ ⏱ ${duration}\n╰────────────────`
      }, { quoted: message });
    } catch (thumbErr) {
      console.log('Thumbnail failed:', thumbErr.message);
    }

    // Download audio with multi-source fallback
    let audioBuffer = null;
    let audioUrl = null;

    // Source 1: @distube/ytdl-core (maintained fork)
    if (!audioBuffer && !audioUrl) {
      try {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        const stream = ytdl(urlYt, {
          filter: 'audioonly',
          quality: 'highestaudio',
          requestOptions: {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9',
            }
          }
        });
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const rawBuffer = Buffer.concat(chunks);
        if (rawBuffer.length > 0) {
          audioBuffer = await toAudio(rawBuffer, 'mp4');
          console.log('✅ @distube/ytdl-core success');
        }
      } catch (e) { console.log('@distube/ytdl-core failed:', e.message.slice(0, 60)); }
    }

    // Source 2: ruhend-scraper ytmp3
    if (!audioBuffer && !audioUrl) {
      try {
        const result = await ytmp3(urlYt);
        if (result?.audio) {
          try {
            audioBuffer = await downloadFromUrl(result.audio);
            console.log('✅ ruhend-scraper ytmp3 success');
          } catch (e) {
            // Try audio_2 if available
            if (result.audio_2) {
              try {
                audioBuffer = await downloadFromUrl(result.audio_2);
                console.log('✅ ruhend-scraper audio_2 success');
              } catch (e2) {
                // Try mp3 field if available
                if (result.mp3) {
                  audioBuffer = await downloadFromUrl(result.mp3);
                  console.log('✅ ruhend-scraper mp3 success');
                }
              }
            }
          }
        }
        if (!audioBuffer && result?.download) audioUrl = result.download;
      } catch (e) { console.log('ruhend-scraper failed:', e.message.slice(0, 60)); }
    }

    // Source 3: ruhend-scraper ytmp4 (audio fallback)
    if (!audioBuffer && !audioUrl) {
      try {
        const { ytmp4 } = require('ruhend-scraper');
        const result = await ytmp4(urlYt);
        if (result?.audio) {
          try {
            audioBuffer = await downloadFromUrl(result.audio);
            console.log('✅ ruhend-scraper ytmp4 success');
          } catch {}
        }
      } catch (e) { console.log('ruhend ytmp4 failed:', e.message.slice(0, 60)); }
    }

    // Source 4: ytdl-core (original, final fallback)
    if (!audioBuffer && !audioUrl) {
      try {
        const ytdlOld = require('ytdl-core');
        const stream = ytdlOld(urlYt, { filter: 'audioonly', quality: 'highestaudio' });
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        if (chunks.length > 0) {
          const rawBuffer = Buffer.concat(chunks);
          audioBuffer = await toAudio(rawBuffer, 'mp4');
          console.log('✅ ytdl-core original success');
        }
      } catch (e) { console.log('ytdl-core original failed:', e.message.slice(0, 60)); }
    }

    // Source 5: External APIs (last resort)
    if (!audioBuffer && !audioUrl) {
      const apis = [
        'https://eliteprotech-apis.zone.id/ytdown?url=' + encodeURIComponent(urlYt) + '&format=mp3',
        'https://api.yupra.my.id/api/downloader/ytmp3?url=' + encodeURIComponent(urlYt),
      ];
      for (const apiUrl of apis) {
        try {
          const res = await axios.get(apiUrl, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
          const data = res.data;
          audioUrl = data?.downloadURL || data?.data?.download_url || data?.dl || data?.result?.mp3 || null;
          if (audioUrl) { console.log('✅ External API success'); break; }
        } catch (e) { console.log('API failed:', e.message.slice(0, 60)); }
      }
    }

    // Send the audio
    if (audioBuffer) {
      await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
      const fileName = title.replace(/[^\w\s-]/g, '').substring(0, 80) + '.mp3';
      await sock.sendMessage(chatId, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        fileName: fileName,
        caption: 'Downloaded By Orujov'
      }, { quoted: message });
      return;
    }

    if (audioUrl) {
      await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
      await sock.sendMessage(chatId, {
        audio: { url: audioUrl },
        mimetype: 'audio/mpeg',
        fileName: title.replace(/[^\w\s-]/g, '').substring(0, 80) + '.mp3',
        caption: 'Downloaded By Orujov'
      }, { quoted: message });
      return;
    }

    throw new Error('All download methods failed');
  } catch (error) {
    console.error('[play] error:', error.message);
    try {
      await sock.sendMessage(chatId, { text: '❌ Download failed. Try another song.' }, { quoted: message });
    } catch {}
  }
}

module.exports = playCommand;
