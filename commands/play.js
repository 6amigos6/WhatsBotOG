const yts = require('yt-search');
const ytdlExec = require('youtube-dl-exec');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '../temp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Clean temp files on startup
try {
  const files = fs.readdirSync(TEMP_DIR);
  for (const f of files) {
    try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch {}
  }
} catch {}

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

    // Searching
    await sock.sendMessage(chatId, { react: { text: '🔎', key: message.key } });

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

    // Send HD thumbnail
    await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });
    try {
      await sock.sendMessage(chatId, {
        image: { url: video.thumbnail },
        caption: `╭─ 🎵 *SONG FOUND*\n│\n│ 📌 *${title}*\n│ 👤 ${author}\n│ ⏱ ${duration}\n╰────────────────`
      }, { quoted: message });
    } catch (thumbErr) {
      console.log('Thumbnail failed:', thumbErr.message);
    }

    await sock.sendMessage(chatId, { react: { text: '📥', key: message.key } });

    // === DOWNLOAD AUDIO via yt-dlp ===
    const tmpName = `play_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.m4a`;
    tempFilePath = path.join(TEMP_DIR, tmpName);

    try {
      await ytdlExec(urlYt, {
        format: 'bestaudio[ext=m4a]/bestaudio',
        output: tempFilePath,
        noCheckCertificates: true,
        preferFreeFormats: true,
        noWarnings: true,
        geoBypass: true,
        addHeader: ['User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'],
      });
    } catch (ytdlpErr) {
      console.log('yt-dlp failed:', ytdlpErr.message?.slice(0, 80));

      // Fallback: yt-dlp JSON → axios download
      try {
        const info = await ytdlExec(urlYt, {
          dumpSingleJson: true,
          noCheckCertificates: true,
          preferFreeFormats: true,
          noWarnings: true,
          geoBypass: true,
        });

        const audioFormat = info?.formats?.findLast(f =>
          f.acodec && f.acodec !== 'none' && f.vcodec === 'none' && f.url && !f.cipher
        );

        if (audioFormat?.url) {
          const res = await axios.get(audioFormat.url, {
            responseType: 'arraybuffer',
            timeout: 120000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://www.youtube.com/',
            },
            maxRedirects: 5,
          });
          fs.writeFileSync(tempFilePath, Buffer.from(res.data));
        }
      } catch (fallbackErr) {
        console.log('Fallback also failed:', fallbackErr.message?.slice(0, 80));
        throw new Error('All download methods failed');
      }
    }

    // Verify file
    if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size < 1000) {
      throw new Error('Downloaded file is empty or corrupt');
    }

    const fileSize = (fs.statSync(tempFilePath).size / 1024 / 1024).toFixed(2);
    console.log(`✅ Audio: ${title} (${fileSize}MB)`);

    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    // Determine mimetype
    const ext = path.extname(tempFilePath).toLowerCase();
    const mimetype = ext === '.m4a' ? 'audio/mp4' : ext === '.mp3' ? 'audio/mpeg' : ext === '.webm' ? 'audio/webm' : 'audio/mpeg';
    const fileName = title.replace(/[^\w\s-]/g, '').substring(0, 80) + (ext || '.m4a');

    await sock.sendMessage(chatId, {
      audio: { url: tempFilePath },
      mimetype: mimetype,
      fileName: fileName,
      caption: 'Downloaded By Orujov'
    }, { quoted: message });

    // Cleanup temp file immediately after sending
    try { fs.unlinkSync(tempFilePath); tempFilePath = null; } catch {}

  } catch (error) {
    console.error('[play] error:', error.message);
    if (tempFilePath) { try { fs.unlinkSync(tempFilePath); } catch {} }
    try {
      await sock.sendMessage(chatId, {
        text: '❌ Download failed. Try another song or try again later.'
      }, { quoted: message });
    } catch {}
  }
}

module.exports = playCommand;
