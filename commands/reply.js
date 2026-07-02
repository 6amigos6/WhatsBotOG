const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ytdlExec = require('youtube-dl-exec');
const { igdl, ttdl } = require("ruhend-scraper");

const DATA_FILE = path.join(__dirname, "..", "data", "reply.json");
const TEMP_DIR = path.join(__dirname, "..", "temp");
fs.mkdirSync(TEMP_DIR, { recursive: true });

// YouTube URL patterns - all formats
const YT_PATTERNS = [
  /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+/i,
  /https?:\/\/youtu\.be\/[\w-]+/i,
  /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[\w-]+/i,
  /https?:\/\/(?:m\.|music\.)?youtube\.com\/watch\?v=[\w-]+/i,
  /https?:\/\/(?:m\.|music\.)?youtube\.com\/shorts\/[\w-]+/i,
  /https?:\/\/(?:www\.)?youtube\.com\/embed\/[\w-]+/i,
  /https?:\/\/(?:www\.)?youtube\.com\/v\/[\w-]+/i,
];

const IG_PATTERNS = [
  /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+\/?/i,
  /https?:\/\/(?:www\.)?instagram\.com\/stories\/[\w.-]+\/[\d]+\/?/i,
];
const TT_PATTERNS = [
  /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/i,
  /https?:\/\/(?:www\.)?tiktok\.com\/t\/[\w-]+\/?/i,
  /https?:\/\/(?:vm|vt)\.tiktok\.com\/[\w-]+\/?/i,
];

function readState() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch (e) {}
  return { enabled: false };
}

function writeState(state) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(state)); } catch (e) {}
}

function isReplyEnabled() {
  return readState().enabled === true;
}

function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s]+/i);
  return m ? m[0] : null;
}

function detectPlatform(url) {
  for (const pat of YT_PATTERNS) if (pat.test(url)) return "youtube";
  for (const pat of IG_PATTERNS) if (pat.test(url)) return "instagram";
  for (const pat of TT_PATTERNS) if (pat.test(url)) return "tiktok";
  return null;
}

// ============ YOUTUBE DOWNLOAD (yt-dlp) ============
async function downloadYouTube(sock, chatId, url) {
  let tempFilePath = null;
  try {
    // Send thumbnail with video info
    try {
      const yts = require("yt-search");
      const search = await yts(url);
      const vid = search?.videos?.[0];
      if (vid?.thumbnail) {
        await sock.sendMessage(chatId, {
          image: { url: vid.thumbnail },
          caption: `${vid.title}\n👤 ${vid.author?.name || '?'}\n⏱ ${vid.timestamp || '?'}\n\nDownloaded By Gasham`
        });
      }
    } catch (e) { console.log("YT thumb error:", e.message); }

    // Download audio via yt-dlp (fastest + most reliable)
    const tmpName = `yt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.m4a`;
    tempFilePath = path.join(TEMP_DIR, tmpName);

    await ytdlExec(url, {
      format: 'bestaudio[ext=m4a]/bestaudio',
      output: tempFilePath,
      noCheckCertificates: true,
      preferFreeFormats: true,
      noWarnings: true,
      geoBypass: true,
      addHeader: ['User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'],
    });

    if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size < 1000) {
      throw new Error("File empty");
    }

    const fileSize = (fs.statSync(tempFilePath).size / 1024 / 1024).toFixed(2);
    console.log(`✅ YT audio: ${fileSize}MB`);

    await sock.sendMessage(chatId, {
      audio: { url: tempFilePath },
      mimetype: 'audio/mp4',
      fileName: `youtube_audio_${Date.now()}.m4a`,
      caption: 'Downloaded By Gasham'
    });

    // Cleanup
    try { fs.unlinkSync(tempFilePath); tempFilePath = null; } catch {}
    return true;

  } catch (e) {
    console.error("YT download failed:", e.message);
    if (tempFilePath) { try { fs.unlinkSync(tempFilePath); } catch {} }

    // Fallback: yt-dlp JSON → axios
    try {
      const info = await ytdlExec(url, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
        noWarnings: true,
        geoBypass: true,
      });
      const af = info?.formats?.findLast(f =>
        f.acodec && f.acodec !== 'none' && f.vcodec === 'none' && f.url && !f.cipher
      );
      if (af?.url) {
        const res = await axios.get(af.url, {
          responseType: 'arraybuffer', timeout: 120000,
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.youtube.com/' },
          maxRedirects: 5,
        });
        const buf = Buffer.from(res.data);
        if (buf.length > 1000) {
          await sock.sendMessage(chatId, {
            audio: buf, mimetype: 'audio/mp4',
            caption: 'Downloaded By Gasham'
          });
          console.log(`✅ YT audio (fallback): ${(buf.length/1024/1024).toFixed(2)}MB`);
          return true;
        }
      }
    } catch (e2) { console.log("YT fallback failed:", e2.message?.slice(0, 60)); }

    return false;
  }
}

// ============ INSTAGRAM DOWNLOAD ============
async function downloadInstagram(sock, chatId, url) {
  try {
    try {
      const result = await igdl(url);
      if (result?.data?.length > 0) {
        for (const item of result.data) {
          const mediaUrl = item.url || item.downloadUrl || item;
          const res = await axios.get(typeof mediaUrl === "string" ? mediaUrl : mediaUrl, {
            responseType: "arraybuffer", timeout: 30000,
          });
          const buf = Buffer.from(res.data);
          const isVideo = typeof mediaUrl === "string" && mediaUrl.includes(".mp4");
          if (isVideo) await sock.sendMessage(chatId, { video: buf, caption: 'Downloaded By Gasham' });
          else await sock.sendMessage(chatId, { image: buf, caption: 'Downloaded By Gasham' });
        }
        return true;
      }
    } catch (e) { console.log("igdl failed:", e.message); }
    return false;
  } catch (e) { console.log("IG download error:", e.message); return false; }
}

// ============ TIKTOK DOWNLOAD ============
async function downloadTikTok(sock, chatId, url) {
  try {
    try {
      const result = await ttdl(url);
      if (result?.video) {
        const res = await axios.get(result.video, { responseType: "arraybuffer", timeout: 30000 });
        await sock.sendMessage(chatId, { video: Buffer.from(res.data), caption: 'Downloaded By Gasham' });
        return true;
      }
      if (result?.data?.length > 0) {
        for (const item of result.data) {
          const mediaUrl = item.url || item;
          const res = await axios.get(typeof mediaUrl === "string" ? mediaUrl : mediaUrl, {
            responseType: "arraybuffer", timeout: 30000,
          });
          await sock.sendMessage(chatId, { video: Buffer.from(res.data), caption: 'Downloaded By Gasham' });
        }
        return true;
      }
    } catch (e) { console.log("ttdl failed:", e.message); }

    try {
      const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, { timeout: 15000 });
      if (res.data?.data?.play) {
        const mediaRes = await axios.get(res.data.data.play, { responseType: "arraybuffer", timeout: 30000 });
        await sock.sendMessage(chatId, { video: Buffer.from(mediaRes.data), caption: 'Downloaded By Gasham' });
        return true;
      }
    } catch (e) { console.log("TikWM failed:", e.message); }
    return false;
  } catch (e) { console.log("TT download error:", e.message); return false; }
}

// ============ MAIN HANDLER ============
async function replyCommand(sock, chatId, message, args) {
  const text = args.join(" ").trim().toLowerCase();

  // Handle .reply on / .reply off
  if (text === "on") {
    writeState({ enabled: true });
    await sock.sendMessage(chatId, {
      text: "✅ *Reply Mode ON*\n\n"
        + "• Auto-download is now *disabled*.\n"
        + "• Reply to a media link with `.reply` to download manually."
    });
    return;
  }

  if (text === "off") {
    writeState({ enabled: false });
    await sock.sendMessage(chatId, {
      text: "❌ *Reply Mode OFF*\n\n"
        + "• Auto-download is now *enabled*.\n"
        + "• Simply send a media link → auto-download.\n"
        + "• Auto-download enabled for all supported media."
    });
    return;
  }

  // Handle .reply with link from replied message (manual download)
  if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
    const quoted = message.message.extendedTextMessage.contextInfo.quotedMessage;
    const quotedText =
      quoted.conversation ||
      quoted.extendedTextMessage?.text ||
      quoted.imageMessage?.caption ||
      quoted.videoMessage?.caption ||
      "";

    const url = extractUrl(quotedText);
    if (!url) {
      await sock.sendMessage(chatId, {
        text: "❌ Reply to a valid media link with `.reply`.",
      });
      return;
    }

    const platform = detectPlatform(url);
    if (!platform) {
      await sock.sendMessage(chatId, {
        text: "❌ Unsupported link format.",
      });
      return;
    }

    await sock.sendMessage(chatId, { react: { text: "🔄", key: message.key } });

    let success = false;
    if (platform === "youtube") success = await downloadYouTube(sock, chatId, url);
    else if (platform === "instagram") success = await downloadInstagram(sock, chatId, url);
    else if (platform === "tiktok") success = await downloadTikTok(sock, chatId, url);

    if (!success) {
      await sock.sendMessage(chatId, {
        text: "❌ Download failed. The link may be invalid or service unavailable.",
      });
    }
    return;
  }

  // Show help
  await sock.sendMessage(chatId, {
    text: "📥 *Reply Download System*\n\n"
      + "Status: " + (isReplyEnabled() ? "✅ ON (Manual)" : "❌ OFF (Auto)") + "\n\n"
      + "• `.reply off` → Auto-download media links\n"
      + "• `.reply on` → Manual download via `.reply` to link\n\n"
      + "Supported: All media links"
  });
}

// ============ AUTO-DOWNLOAD HANDLER ============
async function handleAutoDownload(sock, chatId, text, message) {
  // When reply is OFF: auto-download YouTube/IG/TT links
  // When reply is ON: do nothing (user must .reply manually)
  if (isReplyEnabled()) return false;

  const url = extractUrl(text);
  if (!url) return false;

  const platform = detectPlatform(url);
  if (!platform) return false;

  await sock.sendMessage(chatId, { react: { text: "🔄", key: message.key } });

  let success = false;
  if (platform === "youtube") success = await downloadYouTube(sock, chatId, url);
  else if (platform === "instagram") success = await downloadInstagram(sock, chatId, url);
  else if (platform === "tiktok") success = await downloadTikTok(sock, chatId, url);

  return success;
}

module.exports = { replyCommand, handleAutoDownload, isReplyEnabled };
