const fs = require("fs");
const path = require("path");
const axios = require("axios");
const yts = require("yt-search");
const ytdl = require("ytdl-core");
const { toAudio } = require("../lib/converter");
const { igdl, ttdl, ytmp3, ytmp4 } = require("ruhend-scraper");

const DATA_FILE = path.join(__dirname, "..", "data", "reply.json");

// URL patterns
const YT_PATTERNS = [
  /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/i,
  /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[\w-]+/i,
  /https?:\/\/(?:m\.)?youtube\.com\/watch\?v=[\w-]+/i,
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
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    }
  } catch (e) {}
  return { enabled: false };
}

function writeState(state) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state));
  } catch (e) {}
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

// ============ YOUTUBE DOWNLOAD ============
async function downloadYouTube(sock, chatId, url) {
  try {
    // Send thumbnail first
    try {
      const search = await yts(url);
      if (search && search.videos && search.videos.length > 0) {
        const vid = search.videos[0];
        if (vid.thumbnail) {
          const thumbRes = await axios.get(vid.thumbnail, { responseType: "arraybuffer", timeout: 10000 });
          await sock.sendMessage(chatId, {
            image: Buffer.from(thumbRes.data),
            caption: `🎵 *${vid.title}*\n⏱ ${vid.timestamp || "?"}\n📢 ${vid.author?.name || "?"}`,
          });
        }
      }
    } catch (e) {
      console.log("YT thumbnail error:", e.message);
    }

    // Try multiple download sources for MP3
    let audioBuffer = null;

    // Source 1: ytdl-core
    try {
      const stream = ytdl(url, { filter: "audioonly", quality: "lowestaudio" });
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      audioBuffer = await toAudio(buf, "mp4");
    } catch (e) {
      console.log("ytdl-core failed:", e.message);
    }

    // Source 2: ruhend-scraper ytmp3
    if (!audioBuffer) {
      try {
        const result = await ytmp3(url);
        if (result && result.audio) {
          const res = await axios.get(result.audio, { responseType: "arraybuffer", timeout: 30000 });
          audioBuffer = Buffer.from(res.data);
        }
      } catch (e) {
        console.log("ruhend ytmp3 failed:", e.message);
      }
    }

    // Source 3: ruhend-scraper ytmp4 (audio fallback)
    if (!audioBuffer) {
      try {
        const result = await ytmp4(url);
        if (result && result.audio) {
          const res = await axios.get(result.audio, { responseType: "arraybuffer", timeout: 30000 });
          audioBuffer = Buffer.from(res.data);
        }
      } catch (e) {
        console.log("ruhend ytmp4 audio failed:", e.message);
      }
    }

    if (audioBuffer) {
      await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: "audio/mpeg" });
      return true;
    }
    return false;
  } catch (e) {
    console.log("YT download error:", e.message);
    return false;
  }
}

// ============ INSTAGRAM DOWNLOAD ============
async function downloadInstagram(sock, chatId, url) {
  try {
    // Source 1: ruhend-scraper igdl
    try {
      const result = await igdl(url);
      if (result && result.data && result.data.length > 0) {
        for (const item of result.data) {
          const mediaUrl = item.url || item.downloadUrl || item;
          const res = await axios.get(typeof mediaUrl === "string" ? mediaUrl : mediaUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
          });
          const buf = Buffer.from(res.data);
          const isVideo = typeof mediaUrl === "string" && mediaUrl.includes(".mp4");
          if (isVideo) {
            await sock.sendMessage(chatId, { video: buf, caption: "📸 Instagram" });
          } else {
            await sock.sendMessage(chatId, { image: buf, caption: "📸 Instagram" });
          }
        }
        return true;
      }
    } catch (e) {
      console.log("igdl failed:", e.message);
    }

    // Source 2: Instagram downloader API
    try {
      const res = await axios.post(
        "https://instagram-downloader-download-instagram-videos-stories.p.rapidapi.com/index",
        new URLSearchParams({ url }),
        {
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "X-RapidAPI-Key": "e2b3e27dc3msh3f7d8e9c1a4b5c6d7e8f9a0b1c",
            "X-RapidAPI-Host": "instagram-downloader-download-instagram-videos-stories.p.rapidapi.com",
          },
          timeout: 15000,
        }
      );
      if (res.data?.media) {
        const mediaList = Array.isArray(res.data.media) ? res.data.media : [res.data.media];
        for (const item of mediaList) {
          const mediaUrl = item.url || item.thumbnail || item;
          const resp = await axios.get(typeof mediaUrl === "string" ? mediaUrl : mediaUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
          });
          await sock.sendMessage(chatId, { image: Buffer.from(resp.data), caption: "📸 Instagram" });
        }
        return true;
      }
    } catch (e) {
      console.log("RapidAPI IG failed:", e.message);
    }

    return false;
  } catch (e) {
    console.log("IG download error:", e.message);
    return false;
  }
}

// ============ TIKTOK DOWNLOAD ============
async function downloadTikTok(sock, chatId, url) {
  try {
    // Source 1: ruhend-scraper ttdl
    try {
      const result = await ttdl(url);
      if (result && result.video) {
        const res = await axios.get(result.video, { responseType: "arraybuffer", timeout: 30000 });
        const buf = Buffer.from(res.data);
        await sock.sendMessage(chatId, { video: buf, caption: "🎵 TikTok" });
        return true;
      }
      if (result && result.data && result.data.length > 0) {
        for (const item of result.data) {
          const mediaUrl = item.url || item;
          const res = await axios.get(typeof mediaUrl === "string" ? mediaUrl : mediaUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
          });
          await sock.sendMessage(chatId, { video: Buffer.from(res.data), caption: "🎵 TikTok" });
        }
        return true;
      }
    } catch (e) {
      console.log("ttdl failed:", e.message);
    }

    // Source 2: TikTok API fallback
    try {
      const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
        timeout: 15000,
      });
      if (res.data?.data?.play) {
        const mediaRes = await axios.get(res.data.data.play, { responseType: "arraybuffer", timeout: 30000 });
        await sock.sendMessage(chatId, { video: Buffer.from(mediaRes.data), caption: "🎵 TikTok" });
        return true;
      }
    } catch (e) {
      console.log("TikWM failed:", e.message);
    }

    return false;
  } catch (e) {
    console.log("TT download error:", e.message);
    return false;
  }
}

// ============ MAIN HANDLER ============
async function replyCommand(sock, chatId, message, args) {
  const text = args.join(" ").trim().toLowerCase();

  // Handle .reply on / .reply off
  if (text === "on") {
    writeState({ enabled: true });
    await sock.sendMessage(chatId, {
      text: "✅ *Reply Mode Enabled*\n\n"
        + "Automatic downloading has been enabled.\n\n"
        + "• YouTube → Automatically downloads MP3 (Thumbnail first, then MP3).\n"
        + "• Instagram → Automatically downloads Reel/Post.\n"
        + "• TikTok → Automatically downloads watermark-free video.\n\n"
        + "Simply send a supported link.",
    });
    return;
  }

  if (text === "off") {
    writeState({ enabled: false });
    await sock.sendMessage(chatId, {
      text: "❌ *Reply Mode Disabled*\n\n"
        + "Automatic downloading has been disabled.\n\n"
        + "Reply to a YouTube, Instagram or TikTok link with `.reply` to download it manually.",
    });
    return;
  }

  // Handle .reply with link from replied message
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
        text: "❌ Please reply to a valid YouTube, Instagram or TikTok link.",
      });
      return;
    }

    const platform = detectPlatform(url);
    if (!platform) {
      await sock.sendMessage(chatId, {
        text: "❌ Please reply to a valid YouTube, Instagram or TikTok link.",
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
        text: "❌ Failed to download. The link may be invalid or the service is temporarily unavailable.",
      });
    }
    return;
  }

  // If just .reply with no args and no replied message -> show help
  if (!text || text === "") {
    await sock.sendMessage(chatId, {
      text: "📥 *Reply Download Settings*\n\n"
        + "• `.reply on` — Automatic downloading is enabled.\n"
        + "• `.reply off` — Automatic downloading is disabled.\n"
        + "• When Reply Mode is OFF, reply to a YouTube, Instagram or TikTok link with `.reply` to download it manually.\n\n"
        + "Supported platforms: YouTube (MP3), Instagram (Reel/Post), TikTok (Video)",
    });
    return;
  }
}

// ============ AUTO-DOWNLOAD HANDLER ============
async function handleAutoDownload(sock, chatId, text, message) {
  if (!isReplyEnabled()) return false;

  const url = extractUrl(text);
  if (!url) return false;

  const platform = detectPlatform(url);
  if (!platform) return false;

  // Download automatically
  let success = false;
  if (platform === "youtube") success = await downloadYouTube(sock, chatId, url);
  else if (platform === "instagram") success = await downloadInstagram(sock, chatId, url);
  else if (platform === "tiktok") success = await downloadTikTok(sock, chatId, url);

  return success;
}

module.exports = { replyCommand, handleAutoDownload, isReplyEnabled };
