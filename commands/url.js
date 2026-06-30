const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { UploadFileUgu, TelegraPh, floNime } = require('../lib/uploader');

// Download any media type from message to buffer
async function downloadMedia(msg, mediaType) {
  try {
    const stream = await downloadContentFromMessage(msg, mediaType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (e) {
    console.error('downloadMedia error:', e.message);
    return null;
  }
}

// Extract media from message (including quoted, view-once)
function extractMedia(message) {
  const m = message.message || {};

  // Check current message
  if (m.imageMessage) return { msg: m.imageMessage, type: 'image', ext: '.jpg', fileName: m.imageMessage.fileName };
  if (m.videoMessage) return { msg: m.videoMessage, type: 'video', ext: '.mp4', fileName: m.videoMessage.fileName };
  if (m.audioMessage) return { msg: m.audioMessage, type: 'audio', ext: '.mp3', fileName: 'audio.mp3' };
  if (m.stickerMessage) return { msg: m.stickerMessage, type: 'sticker', ext: '.webp', fileName: 'sticker.webp' };
  if (m.documentMessage) {
    const fName = m.documentMessage.fileName || 'file.bin';
    const ext = path.extname(fName) || '.bin';
    return { msg: m.documentMessage, type: 'document', ext, fileName: fName };
  }

  // Check quoted message
  const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted) {
    if (quoted.imageMessage) return { msg: quoted.imageMessage, type: 'image', ext: '.jpg', fileName: quoted.imageMessage.fileName };
    if (quoted.videoMessage) return { msg: quoted.videoMessage, type: 'video', ext: '.mp4', fileName: quoted.videoMessage.fileName };
    if (quoted.audioMessage) return { msg: quoted.audioMessage, type: 'audio', ext: '.mp3', fileName: 'audio.mp3' };
    if (quoted.stickerMessage) return { msg: quoted.stickerMessage, type: 'sticker', ext: '.webp', fileName: 'sticker.webp' };
    if (quoted.documentMessage) {
      const fName = quoted.documentMessage.fileName || 'file.bin';
      const ext = path.extname(fName) || '.bin';
      return { msg: quoted.documentMessage, type: 'document', ext, fileName: fName };
    }
  }

  // Check view-once containers
  const vv = m.viewOnceMessageV2?.message || m.viewOnceMessage?.message;
  if (vv) {
    if (vv.imageMessage) return { msg: vv.imageMessage, type: 'image', ext: '.jpg', fileName: vv.imageMessage.fileName };
    if (vv.videoMessage) return { msg: vv.videoMessage, type: 'video', ext: '.mp4', fileName: vv.videoMessage.fileName };
    if (vv.audioMessage) return { msg: vv.audioMessage, type: 'audio', ext: '.mp3', fileName: 'audio.mp3' };
    if (vv.documentMessage) {
      const fName = vv.documentMessage.fileName || 'file.bin';
      const ext = path.extname(fName) || '.bin';
      return { msg: vv.documentMessage, type: 'document', ext, fileName: fName };
    }
  }

  return null;
}

// Upload with multiple providers in parallel (race), return fastest result
async function uploadFile(filePath, ext) {
  const uploaders = [];

  // For images: try TelegraPh and Uguu in parallel
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    uploaders.push(
      TelegraPh(filePath).then(url => ({ url, provider: 'telegraph' })).catch(() => null)
    );
  }

  // Always try Uguu (works for all types)
  uploaders.push(
    UploadFileUgu(filePath).then(res => {
      const url = typeof res === 'string' ? res : (res.url || res.url_full || '');
      return url ? { url, provider: 'uguu' } : null;
    }).catch(() => null)
  );

  // Try floNime as additional option
  uploaders.push(
    (async () => {
      try {
        const buf = fs.readFileSync(filePath);
        const res = await floNime(buf, { ext: ext.replace('.', '') });
        return res?.url ? { url: res.url, provider: 'flonime' } : null;
      } catch { return null; }
    })()
  );

  const results = await Promise.allSettled(uploaders);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
}

async function urlCommand(sock, chatId, message) {
  try {
    const media = extractMedia(message);
    if (!media) {
      await sock.sendMessage(chatId, {
        text: 'Reply to any media (image, video, audio, sticker, document, GIF, ZIP, APK, PDF, etc.) with .url to get a shareable link.'
      }, { quoted: message });
      return;
    }

    // Show processing reaction
    await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

    const buffer = await downloadMedia(media.msg, media.type);
    if (!buffer || buffer.length === 0) {
      await sock.sendMessage(chatId, { text: 'Failed to download media.' }, { quoted: message });
      return;
    }

    // Write to temp file
    const tempDir = path.join(__dirname, '../temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `${Date.now()}_${Math.random().toString(36).slice(2, 6)}${media.ext}`);
    fs.writeFileSync(tempPath, buffer);

    // Upload
    const result = await uploadFile(tempPath, media.ext);

    // Cleanup temp file immediately
    try { fs.unlinkSync(tempPath); } catch {}

    if (!result) {
      await sock.sendMessage(chatId, { text: 'Failed to upload media. Try again later.' }, { quoted: message });
      return;
    }

    // Remove reaction
    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    // Send result with new design
    const msg = `╭─ 🌐 *FILE URL*\n\n🔗 ${result.url}`;
    await sock.sendMessage(chatId, { text: msg, parse_mode: 'Markdown' }, { quoted: message });

  } catch (error) {
    console.error('[URL] error:', error?.message || error);
    try {
      await sock.sendMessage(chatId, { text: 'Error processing media.' }, { quoted: message });
    } catch {}
  }
}

module.exports = urlCommand;
