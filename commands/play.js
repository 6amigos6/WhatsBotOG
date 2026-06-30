const yts = require('yt-search');
const ytdlExec = require('youtube-dl-exec');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { toAudio } = require('../lib/converter');

const TEMP_DIR = path.join(__dirname, '../temp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Live temp cleaner: remove anything older than 5 minutes, run every 2 min
setInterval(() => {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    let cleaned = 0;
    for (const f of files) {
      try {
        const fp = path.join(TEMP_DIR, f);
        const stat = fs.statSync(fp);
        if (stat.isFile() && now - stat.mtimeMs > 300000) {
          fs.unlinkSync(fp);
          cleaned++;
        }
      } catch {}
    }
    if (cleaned > 0) console.log(`🧹 Temp cleaner: removed ${cleaned} stale files`);
  } catch {}
}, 120000);

// Also clean on startup
try {
  const files = fs.readdirSync(TEMP_DIR);
  for (const f of files) {
    try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch {}
  }
  if (files.length > 0) console.log(`🧹 Startup: cleaned ${files.length} temp files`);
} catch {}

async function downloadWithYtdlp(url, outputPath) {
  await ytdlExec(url, {
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: 0,
    output: outputPath,
    noCheckCertificates: true,
    preferFreeFormats: true,
    noWarnings: true,
    addHeader: ['User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'],
    geoBypass: true,
  });
}

async function downloadWithAxios(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.youtube.com/',
    },
    maxRedirects: 5,
  });
  return Buffer.from(res.data);
}

async function getAudioUrlFromYtdlp(videoUrl) {
  try {
    const info = await ytdlExec(videoUrl, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      noWarnings: true,
      addHeader: ['User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'],
      geoBypass: true,
    });
    
    if (!info?.formats) return null;
    
    const audioFormats = info.formats.filter(f => 
      f.acodec && f.acodec !== 'none' && f.vcodec === 'none' && f.url && !f.cipher
    ).sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
    
    if (audioFormats.length > 0) return audioFormats[0].url;
    
    // Fallback: any format with audio
    const anyAudio = info.formats.find(f => f.acodec && f.acodec !== 'none' && f.url && !f.cipher);
    return anyAudio?.url || null;
  } catch {
    return null;
  }
}

async function playCommand(sock, chatId, message) {
  let tempFilePath = null;
  
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
    const title = (video.title || 'Unknown').substring(0, 100);
    const author = video.author?.name || 'Unknown';
    const duration = video.timestamp || '00:00';

    await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });

    // Send HD thumbnail with song info
    try {
      await sock.sendMessage(chatId, {
        image: { url: video.thumbnail },
        caption: `╭─ 🎵 *SONG FOUND*\n│\n│ 📌 *${title}*\n│ 👤 ${author}\n│ ⏱ ${duration}\n╰────────────────`
      }, { quoted: message });
    } catch (thumbErr) {
      console.log('Thumbnail failed:', thumbErr.message);
    }

    await sock.sendMessage(chatId, { react: { text: '📥', key: message.key } });

    // === DOWNLOAD AUDIO ===
    let audioBuffer = null;
    let downloadedVia = '';

    // Method 1: yt-dlp native download (most reliable)
    if (!audioBuffer) {
      try {
        const tmpName = `play_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
        tempFilePath = path.join(TEMP_DIR, tmpName);
        await downloadWithYtdlp(urlYt, tempFilePath);
        if (fs.existsSync(tempFilePath) && fs.statSync(tempFilePath).size > 1000) {
          audioBuffer = fs.readFileSync(tempFilePath);
          downloadedVia = 'yt-dlp';
          console.log(`✅ ${downloadedVia}: ${(audioBuffer.length/1024/1024).toFixed(2)}MB`);
        }
      } catch (e) { console.log('yt-dlp download failed:', e.message?.slice(0, 60)); }
    }

    // Method 2: Get audio URL via yt-dlp JSON, download via axios
    if (!audioBuffer) {
      try {
        const audioUrl = await getAudioUrlFromYtdlp(urlYt);
        if (audioUrl) {
          audioBuffer = await downloadWithAxios(audioUrl);
          if (audioBuffer.length > 1000) {
            downloadedVia = 'yt-dlp+axios';
            console.log(`✅ ${downloadedVia}: ${(audioBuffer.length/1024/1024).toFixed(2)}MB`);
          } else { audioBuffer = null; }
        }
      } catch (e) { console.log('yt-dlp+axios failed:', e.message?.slice(0, 60)); }
    }

    // Method 3: ruhend-scraper fallback
    if (!audioBuffer) {
      try {
        const { ytmp3 } = require('ruhend-scraper');
        const result = await ytmp3(urlYt);
        const audioUrl = (result?.audio || result?.audio_2 || result?.mp3 || '');
        if (audioUrl) {
          try { audioBuffer = await downloadWithAxios(audioUrl); } catch {}
          if (!audioBuffer && result?.download) {
            const res = await axios.get(result.download, { responseType: 'arraybuffer', timeout: 30000 });
            audioBuffer = Buffer.from(res.data);
          }
          if (audioBuffer?.length > 1000) {
            downloadedVia = 'ruhend';
            console.log(`✅ ${downloadedVia}: ${(audioBuffer.length/1024/1024).toFixed(2)}MB`);
          } else { audioBuffer = null; }
        }
      } catch (e) { console.log('ruhend failed:', e.message?.slice(0, 60)); }
    }

    // Method 4: @distube/ytdl-core as last resort
    if (!audioBuffer) {
      try {
        const ytdl = require('@distube/ytdl-core');
        const stream = ytdl(urlYt, {
          filter: 'audioonly',
          quality: 'highestaudio',
          requestOptions: {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept-Language': 'en-US,en;q=0.9',
            }
          }
        });
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        if (chunks.length > 0) {
          const rawBuf = Buffer.concat(chunks);
          audioBuffer = await toAudio(rawBuf, 'mp4');
          downloadedVia = 'ytdl-core';
          console.log(`✅ ${downloadedVia}: ${(audioBuffer?.length/1024/1024).toFixed(2)||0}MB`);
        }
      } catch (e) { console.log('ytdl-core failed:', e.message?.slice(0, 60)); }
    }

    // Final cleanup: delete temp file if exists
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); tempFilePath = null; } catch {}
    }

    if (!audioBuffer) {
      await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
      return await sock.sendMessage(chatId, { text: '❌ YouTube blocked the request. Try another song or try again later.' }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    // Send audio with caption
    const fileName = title.replace(/[^\w\s-]/g, '').substring(0, 80) + '.mp3';
    await sock.sendMessage(chatId, {
      audio: audioBuffer,
      mimetype: 'audio/mpeg',
      fileName: fileName,
      caption: 'Downloaded By Orujov'
    }, { quoted: message });

    // Clear audio buffer from memory
    audioBuffer = null;

  } catch (error) {
    console.error('[play] error:', error.message);
    if (tempFilePath) { try { fs.unlinkSync(tempFilePath); } catch {} }
    try {
      await sock.sendMessage(chatId, {
        text: '❌ Download failed. YouTube may be rate-limiting. Try again in a few minutes.'
      }, { quoted: message });
    } catch {}
  }
}

module.exports = playCommand;
